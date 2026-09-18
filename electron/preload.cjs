const { contextBridge, ipcRenderer } = require("electron");

// Narrow, explicit surface: file open/save, plus what the main process needs to
// guard the window close.
contextBridge.exposeInMainWorld("puDesktop", {
  open: () => ipcRenderer.invoke("pu:open"),
  save: (filePath, text) => ipcRenderer.invoke("pu:save", { filePath, text }),
  saveAs: (suggestedName, text) => ipcRenderer.invoke("pu:saveAs", { suggestedName, text }),

  setDirty: (dirty) => ipcRenderer.send("pu:dirty", dirty),

  /** Called when the user picks "Save" in the close prompt. */
  onRequestSave: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("pu:request-save", listener);
    return () => ipcRenderer.removeListener("pu:request-save", listener);
  },

  reportSaveFinished: (saved) => ipcRenderer.send("pu:save-finished", saved),
});
