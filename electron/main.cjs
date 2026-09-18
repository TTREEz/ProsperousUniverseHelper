const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

// The renderer is a static bundle, so the desktop build loads it straight from
// disk. There is no local web server and no port to negotiate.
const devServer = process.env.PU_DEV_SERVER;

const FILTERS = [
  { name: "PU Toolset save", extensions: ["pu.json", "json"] },
  { name: "All files", extensions: ["*"] },
];

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0f1419",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devServer) {
    window.loadURL(devServer);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("pu:open", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: FILTERS });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, "utf8");
  return { text, filePath, name: path.basename(filePath) };
});

ipcMain.handle("pu:save", async (_event, { filePath, text }) => {
  await fs.writeFile(filePath, text, "utf8");
  return { filePath, name: path.basename(filePath) };
});

ipcMain.handle("pu:saveAs", async (_event, { suggestedName, text }) => {
  const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: FILTERS });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, text, "utf8");
  return { filePath: result.filePath, name: path.basename(result.filePath) };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
