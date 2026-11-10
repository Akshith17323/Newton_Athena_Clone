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
let apiBaseUrl = null;
let apiToken = null;

const LOCAL_API_BASE_URL = "http://127.0.0.1:3000";

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

    const response = await fetch(`${apiBaseUrl}${apiPath}`, {
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


async function getPrimaryScreenSource(thumbnailSize) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbnailSize ?? {
            width: Math.floor(primaryDisplay.size.width * primaryDisplay.scaleFactor),
            height: Math.floor(primaryDisplay.size.height * primaryDisplay.scaleFactor)
        }
    });
    const screenSources = sources.filter(source => source.id.startsWith('screen:'));
    const primaryScreen = screenSources.find(source => source.display_id === String(primaryDisplay.id));

    if (primaryScreen) return primaryScreen;

    // Some platforms omit display IDs. Only fall back when the screen is unambiguous.
    if (screenSources.length === 1 && !screenSources[0].display_id && screen.getAllDisplays().length === 1) {
        return screenSources[0];
    }

    throw new Error('The primary display is unavailable for screen capture.');
}

ipcMain.handle('capture-screen', async (_event, sessionId) => {
    try {
        const primaryScreen = await getPrimaryScreenSource();
        if (primaryScreen.thumbnail.isEmpty()) {
            throw new Error('The primary display returned an empty screenshot.');
        }
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

function normalizeApiBaseUrl(value, requireRemoteHttps) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error('ATHENA_API_BASE_URL must be a valid HTTP or HTTPS URL.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('ATHENA_API_BASE_URL must use HTTP or HTTPS.');
    }

    if (url.username || url.password || url.search || url.hash) {
        throw new Error('ATHENA_API_BASE_URL cannot contain credentials, a query, or a fragment.');
    }

    if (requireRemoteHttps) {
        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        const isLoopback = hostname === 'localhost'
            || hostname.endsWith('.localhost')
            || hostname === '::1'
            || hostname === '0.0.0.0'
            || /^127(?:\.\d{1,3}){3}$/.test(hostname);

        if (url.protocol !== 'https:') {
            throw new Error('Packaged builds require an HTTPS ATHENA_API_BASE_URL.');
        }

        if (isLoopback) {
            throw new Error('Packaged builds require a separately hosted, non-local exam API.');
        }
    }

    return url.toString().replace(/\/$/, '');
}

function configureExamApi() {
    const configuredBaseUrl = process.env.ATHENA_API_BASE_URL?.trim();

    if (configuredBaseUrl) {
        const configuredToken = process.env.ATHENA_API_TOKEN?.trim();

        if (!configuredToken || configuredToken.length < 32) {
            throw new Error('ATHENA_API_TOKEN must be configured with at least 32 characters.');
        }

        apiBaseUrl = normalizeApiBaseUrl(configuredBaseUrl, app.isPackaged);
        apiToken = configuredToken;
        return null;
    }

    if (app.isPackaged) {
        throw new Error(
            'ATHENA_API_BASE_URL is required. Packaged builds do not contain a local grading service.'
        );
    }

    apiBaseUrl = LOCAL_API_BASE_URL;
    apiToken = randomBytes(32).toString('base64url');

    const serverPath = path.join(import.meta.dirname, '../backend/server.js');
    const sessionsPath = path.join(app.getPath('userData'), 'sessions.json');
    const backendProcess = fork(serverPath, [], {
        env: {
            ...process.env,
            API_TOKEN: apiToken,
            SESSIONS_PATH: sessionsPath
        }
    });

    backendProcess.on('error', (error) => {
        console.error('Failed to start development exam backend:', error);
    });

    backendProcess.on('exit', (code, signal) => {
        if (!forceQuit && code !== 0) {
            console.error(`Development exam backend exited unexpectedly (code: ${code}, signal: ${signal})`);
        }
    });

    return backendProcess;
}


app.whenReady().then(() => {
    let backendProcess;

    try {
        backendProcess = configureExamApi();
    } catch (error) {
        dialog.showErrorBox('Athena configuration error', error.message);
        forceQuit = true;
        app.quit();
        return;
    }

    app.on('will-quit', () => {
        if (backendProcess) backendProcess.kill();
    });

    session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
            let streams = {};
            try {
                const primaryScreen = await getPrimaryScreenSource({ width: 0, height: 0 });
                streams = { video: primaryScreen };
            } catch (error) {
                console.error('Failed to select a screen sharing source:', error);
            }
            callback(streams);
        },
        // The native picker bypasses this handler and can select a window or another display.
        { useSystemPicker: false }
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
