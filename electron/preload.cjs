const { contextBridge, ipcRenderer } = require("electron");

// Narrow, explicit surface. The renderer gets file open/save and nothing else.
contextBridge.exposeInMainWorld("puDesktop", {
  open: () => ipcRenderer.invoke("pu:open"),
  save: (filePath, text) => ipcRenderer.invoke("pu:save", { filePath, text }),
  saveAs: (suggestedName, text) => ipcRenderer.invoke("pu:saveAs", { suggestedName, text }),
});
