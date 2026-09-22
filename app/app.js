import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";

let electronWindow = null;
let startTimestamp = null
let cameraShotPath = null;

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        fullscreen: true,
        kiosk: true,
        webPreferences: {

            devTools: true,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    })

    electronWindow.loadURL('http://localhost:5173')
}

ipcMain.handle('start-timer', () => {
    startTimestamp = Date.now();

    // Send Timer Tick every 1s
    setInterval(() => {
        electronWindow.webContents.send('timer', (Date.now() - startTimestamp) / 1000);
    }, 1000);

    // Capture user's camera snap every 5s
    setInterval(() => {
        electronWindow.webContents.send('camera-shot')
    }, 5000);
})


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


ipcMain.on("show-rules", () => {
    dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Athena Exam Rules",
        message: "Exam Rules",
        detail:
            "1. Stay on the exam screen.\n" +
            "2. Camera must remain enabled.\n" +
            "3. Do not leave the exam.\n" +
            "4. Do not use external assistance.\n" +
            "5. Click Exit Exam when finished."
    });
});


app.whenReady().then(() => {
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
    }
    console.log(response);
}

ipcMain.handle("selectFile", async () => {
    await selectFile();
})


ipcMain.handle("selectFolder", async () => {
    await selectFolder();
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
