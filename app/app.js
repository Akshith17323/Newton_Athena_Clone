import { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, Menu } from "electron";
import { randomBytes } from "crypto";
import path from "path";
import fs from "fs";
import { fork } from "child_process";

let electronWindow = null;
let startTimestamp = null;
let cameraShotPath = null;
let forceQuit = false;
let timerInterval = null;
let cameraSnapInterval = null;
let apiToken = null;

const API_BASE_URL = (process.env.ATHENA_API_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

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

    const distPath = path.join(import.meta.dirname, '../dist/index.html');
    if (app.isPackaged) {
        electronWindow.loadFile(distPath);
    } else {
        electronWindow.loadURL('http://localhost:5173').catch(() => {
            console.log("Vite dev server not running on http://localhost:5173, falling back to dist/index.html");
            if (fs.existsSync(distPath)) {
                electronWindow.loadFile(distPath);
            }
        });
    }

    console.log("WebContents initialized with ID:", electronWindow.webContents.id);

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

    electronWindow.on('enter-full-screen', () => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('fullscreen-change', true);
        }
    });

    electronWindow.on('leave-full-screen', () => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('fullscreen-change', false);
        }
    });

    electronWindow.on('close', (e) => {
        if (!forceQuit) {
            e.preventDefault();
            attemptQuit();
        }
    });
}

ipcMain.handle('is-fullscreen', () => {
    return electronWindow ? electronWindow.isFullScreen() : false;
});

ipcMain.handle('api-request', async (event, request) => {
    if (!electronWindow || electronWindow.isDestroyed() || event.sender !== electronWindow.webContents) {
        throw new Error('API request rejected: untrusted renderer');
    }

    if (!apiToken) {
        throw new Error('API request rejected: authentication is unavailable');
    }

    const apiPath = request?.path;
    const requestedMethod = request?.method || 'GET';
    const requestBody = request?.body;

    if (typeof requestedMethod !== 'string') {
        throw new Error('API request rejected: invalid method');
    }

    const method = requestedMethod.toUpperCase();

    if (typeof apiPath !== 'string' || !/^\/exam(?:\/|$)/.test(apiPath)) {
        throw new Error('API request rejected: invalid path');
    }

    if (method !== 'GET' && method !== 'POST') {
        throw new Error('API request rejected: invalid method');
    }

    if (requestBody !== undefined && typeof requestBody !== 'string') {
        throw new Error('API request rejected: invalid body');
    }

    const headers = {
        Authorization: `Bearer ${apiToken}`
    };

    if (requestBody !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE_URL}${apiPath}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : requestBody
    });
    const responseText = await response.text();
    let data;

    try {
        data = responseText ? JSON.parse(responseText) : null;
    } catch {
        data = { message: responseText || `Request failed with status ${response.status}` };
    }

    return {
        ok: response.ok,
        status: response.status,
        data
    };
});

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
    apiToken = randomBytes(32).toString('base64url');

    const serverPath = app.isPackaged
        ? path.join(process.resourcesPath, 'backend', 'server.js')
        : path.join(import.meta.dirname, '../backend/server.js');
    const answerKeyPath = app.isPackaged
        ? path.join(app.getAppPath(), 'app', 'grading', 'answer-key.json')
        : path.join(import.meta.dirname, 'grading', 'answer-key.json');
    const sessionsPath = path.join(app.getPath('userData'), 'sessions.json');
    const backendEnv = {
        ...process.env,
        API_TOKEN: apiToken,
        ANSWER_KEY_PATH: answerKeyPath,
        SESSIONS_PATH: sessionsPath
    };

    if (app.isPackaged) {
        backendEnv.NODE_PATH = path.join(app.getAppPath(), 'node_modules');
    }

    const backendProcess = fork(serverPath, [], {
        env: backendEnv
    });

    backendProcess.on('error', (error) => {
        console.error('Failed to start exam backend:', error);
    });

    backendProcess.on('exit', (code, signal) => {
        if (!forceQuit && code !== 0) {
            console.error(`Exam backend exited unexpectedly (code: ${code}, signal: ${signal})`);
        }
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

ipcMain.handle("selectFolder", async () => {
    return await selectFolder();
});
