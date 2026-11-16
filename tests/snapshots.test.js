import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { SnapshotStore } from '../app/snapshot-store.js';
import { getSnapshotDimensions, SNAPSHOT_POLICY } from '../app/snapshot-policy.js';
import { captureCameraFrame, createSnapshotCaptureRunner } from '../src/snapshots.js';

const START_TIME = Date.UTC(2026, 10, 16);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function fixture(t, { fileSystem = fs, policy = {} } = {}) {
    const parent = await fs.mkdtemp(path.join(process.env.ATHENA_TEST_TMP_DIR || tmpdir(), 'athena-snapshots-'));
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    let clock = START_TIME;
    const store = new SnapshotStore({
        directory: path.join(parent, 'athena-snapshots'),
        fileSystem,
        now: () => clock,
        policy: { minCaptureIntervalMs: 0, minFreeBytes: 0, scanIntervalMs: 0, operationTimeoutMs: 5000, ...policy }
    });
    return { parent, store, advance: (milliseconds = 1) => { clock += milliseconds; } };
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return false;
    }
}

test('bounds snapshot dimensions without stretching or upscaling', () => {
    assert.deepEqual(getSnapshotDimensions(7680, 4320), { width: 1280, height: 720 });
    assert.deepEqual(getSnapshotDimensions(2160, 3840), { width: 405, height: 720 });
    assert.deepEqual(getSnapshotDimensions(640, 480), { width: 640, height: 480 });
    assert.throws(() => getSnapshotDimensions(0, 480), /positive numbers/);
    assert.throws(() => getSnapshotDimensions(Infinity, 480), /positive numbers/);
});

test('writes camera and desktop byte buffers into the app-owned store', async (t) => {
    const { store } = await fixture(t);
    const cameraData = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
    const screenData = new Uint8Array([4, 5]).buffer;
    const [cameraPath, screenPath] = await Promise.all([
        store.capture('camera', 'session-123', () => cameraData),
        store.capture('screen', 'session-123', () => screenData)
    ]);
    assert.equal(path.dirname(cameraPath), path.join(store.directory, 'session-123', 'camera'));
    assert.equal(path.dirname(screenPath), path.join(store.directory, 'session-123', 'screen'));
    assert.deepEqual(await fs.readFile(cameraPath), Buffer.from([1, 2]));
    assert.deepEqual(await fs.readFile(screenPath), Buffer.from([4, 5]));
    assert.equal(store.totalBytes, 4);
    assert.equal(store.isBusy, false);
    assert.equal(await exists(`${cameraPath}.part`), false);
});

test('rejects oversized, empty and non-byte payloads before touching storage', async (t) => {
    const { store } = await fixture(t, { policy: { maxImageBytes: 3 } });
    for (const payload of [new Uint8Array(4), new ArrayBuffer(0), 'photo', [1, 2], new Uint16Array(2), null]) {
        await assert.rejects(store.capture('camera', 'session-123', () => payload), /Snapshot/);
        assert.equal(store.isBusy, false);
    }
    assert.equal(await exists(store.directory), false);
});

test('rejects path traversal and invalid session IDs before producing images', async (t) => {
    const { store } = await fixture(t);
    for (const session of ['../escape', '/absolute', 'session/child', 'session\\child', '', '.', '..', 123, 'a'.repeat(129)]) {
        await assert.rejects(store.capture('screen', session, () => assert.fail('must not capture')), /session ID/);
    }
    await assert.rejects(store.capture('other', 'session-123', () => Buffer.from('x')), /kind/);
    assert.equal(await exists(store.directory), false);
});

test('a stalled camera producer does not prevent a desktop snapshot', async (t) => {
    const { store } = await fixture(t);
    const cameraImage = deferred();
    const pendingCamera = store.capture('camera', 'session-123', () => cameraImage.promise);
    const screenPath = await store.capture('screen', 'session-123', () => Buffer.from('desktop'));
    assert.equal(await exists(screenPath), true);
    assert.equal(await store.capture('camera', 'session-123', () => assert.fail('camera overlapped')), null);
    cameraImage.resolve(Buffer.from('camera'));
    assert.equal(await exists(await pendingCamera), true);
});

test('slow writes stay asynchronous, serialize disk accounting and bound repeated requests', async (t) => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const fileSystem = {
        ...fs,
        open: async (...args) => {
            const handle = await fs.open(...args);
            return {
                writeFile: async (data) => {
                    activeWrites += 1;
                    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
                    writeStarted.resolve();
                    await releaseWrite.promise;
                    try {
                        await handle.writeFile(data);
                    } finally {
                        activeWrites -= 1;
                    }
                },
                close: () => handle.close()
            };
        }
    };
    const { store } = await fixture(t, { fileSystem });
    const camera = store.capture('camera', 'session-123', () => Buffer.from('camera'));
    await writeStarted.promise;
    const screen = store.capture('screen', 'session-123', () => Buffer.from('desktop'));
    const repeats = await Promise.all(Array.from({ length: 50 }, (_, index) => (
        store.capture(index % 2 ? 'camera' : 'screen', 'session-123', () => assert.fail('unbounded producer'))
    )));
    assert.ok(repeats.every(result => result === null));
    await new Promise(setImmediate); // The event loop remains available during a blocked disk write.
    assert.equal(maxActiveWrites, 1);
    releaseWrite.resolve();
    await Promise.all([camera, screen]);
    assert.equal(maxActiveWrites, 1);
    assert.equal(store.files.length, 2);
});

test('timeouts do not release a still-running main-process capture slot', async (t) => {
    const image = deferred();
    const renamed = deferred();
    const { store } = await fixture(t, {
        policy: { operationTimeoutMs: 30 },
        fileSystem: {
            ...fs,
            rename: async (...args) => {
                await fs.rename(...args);
                renamed.resolve();
            }
        }
    });
    await assert.rejects(store.capture('screen', 'session-123', () => image.promise), /timed out/);
    assert.equal(store.isBusy, true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        assert.equal(await store.capture('screen', 'session-123', () => assert.fail('timed-out capture overlapped')), null);
    }
    image.resolve(Buffer.from('screen'));
    await renamed.promise;
    await new Promise(setImmediate);
    assert.equal(store.isBusy, false);
    assert.ok(await store.capture('screen', 'session-123', () => Buffer.from('next')));
});

test('main-process rate limiting is independent for camera and desktop', async (t) => {
    const { store, advance } = await fixture(t, { policy: { minCaptureIntervalMs: SNAPSHOT_POLICY.minCaptureIntervalMs } });
    assert.ok(await store.capture('camera', 'session-123', () => Buffer.from('camera')));
    assert.ok(await store.capture('screen', 'session-123', () => Buffer.from('desktop')));
    advance(4000);
    assert.equal(await store.capture('camera', 'session-123', () => assert.fail('too frequent')), null);
    advance(1000);
    assert.ok(await store.capture('camera', 'session-123', () => Buffer.from('camera')));
});

test('byte retention removes the oldest managed images across sessions and sources', async (t) => {
    const { store, advance } = await fixture(t, { policy: { maxStorageBytes: 8 } });
    const oldest = await store.capture('camera', 'session-old', () => Buffer.from('1234'));
    advance();
    const second = await store.capture('screen', 'session-old', () => Buffer.from('5678'));
    advance();
    const latest = await store.capture('camera', 'session-new', () => Buffer.from('abcd'));
    assert.equal(await exists(oldest), false);
    assert.equal(await exists(second), true);
    assert.equal(await exists(latest), true);
    assert.equal(store.totalBytes, 8);
});

test('file-count and age retention clean up expired session directories', async (t) => {
    const { store, advance } = await fixture(t, { policy: { maxFiles: 2, maxAgeMs: 100 } });
    const oldest = await store.capture('camera', 'session-old', () => Buffer.from('a'));
    advance();
    const second = await store.capture('screen', 'session-old', () => Buffer.from('b'));
    advance();
    const third = await store.capture('camera', 'session-new', () => Buffer.from('c'));
    assert.equal(await exists(oldest), false);
    assert.equal(store.files.length, 2);
    advance(101);
    const current = await store.capture('camera', 'session-current', () => Buffer.from('d'));
    assert.equal(await exists(second), false);
    assert.equal(await exists(third), false);
    assert.equal(await exists(path.join(store.directory, 'session-old')), false);
    assert.equal(await exists(path.join(store.directory, 'session-new')), false);
    assert.equal(await exists(current), true);
});

test('retention reconciles existing images after restart and only cleans owned files', async (t) => {
    const { parent, store } = await fixture(t, { policy: { maxFiles: 1 } });
    const oldest = await store.capture('camera', 'session-old', () => Buffer.from('old'));
    const foreign = path.join(path.dirname(oldest), 'personal-photo.jpg');
    const abandoned = path.join(path.dirname(oldest), `${START_TIME}-${randomUUID()}.jpg.part`);
    const outside = path.join(parent, 'personal-photo.jpg');
    await fs.writeFile(foreign, 'keep');
    await fs.writeFile(outside, 'keep');
    await fs.writeFile(abandoned, 'partial');
    const restarted = new SnapshotStore({
        directory: store.directory,
        now: () => START_TIME + 1,
        policy: { minFreeBytes: 0, minCaptureIntervalMs: 0, maxFiles: 1 }
    });
    const latest = await restarted.capture('screen', 'session-new', () => Buffer.from('new'));
    assert.equal(await exists(oldest), false);
    assert.equal(await exists(abandoned), false);
    assert.equal(await exists(latest), true);
    assert.equal(await fs.readFile(foreign, 'utf8'), 'keep');
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
});

test('will not adopt or delete an existing unmarked directory', async (t) => {
    const { store } = await fixture(t);
    await fs.mkdir(store.directory);
    const personal = path.join(store.directory, `${START_TIME}-${randomUUID()}.jpg`);
    await fs.writeFile(personal, 'keep');
    await assert.rejects(store.capture('camera', 'session-123', () => Buffer.from('new')), /unmanaged files/);
    assert.equal(await fs.readFile(personal, 'utf8'), 'keep');
});

test('does not traverse symlinked stores or session directories', async (t) => {
    const { parent, store } = await fixture(t);
    const outside = path.join(parent, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, store.directory, 'dir');
    await assert.rejects(store.capture('camera', 'session-123', () => Buffer.from('new')), /symbolic links/);
    assert.deepEqual(await fs.readdir(outside), []);
    await fs.unlink(store.directory);
    await store.capture('camera', 'session-safe', () => Buffer.from('safe'));
    await fs.symlink(outside, path.join(store.directory, 'session-link'), 'dir');
    await assert.rejects(store.capture('screen', 'session-link', () => Buffer.from('new')), /symbolic links/);
    assert.deepEqual(await fs.readdir(outside), []);
});

test('low free space stops writes and captures recover when space returns', async (t) => {
    let available = 0n;
    let writes = 0;
    const { store } = await fixture(t, {
        policy: { minFreeBytes: 100 },
        fileSystem: {
            ...fs,
            statfs: async () => ({ bavail: available, bsize: 1n }),
            open: async (...args) => {
                writes += 1;
                return await fs.open(...args);
            }
        }
    });
    await assert.rejects(store.capture('camera', 'session-123', () => Buffer.from('photo')), /low on free space/);
    assert.equal(writes, 0);
    available = 104n; // Enough for the reserve, but not the incoming five-byte image.
    await assert.rejects(store.capture('camera', 'session-123', () => Buffer.from('photo')), /low on free space/);
    assert.equal(writes, 0);
    available = 105n;
    assert.ok(await store.capture('camera', 'session-123', () => Buffer.from('photo')));
    assert.equal(writes, 1);
});

test('write failures remove partial files without poisoning the shared queue', async (t) => {
    let failWrite = true;
    const { store } = await fixture(t, {
        fileSystem: {
            ...fs,
            open: async (...args) => {
                const handle = await fs.open(...args);
                return {
                    writeFile: async (data) => {
                        if (failWrite) {
                            failWrite = false;
                            await handle.writeFile(data.subarray(0, 1));
                            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
                        }
                        await handle.writeFile(data);
                    },
                    close: () => handle.close()
                };
            }
        }
    });
    await assert.rejects(store.capture('camera', 'session-123', () => Buffer.from('photo')), /disk full/);
    assert.equal(store.isBusy, false);
    assert.deepEqual(await fs.readdir(path.join(store.directory, 'session-123', 'camera')), []);
    assert.ok(await store.capture('screen', 'session-123', () => Buffer.from('desktop')));
    assert.ok(await store.capture('camera', 'session-123', () => Buffer.from('photo')));
});

test('stopping an exam while a write is pending removes its partial file', async (t) => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    let active = true;
    const { store } = await fixture(t, {
        fileSystem: {
            ...fs,
            open: async (...args) => {
                const handle = await fs.open(...args);
                return {
                    writeFile: async (data) => {
                        await handle.writeFile(data);
                        writeStarted.resolve();
                        await releaseWrite.promise;
                    },
                    close: () => handle.close()
                };
            }
        }
    });
    const capture = store.capture('screen', 'session-123', () => Buffer.from('screen'), () => active);
    await writeStarted.promise;
    active = false;
    releaseWrite.resolve();
    assert.equal(await capture, null);
    assert.deepEqual(await fs.readdir(path.join(store.directory, 'session-123', 'screen')), []);
    assert.equal(store.totalBytes, 0);
});

test('renderer guards are independent and remain occupied when capture is slow', async () => {
    const run = createSnapshotCaptureRunner({ timeoutMs: 15 });
    const cameraImage = deferred();
    const slow = deferred();
    const camera = run('camera', () => cameraImage.promise, () => slow.resolve());
    assert.equal(await run('screen', () => 'desktop'), 'desktop');
    await slow.promise;
    assert.equal(await run('camera', () => assert.fail('renderer capture overlapped')), null);
    cameraImage.resolve('camera');
    assert.equal(await camera, 'camera');
    await assert.rejects(run('camera', () => { throw new Error('camera failed'); }), /camera failed/);
    assert.equal(await run('camera', () => 'recovered'), 'recovered');
});

test('webcam frames are resized and JPEG-encoded before crossing IPC', async (t) => {
    let drawArgs;
    let encodingArgs;
    const canvas = {
        getContext: () => ({ drawImage: (...args) => { drawArgs = args; } }),
        toBlob: (callback, ...args) => {
            encodingArgs = args;
            callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
        }
    };
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: { createElement: () => canvas }, configurable: true });
    t.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
    });
    const video = {
        srcObject: { getVideoTracks: () => [{ readyState: 'live' }] },
        readyState: 2,
        videoWidth: 7680,
        videoHeight: 4320
    };
    const data = await captureCameraFrame(video);
    assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
    assert.deepEqual(drawArgs, [video, 0, 0, 1280, 720]);
    assert.deepEqual(encodingArgs, ['image/jpeg', 0.75]);
    assert.equal(Buffer.from(data).toString(), 'jpeg');
    assert.equal(await captureCameraFrame({ ...video, readyState: 0 }), null);
    assert.equal(await captureCameraFrame({ ...video, srcObject: { getVideoTracks: () => [] } }), null);
    canvas.toBlob = (callback) => callback(null);
    await assert.rejects(captureCameraFrame(video), /empty/);
    canvas.toBlob = (callback) => callback({
        size: SNAPSHOT_POLICY.maxImageBytes + 1,
        arrayBuffer: () => assert.fail('oversized blob must not cross IPC')
    });
    await assert.rejects(captureCameraFrame(video), /size limit/);
});

test('preload validates payloads before IPC and bounds independent snapshot requests', async () => {
    const camera = deferred();
    const calls = [];
    let athena;
    let clock = START_TIME;
    const electron = {
        contextBridge: { exposeInMainWorld: (_name, api) => { athena = api; } },
        ipcRenderer: {
            invoke: (channel, ...args) => {
                calls.push({ channel, args });
                return channel === 'capture-screen' ? Promise.resolve('desktop') : camera.promise;
            }
        }
    };
    const source = await fs.readFile(new URL('../app/preload.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, {
        require: (name) => {
            assert.equal(name, 'electron');
            return electron;
        },
        ArrayBuffer,
        Date: { now: () => clock }
    });

    await assert.rejects(athena.storeCameraSnapImageOnDisk(new ArrayBuffer(SNAPSHOT_POLICY.maxImageBytes + 1), 'session-123'), /size limit/);
    await assert.rejects(athena.storeCameraSnapImageOnDisk('invalid', 'session-123'), /invalid/);
    await assert.rejects(athena.captureScreen('../escape'), /session ID/);
    assert.equal(calls.length, 0);

    const pending = athena.storeCameraSnapImageOnDisk(new ArrayBuffer(4), 'session-123');
    assert.equal(await athena.captureScreen('session-123'), 'desktop');
    assert.equal(await athena.storeCameraSnapImageOnDisk(new ArrayBuffer(4), 'session-123'), null);
    assert.equal(calls.length, 2);
    camera.resolve('camera');
    assert.equal(await pending, 'camera');
    assert.equal(await athena.storeCameraSnapImageOnDisk(new ArrayBuffer(4), 'session-123'), null);
    clock += SNAPSHOT_POLICY.intervalMs;
    assert.equal(await athena.storeCameraSnapImageOnDisk(new ArrayBuffer(4), 'session-123'), 'camera');
    assert.equal(calls.length, 3);
});
