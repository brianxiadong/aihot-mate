const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aihotMate", {
  getState: () => ipcRenderer.invoke("state:get"),
  sync: () => ipcRenderer.invoke("content:sync"),
  loadArticle: (itemId) => ipcRenderer.invoke("article:load", itemId),
  markRead: (itemId, isRead) => ipcRenderer.invoke("item:mark-read", itemId, isRead),
  markAllRead: () => ipcRenderer.invoke("item:mark-all-read"),
  toggleFavorite: (itemId) => ipcRenderer.invoke("item:toggle-favorite", itemId),
  toggleSaved: (itemId) => ipcRenderer.invoke("item:toggle-saved", itemId),
  addRssSource: (input) => ipcRenderer.invoke("sources:add-rss", input),
  toggleSource: (sourceId, enabled) => ipcRenderer.invoke("sources:toggle", sourceId, enabled),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  openMain: (itemId) => ipcRenderer.invoke("window:open-main", itemId),
  openMini: (itemId) => ipcRenderer.invoke("window:open-mini", itemId),
  closeMini: () => ipcRenderer.invoke("window:close-mini"),
  movePetBy: (deltaX, deltaY) => ipcRenderer.send("window:move-pet-by", deltaX, deltaY),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onFocusItem: (callback) => {
    const listener = (_event, itemId) => callback(itemId);
    ipcRenderer.on("item:focus", listener);
    return () => ipcRenderer.removeListener("item:focus", listener);
  },
  onMiniFocusItem: (callback) => {
    const listener = (_event, itemId) => callback(itemId);
    ipcRenderer.on("mini:item-focus", listener);
    return () => ipcRenderer.removeListener("mini:item-focus", listener);
  }
});
