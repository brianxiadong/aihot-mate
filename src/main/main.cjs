const path = require("node:path");
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, shell, nativeImage, screen } = require("electron");
const { createStore } = require("./store.cjs");
const { getEnabledAdapters } = require("./sources/registry.cjs");
const { extractReadableArticle } = require("./reader.cjs");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow = null;
let petWindow = null;
let miniWindow = null;
let tray = null;
let store = null;
let syncTimer = null;
let isSyncing = false;

function createTrayImage() {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#0f766e"/>
      <path fill="#fff" d="M16 5l2.3 7.1h7.5l-6 4.3 2.3 7.1-6.1-4.4-6.1 4.4 2.3-7.1-6-4.3h7.5L16 5z"/>
    </svg>`);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function rendererUrl(surface, params = {}) {
  const search = new URLSearchParams({ surface, ...params }).toString();
  if (isDev) {
    return `http://127.0.0.1:5173?${search}`;
  }
  return { file: path.join(__dirname, "../../dist/index.html"), query: { surface, ...params } };
}

function loadRenderer(window, surface, params = {}) {
  const target = rendererUrl(surface, params);
  if (typeof target === "string") {
    return window.loadURL(target);
  }
  return window.loadFile(target.file, { query: target.query });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: "AIHOT Mate",
    backgroundColor: "#f5f7fb",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  loadRenderer(mainWindow, "main");
  return mainWindow;
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const primary = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    width: 176,
    height: 176,
    x: primary.x + primary.width - 208,
    y: primary.y + primary.height - 220,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "AIHOT Mate Pet",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.on("moved", () => {
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
      positionMiniWindow();
    }
  });
  petWindow.on("closed", () => {
    petWindow = null;
  });
  loadRenderer(petWindow, "pet");
  return petWindow;
}

function createMiniWindow(itemId) {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;
  miniWindow = new BrowserWindow({
    width: 382,
    height: 462,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "AIHOT Mate Mini Reader",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  miniWindow.setAlwaysOnTop(true, "floating");
  miniWindow.on("blur", () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.hide();
    }
  });
  miniWindow.on("closed", () => {
    miniWindow = null;
  });
  loadRenderer(miniWindow, "mini", itemId ? { itemId } : {});
  return miniWindow;
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip("AIHOT Mate");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 AIHOT Mate",
        click: () => showMainWindow()
      },
      {
        label: "立即同步",
        click: () => syncAllSources({ notify: true, reason: "manual" })
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("click", () => showMainWindow());
}

function showMainWindow() {
  createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showMiniWindow(itemId) {
  const window = createMiniWindow(itemId);
  positionMiniWindow();
  window.show();
  window.focus();
  if (itemId) {
    window.webContents.send("mini:item-focus", itemId);
  }
  return true;
}

function hideMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.hide();
  }
  return true;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const anchor = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : screen.getPrimaryDisplay().workArea;
  const bounds = miniWindow.getBounds();
  const workArea = screen.getDisplayMatching(anchor).workArea;
  const x = clamp(
    Math.round(anchor.x + anchor.width / 2 - bounds.width / 2),
    workArea.x + 8,
    workArea.x + workArea.width - bounds.width - 8
  );
  let y = Math.round(anchor.y - bounds.height - 10);
  if (y < workArea.y + 8) {
    y = Math.round(anchor.y + anchor.height + 10);
  }
  y = clamp(y, workArea.y + 8, workArea.y + workArea.height - bounds.height - 8);
  miniWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
}

function publicState() {
  const state = store.getState();
  const readIds = new Set(state.readIds);
  const favoriteIds = new Set(state.favoriteIds);
  const savedIds = new Set(state.savedIds);

  const items = state.itemOrder
    .map((id) => state.itemsById[id])
    .filter(Boolean)
    .map((item) => ({
      ...item,
      isRead: readIds.has(item.id),
      isFavorite: favoriteIds.has(item.id),
      isSaved: savedIds.has(item.id),
      hasCachedArticle: Boolean(state.articlesById[item.id] || item.embeddedArticle)
    }));

  return {
    version: state.version,
    lastSyncAt: state.lastSyncAt,
    settings: state.settings,
    sources: state.sources,
    items,
    counts: {
      total: items.length,
      unread: items.filter((item) => !item.isRead).length,
      favorites: favoriteIds.size,
      saved: savedIds.size
    }
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", publicState());
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("state:changed", publicState());
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send("state:changed", publicState());
  }
}

function upsertItems(existingState, incomingItems) {
  const itemsById = { ...existingState.itemsById };
  const knownIds = new Set(existingState.itemOrder);
  const newIds = [];

  for (const item of incomingItems) {
    if (!item || !item.id) continue;
    if (!itemsById[item.id]) {
      newIds.push(item.id);
    }
    itemsById[item.id] = {
      ...itemsById[item.id],
      ...item,
      updatedAt: new Date().toISOString()
    };
    knownIds.add(item.id);
  }

  const orderedIds = Array.from(knownIds)
    .filter((id) => itemsById[id])
    .sort((left, right) => {
      const leftTime = new Date(itemsById[left].publishedAt || 0).getTime();
      const rightTime = new Date(itemsById[right].publishedAt || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 600);

  const orderedSet = new Set(orderedIds);
  Object.keys(itemsById).forEach((id) => {
    if (!orderedSet.has(id)) delete itemsById[id];
  });

  return { itemsById, itemOrder: orderedIds, newIds };
}

function shouldNotify(item, settings) {
  if (!settings.notificationsEnabled) return false;
  if (item.kind === "hot-topic") return true;
  if (typeof item.score === "number" && item.score >= settings.notifyMinScore) return true;
  const haystack = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return (settings.keywords || []).some((keyword) => keyword && haystack.includes(String(keyword).toLowerCase()));
}

function sendNotifications(newItems, state) {
  if (!Notification.isSupported()) return;
  const important = newItems.filter((item) => shouldNotify(item, state.settings)).slice(0, 4);
  for (const item of important) {
    const notification = new Notification({
      title: item.kind === "hot-topic" ? "AI 圈新热点" : "AIHOT Mate 有新内容",
      body: item.title,
      silent: false
    });
    notification.on("click", () => {
      showMiniWindow(item.id);
    });
    notification.show();
  }
}

async function syncAllSources(options = {}) {
  if (isSyncing) return publicState();
  isSyncing = true;

  try {
    const current = store.getState();
    const adapters = getEnabledAdapters(current.sources);
    const allItems = [];
    const nextEtags = { ...current.etags };

    for (const adapter of adapters) {
      const result = await adapter.sync({
        etags: nextEtags,
        log: (message) => console.warn(message)
      });
      allItems.push(...result.items);
      Object.assign(nextEtags, result.etags || {});
    }

    let newItems = [];
    store.setState((state) => {
      const merged = upsertItems(state, allItems);
      newItems = merged.newIds.map((id) => merged.itemsById[id]).filter(Boolean);
      return {
        ...state,
        itemsById: merged.itemsById,
        itemOrder: merged.itemOrder,
        etags: nextEtags,
        lastSyncAt: new Date().toISOString(),
        hasCompletedInitialSync: true
      };
    });

    const updated = store.getState();
    if ((options.notify || updated.hasCompletedInitialSync) && current.hasCompletedInitialSync) {
      sendNotifications(newItems, updated);
    }

    broadcastState();
    return publicState();
  } finally {
    isSyncing = false;
  }
}

async function loadArticle(itemId) {
  const state = store.getState();
  const item = state.itemsById[itemId];
  if (!item) {
    throw new Error("Item not found.");
  }

  if (state.articlesById[itemId]) {
    return state.articlesById[itemId];
  }

  if (item.embeddedArticle) {
    store.setState((current) => ({
      ...current,
      articlesById: {
        ...current.articlesById,
        [itemId]: item.embeddedArticle
      }
    }));
    return item.embeddedArticle;
  }

  const article = await extractReadableArticle(item.readerUrl || item.url || item.originalUrl);
  store.setState((current) => ({
    ...current,
    articlesById: {
      ...current.articlesById,
      [itemId]: article
    }
  }));
  broadcastState();
  return article;
}

function toggleSetField(field, itemId) {
  store.setState((state) => {
    const set = new Set(state[field]);
    if (set.has(itemId)) set.delete(itemId);
    else set.add(itemId);
    return { ...state, [field]: Array.from(set) };
  });
  broadcastState();
  return publicState();
}

function markRead(itemId, isRead = true) {
  store.setState((state) => {
    const set = new Set(state.readIds);
    if (isRead) set.add(itemId);
    else set.delete(itemId);
    return { ...state, readIds: Array.from(set) };
  });
  broadcastState();
  return publicState();
}

function addRssSource(input) {
  const name = String(input.name || "").trim();
  const feedUrl = String(input.feedUrl || "").trim();
  if (!name || !feedUrl) {
    throw new Error("RSS source name and URL are required.");
  }

  const parsed = new URL(feedUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("RSS source URL must use http or https.");
  }

  store.setState((state) => {
    const idBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rss";
    let id = idBase;
    let index = 1;
    const existing = new Set(state.sources.map((source) => source.id));
    while (existing.has(id)) {
      index += 1;
      id = `${idBase}-${index}`;
    }

    return {
      ...state,
      sources: [
        ...state.sources,
        {
          id,
          name,
          type: "rss",
          enabled: true,
          feedUrl,
          category: input.category || "rss",
          description: "Custom RSS source."
        }
      ]
    };
  });
  broadcastState();
  return syncAllSources({ notify: false, reason: "source-added" });
}

function toggleSource(sourceId, enabled) {
  store.setState((state) => ({
    ...state,
    sources: state.sources.map((source) => (source.id === sourceId ? { ...source, enabled: Boolean(enabled) } : source))
  }));
  broadcastState();
  return publicState();
}

function updateSettings(patch) {
  store.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      ...patch,
      refreshMinutes: Math.max(3, Number(patch.refreshMinutes || state.settings.refreshMinutes || 10)),
      notifyMinScore: Math.max(0, Math.min(100, Number(patch.notifyMinScore ?? state.settings.notifyMinScore)))
    }
  }));
  scheduleSync();
  broadcastState();
  return publicState();
}

function scheduleSync() {
  if (syncTimer) clearInterval(syncTimer);
  const minutes = store ? store.getState().settings.refreshMinutes : 10;
  syncTimer = setInterval(() => {
    syncAllSources({ notify: true, reason: "timer" }).catch((error) => console.error(error));
  }, Math.max(3, minutes) * 60 * 1000);
}

function registerIpc() {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("content:sync", () => syncAllSources({ notify: true, reason: "manual" }));
  ipcMain.handle("article:load", (_event, itemId) => loadArticle(itemId));
  ipcMain.handle("item:mark-read", (_event, itemId, isRead) => markRead(itemId, isRead));
  ipcMain.handle("item:toggle-favorite", (_event, itemId) => toggleSetField("favoriteIds", itemId));
  ipcMain.handle("item:toggle-saved", (_event, itemId) => toggleSetField("savedIds", itemId));
  ipcMain.handle("sources:add-rss", (_event, input) => addRssSource(input));
  ipcMain.handle("sources:toggle", (_event, sourceId, enabled) => toggleSource(sourceId, enabled));
  ipcMain.handle("settings:update", (_event, patch) => updateSettings(patch));
  ipcMain.handle("window:open-main", (_event, itemId) => {
    showMainWindow();
    if (itemId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("item:focus", itemId);
    }
    return true;
  });
  ipcMain.handle("window:open-mini", (_event, itemId) => showMiniWindow(itemId));
  ipcMain.handle("window:close-mini", () => hideMiniWindow());
  ipcMain.on("window:move-pet-by", (_event, deltaX, deltaY) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayMatching(bounds).workArea;
    const x = clamp(Math.round(bounds.x + Number(deltaX || 0)), display.x, display.x + display.width - bounds.width);
    const y = clamp(Math.round(bounds.y + Number(deltaY || 0)), display.y, display.y + display.height - bounds.height);
    petWindow.setPosition(x, y);
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
      positionMiniWindow();
    }
  });
  ipcMain.handle("open:external", (_event, url) => {
    if (!url) return false;
    return shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  store = createStore(app);
  registerIpc();
  createMainWindow();
  createPetWindow();
  createTray();
  scheduleSync();
  await syncAllSources({ notify: false, reason: "startup" });
});

app.on("activate", () => {
  createPetWindow();
  showMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (syncTimer) clearInterval(syncTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
