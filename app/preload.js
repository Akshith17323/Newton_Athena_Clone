const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preloads cannot import the ESM policy module. Mirror its transport
// limits here; the main process independently enforces the same limits.
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MIN_SNAPSHOT_INTERVAL_MS = 4500;
const SNAPSHOT_SESSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const snapshotRequests = new Set();
const lastSnapshotRequest = new Map();

function invokeSnapshot(channel, sessionId, data) {
    if (sessionId !== null && sessionId !== undefined
        && (typeof sessionId !== 'string' || !SNAPSHOT_SESSION_PATTERN.test(sessionId))) {
        return Promise.reject(new Error('Invalid snapshot session ID.'));
    }
    if (channel === 'store-camera-snap-image-on-disk') {
        const isByteBuffer = data instanceof ArrayBuffer
            || (ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1 && data.buffer instanceof ArrayBuffer);
        if (!isByteBuffer || data.byteLength === 0 || data.byteLength > MAX_SNAPSHOT_BYTES) {
            return Promise.reject(new Error('Snapshot is empty, invalid or exceeds the image size limit.'));
        }
    }

    const now = Date.now();
    const previous = lastSnapshotRequest.get(channel);
    if (snapshotRequests.has(channel) || (previous !== undefined && now - previous < MIN_SNAPSHOT_INTERVAL_MS)) {
        return Promise.resolve(null);
    }
    snapshotRequests.add(channel);
    lastSnapshotRequest.set(channel, now);
    const args = channel === 'capture-screen' ? [sessionId] : [data, sessionId];
    return Promise.resolve().then(() => ipcRenderer.invoke(channel, ...args)).finally(() => {
        snapshotRequests.delete(channel);
    });
}

contextBridge.exposeInMainWorld("athena", {
    apiRequest: (request) => {
        return ipcRenderer.invoke('api-request', request);
    },
    registerListenerForTimerTickFromMain: (callback) => {
        // callback is setTimer
        const fn = (event, message) => {
            callback(message);
        }

        ipcRenderer.on('timer', fn);

        return () => {
            ipcRenderer.removeListener('timer', fn);
        }
    },
    startTimerOnMain: () => {
        return ipcRenderer.invoke('start-timer');
    },
    stopTimerOnMain: () => {
        return ipcRenderer.invoke('stop-timer');
    },

    checkMultipleDisplays: () => {
        return ipcRenderer.invoke('check-multiple-displays');
    },
    isFullScreen: () => {
        return ipcRenderer.invoke('is-fullscreen');
    },
    registerListenerForFullscreenChange: (callback) => {
        const fn = (_event, isFs) => callback(isFs);
        ipcRenderer.on('fullscreen-change', fn);
        return () => {
            ipcRenderer.removeListener('fullscreen-change', fn);
        };
    },
    registerListenerForWindowBlur: (callback) => {
        const fn = () => callback();
        ipcRenderer.on('window-blur', fn);
        return () => {
            ipcRenderer.removeListener('window-blur', fn);
        };
    },

    // New Preload Functions
    registerListenerForKeyboardInputFromMain: (callback) => {
        const fn = (event, message) => callback(message);
        ipcRenderer.on('keyboard-input', fn);
        return () => {
            ipcRenderer.removeListener('keyboard-input', fn);
        }
    },

    // Functions related to periodic proctoring snapshots
    registerListenerForCameraSnapFromMain: (callback) => {
        ipcRenderer.on('camera-shot', callback);

        return () => {
            ipcRenderer.removeListener('camera-shot', callback);
        }
    },

    storeCameraSnapImageOnDisk: (data, sessionId) => {
        return invokeSnapshot('store-camera-snap-image-on-disk', sessionId, data);
    },
    captureScreen: (sessionId) => {
        return invokeSnapshot('capture-screen', sessionId);
    },

    // Functions related to showing Contest Rules in a new Dialog
    showRules: () => {
        return ipcRenderer.invoke("show-rules");
    },
    exitExam: (confirm = true) => {
        return ipcRenderer.invoke("exit-exam", confirm);
    },
    selectFolder: () => {
        return ipcRenderer.invoke("selectFolder");
    }
})
