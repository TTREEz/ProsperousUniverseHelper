const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require("electron");
const { autoUpdater } = require("electron-updater");
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

/**
 * Self-update, for the installed build only.
 *
 * A portable exe has nowhere to install an update to, and electron-updater
 * throws rather than no-ops there, so it is only started when the app is
 * actually installed. The user's data is a file they hold outside the app, and
 * older save files are migrated on load, so replacing the binary cannot cost
 * them anything.
 *
 * Nothing is installed behind the user's back: the download happens quietly,
 * and it is applied on quit — which runs the unsaved-changes prompt first.
 */
function startUpdater(window) {
  if (devServer || process.env.PORTABLE_EXECUTABLE_DIR) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel, payload) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  autoUpdater.on("update-available", (info) => send("pu:update-available", { version: info?.version ?? null }));
  autoUpdater.on("update-downloaded", (info) => send("pu:update-ready", { version: info?.version ?? null }));
  autoUpdater.on("error", (error) => send("pu:update-error", { message: String(error?.message ?? error) }));

  // Checking immediately competes with first paint, and there is no hurry.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      send("pu:update-error", { message: String(error?.message ?? error) });
    });
  }, 4000);
}

ipcMain.handle("pu:install-update", () => {
  // Skips the close handler, so the renderer only calls this once the user has
  // dealt with unsaved work.
  autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  protocol.handle("app", serveFromDist);
  createWindow();
  startUpdater(BrowserWindow.getAllWindows()[0]);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
