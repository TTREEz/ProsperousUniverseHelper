const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// The renderer is a static bundle, so the desktop build serves it from disk.
// There is no local web server and no port to negotiate.
const devServer = process.env.PU_DEV_SERVER;

const DIST = path.join(__dirname, "..", "dist");
const APP_ORIGIN = "app://bundle";

// file:// is not a real origin: IndexedDB there accepts open() and then never
// fires any event, which hung the app on startup. A privileged custom scheme
// gives the renderer a proper secure origin, so storage behaves as it does in a
// browser.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveFromDist(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = path.join(DIST, relative || "index.html");

  // Keep a crafted URL from reaching outside the bundle.
  const resolved = path.resolve(target);
  if (resolved !== path.resolve(DIST) && !resolved.startsWith(path.resolve(DIST) + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  return net.fetch(pathToFileURL(resolved).toString());
}

const FILTERS = [
  { name: "PU Toolset save", extensions: ["pu.json", "json"] },
  { name: "All files", extensions: ["*"] },
];

// Mirrors the renderer's unsaved-changes flag. The main process needs it
// because only it can intercept the window close.
let hasUnsavedChanges = false;

ipcMain.on("pu:dirty", (_event, dirty) => {
  hasUnsavedChanges = Boolean(dirty);
});

/**
 * Asks the renderer to run its normal save, and resolves with whether it
 * actually happened — the user can still back out of the file dialog.
 */
function requestRendererSave(window) {
  return new Promise((resolve) => {
    ipcMain.once("pu:save-finished", (_event, saved) => resolve(Boolean(saved)));
    window.webContents.send("pu:request-save");
  });
}

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

  // Set once the user has decided, so the second close() is not intercepted.
  let closeApproved = false;

  window.on("close", (event) => {
    if (closeApproved || !hasUnsavedChanges) return;
    event.preventDefault();

    void (async () => {
      const { response } = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Save", "Don't save", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        title: "Unsaved changes",
        message: "Save changes before closing?",
        detail: "Your work is not written to the file yet. If you close without saving, it is lost.",
      });

      if (response === 2) return;

      if (response === 1) {
        closeApproved = true;
        window.close();
        return;
      }

      if (await requestRendererSave(window)) {
        closeApproved = true;
        window.close();
      }
    })();
  });

  if (devServer) {
    window.loadURL(devServer);
  } else {
    window.loadURL(`${APP_ORIGIN}/index.html`);
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
  protocol.handle("app", serveFromDist);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
