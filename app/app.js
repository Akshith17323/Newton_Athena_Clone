import { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, Menu } from "electron";
import path from "path";
import fs from "fs";
import { fork } from "child_process";

let electronWindow = null;
let startTimestamp = null;
let cameraShotPath = null;
let forceQuit = false;
let timerInterval = null;
let cameraSnapInterval = null;

function clearExamIntervals() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (cameraSnapInterval) {
        clearInterval(cameraSnapInterval);
        cameraSnapInterval = null;
    }
}

function attemptQuit() {
    if (forceQuit) return;
    dialog.showMessageBox(electronWindow, {
        type: 'warning',
        buttons: ['Yes', 'No'],
        title: 'Confirm Quit',
        message: 'Are you sure you want to quit the exam?'
    }).then(res => {
        if (res.response === 0) {
            forceQuit = true;
            app.quit();
        }
    });
}

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        fullscreen: true,
        kiosk: true,
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: false,
            devTools: true,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    })

    if (app.isPackaged) {
        electronWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
    } else {
        electronWindow.loadURL('http://localhost:5173');
    }

    console.log("WebContents:", electronWindow.webContents);

    Menu.setApplicationMenu(null);

    electronWindow.webContents.on('before-input-event', (event, input) => {
        electronWindow.webContents.send('keyboard-input', input);
        
        const key = input.key ? input.key.toLowerCase() : '';

        // Block reload, developer tools, view-source, print, and full screen toggle keys
        if (
            key === 'f5' || 
            key === 'f11' || 
            key === 'f12' || 
            ((input.control || input.meta) && (key === 'r' || key === 'u' || key === 'p' || key === 'i'))
        ) {
            event.preventDefault();
            return;
        }

        // Prevent keybinds like copy/paste
        if (input.control || input.meta) {
            event.preventDefault();
            if (key === 'q') {
                attemptQuit();
            }
        }
    });

    electronWindow.on('blur', () => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('window-blur');
        }
    });

    electronWindow.on('close', (e) => {
        if (!forceQuit) {
            e.preventDefault();
            attemptQuit();
        }
    });
}

ipcMain.handle('check-multiple-displays', () => {
    return screen.getAllDisplays().length > 1;
});

ipcMain.handle('start-timer', () => {
    clearExamIntervals();
    startTimestamp = Date.now();

    // Send Timer Tick every 1s (rounded integer elapsed seconds)
    timerInterval = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
            electronWindow.webContents.send('timer', elapsed);
        }
    }, 1000);

    // Capture user's camera snap every 5s
    cameraSnapInterval = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('camera-shot');
        }
    }, 5000);
});

ipcMain.handle('stop-timer', () => {
    clearExamIntervals();
});


ipcMain.handle('store-camera-snap-image-on-disk', (_event, data, sessionId) => {
    let baseDir = path.join(import.meta.dirname, "user-camera-snap");

    if (cameraShotPath) {
        baseDir = cameraShotPath;
    }

    const sessionDir = sessionId ? path.join(baseDir, sessionId) : path.join(baseDir, "pre-exam-snaps");

    // Ensure the directory exists
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const filePath = path.join(sessionDir, `${Date.now()}.jpg`);

    fs.writeFileSync(filePath, Buffer.from(data));
})


ipcMain.handle('capture-screen', async (_event, sessionId) => {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const scaleFactor = primaryDisplay.scaleFactor;
        
        const sources = await desktopCapturer.getSources({ 
            types: ['window', 'screen'], 
            thumbnailSize: { 
                width: Math.floor(width * scaleFactor), 
                height: Math.floor(height * scaleFactor) 
            } 
        });
        const primaryScreen = sources[0];
        const pngBuffer = primaryScreen.thumbnail.toPNG();

        let baseDir = path.join(import.meta.dirname, "user-screen-snap");
        if (cameraShotPath) {
            baseDir = cameraShotPath;
        }

        const sessionDir = sessionId ? path.join(baseDir, sessionId + "-screen") : path.join(baseDir, "pre-exam-screen-snaps");

        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const filePath = path.join(sessionDir, `${Date.now()}_screen.png`);
        fs.writeFileSync(filePath, pngBuffer);
        return filePath;
    } catch (error) {
        console.error("Failed to capture screen:", error);
    }
})

async function showRulesDialog() {
    const response = await dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Athena Exam Rules",
        message: "Exam Rules & Guidelines",
        detail:
            "1. Stay on the exam screen.\n" +
            "2. Camera must remain enabled.\n" +
            "3. Do not leave the exam.\n" +
            "4. Do not use external assistance.\n" +
            "5. Click Exit Exam when finished.",
        buttons: ["I Agree", "Cancel"],
        checkboxLabel: "I have read and agree to follow these rules",
        checkboxChecked: false
    });

    console.log("Clicked Button:", response.response === 0 ? "I Agree" : "Cancel", `(Index: ${response.response})`);
    console.log("Checkbox selection:", response.checkboxChecked);

    return response;
}

ipcMain.handle("show-rules", async () => {
    return await showRulesDialog();
});

ipcMain.on("show-rules", async () => {
    await showRulesDialog();
});

ipcMain.handle("exit-exam", (_event, confirm = true) => {
    if (confirm) {
        attemptQuit();
    } else {
        forceQuit = true;
        app.quit();
    }
});


app.whenReady().then(() => {
    const serverPath = path.join(import.meta.dirname, '../backend/server.js');
    const sessionsPath = path.join(app.getPath('userData'), 'sessions.json');
    const backendProcess = fork(serverPath, [], {
        env: { ...process.env, SESSIONS_PATH: sessionsPath }
    });

    app.on('will-quit', () => {
        if (backendProcess) backendProcess.kill();
    });

    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
                // Grant access to the first screen found.
                callback({ video: sources[0], audio: 'loopback' })
            })
        },
        { useSystemPicker: true }
    );
    createWindow();
});


async function showMessageBox() {
    const data = await dialog.showMessageBox({
        type: 'info',
        title: 'GuideLines for the exam',
        message: 'We store your data \n We take your capture shots after every 5 seconds \n If you caught cheating your marks will be zero',
        buttons: ['What Next', 'Go previous'],
        checkboxChecked: true,
        checkboxLabel: "Your are Ok with above guidelines"
    })

    console.log(data);
    // response -> contains the index of the button
    // checkboxChecked -> contains user clicks the button
}


ipcMain.handle("showMessageBox", async () => {
    await showMessageBox();
})

// showOpenDialog box api can do lot of things can select files and folders
async function selectFile() {
    const response = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{
            name: 'ALl files',
            extensions: ['*']
        }],
    })

    // check what does response have
    console.log(response);
}

async function selectFolder() {
    const response = await dialog.showOpenDialog({
        title: 'Select the folder',
        buttonLabel: 'OK',
        properties: ['openDirectory'],
        defaultPath: '/'
    });

    if (!response.canceled && response.filePaths.length > 0) {
        cameraShotPath = response.filePaths[0];
        return response.filePaths[0];
    }
    console.log(response);
    return null;
}

ipcMain.handle("selectFile", async () => {
    await selectFile();
})


ipcMain.handle("selectFolder", async () => {
    return await selectFolder();
})


async function showSaveDialogBox() {
    const response = await dialog.showSaveDialog({
        title: 'Where to save file',
        message: 'Select the folder to save the file',
        buttonLabel: 'Save as',
        defaultPath: '/'
    })

    console.log(response);
}


ipcMain.handle("showSaveDialogBox", async () => {
    await showSaveDialogBox();
})





// TASKS
// Task 1
// Add a Button to trigger a folder selection using the Dialog Box element.
// All the Camera Snaps captured should be stored in this folder.

// Task 2
// Add Buttons and a Checkbox to the existing Rules Dialog Box.
// console.log the Checkbox selection and Clicked Button.
