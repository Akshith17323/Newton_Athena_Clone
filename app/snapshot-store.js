import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SNAPSHOT_POLICY } from './snapshot-policy.js';

const MARKER_NAME = '.athena-snapshot-store';
const MARKER_CONTENT = 'athena-snapshots-v1\n';
const SESSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const IMAGE_PATTERN = /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg(\.part)?$/;

function imageBuffer(data, maxBytes) {
    let buffer;
    if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
    } else if (ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1 && data.buffer instanceof ArrayBuffer) {
        buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else {
        throw new Error('Snapshot must be an ArrayBuffer or byte array.');
    }

    if (buffer.length === 0 || buffer.length > maxBytes) {
        throw new Error('Snapshot is empty or exceeds the image size limit.');
    }
    return buffer;
}

export class SnapshotStore {
    constructor({ directory, fileSystem = fs, now = Date.now, policy = {} }) {
        this.directory = path.resolve(directory);
        this.fs = fileSystem;
        this.now = now;
        this.policy = { ...SNAPSHOT_POLICY, ...policy };
        this.inFlight = new Set();
        this.lastCapture = new Map();
        this.writeQueue = Promise.resolve();
        this.files = null;
        this.totalBytes = 0;
        this.lastScan = 0;
    }

    get isBusy() {
        return this.inFlight.size > 0;
    }

    async capture(kind, sessionId, createImage, isActive = () => true) {
        if (kind !== 'camera' && kind !== 'screen') {
            throw new Error('Invalid snapshot kind.');
        }
        const session = sessionId ?? 'pre-exam';
        if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
            throw new Error('Invalid snapshot session ID.');
        }

        const startedAt = this.now();
        const lastCapture = this.lastCapture.get(kind);
        if (!isActive() || this.inFlight.has(kind)
            || (lastCapture !== undefined && startedAt - lastCapture < this.policy.minCaptureIntervalMs)) {
            return null;
        }

        // There can be at most one producer per kind and two writes in the queue.
        this.inFlight.add(kind);
        this.lastCapture.set(kind, startedAt);
        const operation = (async () => {
            const buffer = imageBuffer(await createImage(), this.policy.maxImageBytes);
            if (!isActive()) return null;

            const write = this.writeQueue.then(() => this.writeImage(kind, session, buffer, isActive));
            this.writeQueue = write.catch(() => {});
            return await write;
        })().finally(() => {
            this.inFlight.delete(kind);
        });

        let timeout;
        try {
            return await Promise.race([
                operation,
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => {
                        reject(new Error('Snapshot capture timed out. Check the capture folder or contact your proctor.'));
                    }, this.policy.operationTimeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timeout);
            // A timeout cannot cancel a filesystem operation. Keep the slot occupied
            // until it really settles, rather than accumulating more stalled writes.
        }
    }

    async ensureDirectory(directory) {
        await this.fs.mkdir(directory, { recursive: true });
        const stats = await this.fs.lstat(directory);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new Error('Snapshot directories cannot be symbolic links.');
        }
    }

    async ensureOwnedRoot() {
        await this.ensureDirectory(this.directory);
        const marker = path.join(this.directory, MARKER_NAME);
        let stats;
        try {
            stats = await this.fs.lstat(marker);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const entries = await this.fs.opendir(this.directory);
            let firstEntry;
            try {
                firstEntry = await entries.read();
            } finally {
                await entries.close();
            }
            if (firstEntry) {
                throw new Error('The athena-snapshots folder contains unmanaged files. Choose another capture folder.', { cause: error });
            }
            await this.fs.writeFile(marker, MARKER_CONTENT, { flag: 'wx', mode: 0o600 });
            stats = await this.fs.lstat(marker);
        }
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== Buffer.byteLength(MARKER_CONTENT)
            || await this.fs.readFile(marker, 'utf8') !== MARKER_CONTENT) {
            throw new Error('The capture folder is not an Athena snapshot store.');
        }
    }

    async removeEmptyDirectory(directory) {
        try {
            await this.fs.rmdir(directory);
        } catch (error) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
    }

    async unlink(filePath) {
        try {
            await this.fs.unlink(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    async prune(incomingBytes = 0, incomingFiles = 0) {
        this.files.sort((left, right) => left.createdAt - right.createdAt);
        const expiresBefore = this.now() - this.policy.maxAgeMs;
        while (this.files.length && (
            this.files[0].createdAt < expiresBefore
            || this.totalBytes + incomingBytes > this.policy.maxStorageBytes
            || this.files.length + incomingFiles > this.policy.maxFiles
        )) {
            const oldest = this.files[0];
            await this.unlink(oldest.path);
            this.files.shift();
            this.totalBytes -= oldest.size;
        }
    }

    async refreshInventory() {
        await this.ensureOwnedRoot();
        this.files = [];
        this.totalBytes = 0;
        const sessions = await this.fs.opendir(this.directory);
        for await (const session of sessions) {
            if (!session.isDirectory() || !SESSION_PATTERN.test(session.name)) continue;
            const sessionDir = path.join(this.directory, session.name);
            for (const kind of ['camera', 'screen']) {
                const imageDir = path.join(sessionDir, kind);
                let stats;
                try {
                    stats = await this.fs.lstat(imageDir);
                } catch (error) {
                    if (error.code === 'ENOENT') continue;
                    throw error;
                }
                if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
                const images = await this.fs.opendir(imageDir);
                for await (const image of images) {
                    const match = IMAGE_PATTERN.exec(image.name);
                    if (!image.isFile() || !match) continue;
                    const filePath = path.join(imageDir, image.name);
                    if (match[2]) {
                        // Only our own unfinished, atomically written images are removed.
                        await this.unlink(filePath);
                        continue;
                    }
                    const fileStats = await this.fs.lstat(filePath);
                    if (!fileStats.isFile() || fileStats.isSymbolicLink()) continue;
                    this.files.push({ path: filePath, size: fileStats.size, createdAt: Number(match[1]) });
                    this.totalBytes += fileStats.size;
                    // Keep the inventory bounded even when recovering an oversized store.
                    if (Number(match[1]) < this.now() - this.policy.maxAgeMs
                        || this.totalBytes > this.policy.maxStorageBytes || this.files.length > this.policy.maxFiles) {
                        await this.prune();
                    }
                }
                await this.removeEmptyDirectory(imageDir);
            }
            await this.removeEmptyDirectory(sessionDir);
        }
        await this.prune();
        this.lastScan = this.now();
    }

    async checkFreeSpace(incomingBytes) {
        const stats = await this.fs.statfs(this.directory, { bigint: true });
        const available = BigInt(stats.bavail) * BigInt(stats.bsize);
        if (available < BigInt(this.policy.minFreeBytes + incomingBytes)) {
            throw new Error('Snapshot capture paused: the capture disk is low on free space. Contact your proctor.');
        }
    }

    async writeImage(kind, session, buffer, isActive) {
        if (!isActive()) return null;
        let temporaryPath;
        let handle;
        try {
            if (!this.files || this.now() - this.lastScan >= this.policy.scanIntervalMs) {
                await this.refreshInventory();
            }
            if (!isActive()) return null;
            if (buffer.length > this.policy.maxStorageBytes || this.policy.maxFiles < 1) {
                throw new Error('Snapshot storage limit is too small for this image.');
            }
            await this.prune(buffer.length, 1);
            await this.checkFreeSpace(buffer.length);

            const sessionDir = path.join(this.directory, session);
            const imageDir = path.join(sessionDir, kind);
            await this.ensureDirectory(sessionDir);
            await this.ensureDirectory(imageDir);
            if (!isActive()) return null;

            const createdAt = this.now();
            const filePath = path.join(imageDir, `${createdAt}-${randomUUID()}.jpg`);
            const pendingPath = `${filePath}.part`;
            handle = await this.fs.open(pendingPath, 'wx', 0o600);
            temporaryPath = pendingPath;
            await handle.writeFile(buffer);
            await handle.close();
            handle = null;
            if (!isActive()) return null;
            await this.fs.rename(temporaryPath, filePath);
            temporaryPath = null;
            this.files.push({ path: filePath, size: buffer.length, createdAt });
            this.totalBytes += buffer.length;
            return filePath;
        } catch (error) {
            // Reconcile partial writes/deletions before accepting another image.
            this.files = null;
            throw error;
        } finally {
            if (handle || temporaryPath) this.files = null;
            try {
                if (handle) await handle.close();
            } finally {
                if (temporaryPath) await this.unlink(temporaryPath);
            }
        }
    }
}
