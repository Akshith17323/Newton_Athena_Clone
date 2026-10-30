const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
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

    // Functions related to capturing camera snaps of user
    registerListenerForCameraSnapFromMain: (callback) => {
        ipcRenderer.on('camera-shot', callback);

        return () => {
            ipcRenderer.removeListener('camera-shot', callback);
        }
    },

    storeCameraSnapImageOnDisk: (data, sessionId) => {
        ipcRenderer.invoke('store-camera-snap-image-on-disk', data, sessionId);
    },
    captureScreen: (sessionId) => {
        ipcRenderer.invoke('capture-screen', sessionId);
    },

    // Functions related to showing Contest Rules in a new Dialog
    showRules: () => {
        return ipcRenderer.invoke("show-rules");
    },
    exitExam: (confirm = true) => {
        return ipcRenderer.invoke("exit-exam", confirm);
    },
    showMessageBox: () => {
        ipcRenderer.invoke("showMessageBox");
    },
    selectFile: () => {
        ipcRenderer.invoke("selectFile");
    },
    selectFolder() {
        return ipcRenderer.invoke("selectFolder")
    },
    showSaveDialogBox() {
        ipcRenderer.invoke("showSaveDialogBox");
    },
})
