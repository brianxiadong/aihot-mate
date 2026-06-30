const path = require("node:path");
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, shell, nativeImage, screen, powerMonitor } = require("electron");
const { createStore } = require("./store.cjs");
const { getEnabledAdapters } = require("./sources/registry.cjs");
const { extractReadableArticle, sanitizeContent } = require("./reader.cjs");
const {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  openUpdateReleasePage,
  setUpdateBroadcaster
} = require("./updater.cjs");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const DEFAULT_AUTO_SYNC_MINUTES = 5;
const MIN_AUTO_SYNC_MINUTES = 1;
const STALE_SYNC_MAX_AGE_MS = 60 * 1000;
const MIN_SYNC_TIMER_DELAY_MS = 15 * 1000;

let mainWindow = null;
let petWindow = null;
let miniWindow = null;
let tray = null;
let store = null;
let syncTimer = null;
let petBoundsSaveTimer = null;
let petDragState = null;
let isSyncing = false;
let updateNotificationVersion = null;

function iconPath(fileName) {
  return path.join(__dirname, "../../assets/icons", fileName);
}

function createFallbackTrayImage() {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#0f766e"/>
      <path fill="#fff" d="M16 5l2.3 7.1h7.5l-6 4.3 2.3 7.1-6.1-4.4-6.1 4.4 2.3-7.1-6-4.3h7.5L16 5z"/>
    </svg>`);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function createTrayImage() {
  const image = nativeImage.createFromPath(iconPath("icon-tray.png"));
  if (image.isEmpty()) return createFallbackTrayImage();
  return process.platform === "darwin"
    ? image.resize({ width: 18, height: 18 })
    : image.resize({ width: 32, height: 32 });
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
    icon: iconPath("icon.png"),
    backgroundColor: "#f5f7fb",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
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
  const savedBounds = store.getState().petBounds;
  const width = 248;
  const height = 238;
  const x =
    savedBounds && Number.isFinite(savedBounds.x)
      ? clamp(savedBounds.x, primary.x, primary.x + primary.width - width)
      : primary.x + primary.width - 280;
  const y =
    savedBounds && Number.isFinite(savedBounds.y)
      ? clamp(savedBounds.y, primary.y, primary.y + primary.height - height)
      : primary.y + primary.height - 282;
  petWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    icon: iconPath("icon.png"),
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
      sandbox: false,
      webviewTag: true
    }
  });

  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.on("moved", () => {
    schedulePersistPetBounds();
    if (!petDragState && miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
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
    width: 430,
    height: 580,
    icon: iconPath("icon.png"),
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
      sandbox: false,
      webviewTag: true
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
        click: () => runSyncNow({ notify: true, reason: "manual" }).catch((error) => console.error(error))
      },
      {
        label: "检查更新",
        click: () => checkForUpdates({ autoDownload: true }).catch((error) => console.error(error))
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
  syncIfStale("window-open", { notify: false, maxAgeMs: STALE_SYNC_MAX_AGE_MS });
}

function showMiniWindow(itemId) {
  const window = createMiniWindow(itemId);
  positionMiniWindow();
  window.show();
  window.focus();
  syncIfStale("mini-open", { notify: false, maxAgeMs: STALE_SYNC_MAX_AGE_MS });
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

function persistPetBounds() {
  if (!store || !petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  store.setState((state) => ({
    ...state,
    petBounds: {
      x: bounds.x,
      y: bounds.y
    }
  }));
}

function schedulePersistPetBounds() {
  if (petBoundsSaveTimer) clearTimeout(petBoundsSaveTimer);
  petBoundsSaveTimer = setTimeout(() => {
    petBoundsSaveTimer = null;
    persistPetBounds();
  }, 300);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionMiniWindow(anchorBounds = null) {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const anchor = anchorBounds || (petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : screen.getPrimaryDisplay().workArea);
  const bounds = miniWindow.getBounds();
  const workArea = screen.getDisplayMatching(anchor).workArea;
  const margin = 8;
  const gap = 10;
  const preferredHeight = 580;
  const maxHeight = Math.max(220, Math.min(preferredHeight, workArea.height - margin * 2));
  const minHeight = Math.min(240, maxHeight);
  const width = Math.min(bounds.width, workArea.width - margin * 2);
  const topEdge = workArea.y + margin;
  const bottomEdge = workArea.y + workArea.height - margin;
  const aboveSpace = Math.max(0, anchor.y - gap - topEdge);
  const belowSpace = Math.max(0, bottomEdge - (anchor.y + anchor.height + gap));
  const placeAbove = aboveSpace >= belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  const height = clamp(Math.min(preferredHeight, availableHeight), minHeight, maxHeight);
  const x = clamp(
    Math.round(anchor.x + anchor.width / 2 - width / 2),
    workArea.x + margin,
    workArea.x + workArea.width - width - margin
  );
  const targetY = placeAbove ? anchor.y - height - gap : anchor.y + anchor.height + gap;
  const y = clamp(Math.round(targetY), topEdge, bottomEdge - height);
  miniWindow.setBounds({ x, y, width, height: Math.round(height) });
}

function movePetWindowTo(x, y, bounds = null) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const currentBounds = bounds || petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + currentBounds.width / 2),
    y: Math.round(y + currentBounds.height / 2)
  }).workArea;
  const nextX = clamp(Math.round(x), display.x, display.x + display.width - currentBounds.width);
  const nextY = clamp(Math.round(y), display.y, display.y + display.height - currentBounds.height);
  petWindow.setPosition(nextX, nextY);
  schedulePersistPetBounds();
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
    positionMiniWindow({ ...currentBounds, x: nextX, y: nextY });
  }
}

function startPetDrag(pointerX, pointerY) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petDragState = {
    pointerX: Number(pointerX || 0),
    pointerY: Number(pointerY || 0),
    bounds: petWindow.getBounds()
  };
}

function dragPetTo(pointerX, pointerY) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!petDragState) {
    startPetDrag(pointerX, pointerY);
  }
  const drag = petDragState;
  const currentPointerX = Number(pointerX || 0);
  const currentPointerY = Number(pointerY || 0);
  movePetWindowTo(
    drag.bounds.x + currentPointerX - drag.pointerX,
    drag.bounds.y + currentPointerY - drag.pointerY,
    drag.bounds
  );
}

function endPetDrag() {
  petDragState = null;
  schedulePersistPetBounds();
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

function broadcastUpdateState() {
  const state = getUpdateState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:changed", state);
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("update:changed", state);
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send("update:changed", state);
  }

  if (state.status === "downloaded" && state.latestVersion && updateNotificationVersion !== state.latestVersion) {
    updateNotificationVersion = state.latestVersion;
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "AIHOT Mate 更新已就绪",
        body: `v${state.latestVersion} 已下载并通过签名校验，点击安装。`,
        silent: false
      });
      notification.on("click", () => {
        installUpdate().catch((error) => console.error(error));
      });
      notification.show();
    }
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
      const readIds = state.hasCompletedInitialSync
        ? state.readIds
        : Array.from(new Set([...state.readIds, ...merged.itemOrder]));
      return {
        ...state,
        itemsById: merged.itemsById,
        itemOrder: merged.itemOrder,
        readIds,
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

  if (state.articlesById[itemId] && isUsefulArticle(state.articlesById[itemId], item)) {
    return state.articlesById[itemId];
  }

  if (item.embeddedArticle && isUsefulArticle(item.embeddedArticle, item)) {
    store.setState((current) => ({
      ...current,
      articlesById: {
        ...current.articlesById,
        [itemId]: item.embeddedArticle
      }
    }));
    return item.embeddedArticle;
  }

  let article = null;
  let lastError = null;
  for (const url of articleUrlsForItem(item)) {
    try {
      const candidate = await extractReadableArticle(url);
      if (isUsefulArticle(candidate, item)) {
        article = candidate;
        break;
      }
      lastError = new Error("Extracted article content was too short.");
    } catch (error) {
      lastError = error;
    }
  }

  if (!article) {
    article = buildSummaryArticle(item, state);
  }
  if (!article) {
    throw lastError || new Error("Article content is unavailable.");
  }

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

function articleUrlsForItem(item) {
  const values = item.sourceId === "aihot" ? [item.readerUrl, item.url, item.originalUrl] : [item.originalUrl, item.readerUrl, item.url];
  return Array.from(new Set(values.filter(Boolean)));
}

function isUsefulArticle(article, item) {
  if (!article || !article.content) return false;
  const text = stripHtml(article.content);
  const summary = normalizePlainText(item.summary || "");
  if (!text) return false;
  if (/精选全部日报更多|AI HOT$/i.test(text) && text.length < 220) return false;
  if (summary.length > 120 && text.length < Math.min(summary.length * 0.75, 220)) return false;
  return true;
}

function buildSummaryArticle(item, state) {
  const related = findRelatedItems(item, state).slice(0, 8);
  const parts = [];
  if (item.summary) {
    parts.push("<h2>AI 摘要</h2>");
    parts.push(`<p>${escapeHtml(item.summary)}</p>`);
  }
  if (related.length > 0) {
    parts.push("<h2>同一事件的相关报道</h2>");
    parts.push("<ul>");
    related.forEach((relatedItem) => {
      const label = `${relatedItem.title}${relatedItem.sourceName ? ` - ${relatedItem.sourceName}` : ""}`;
      parts.push(`<li><a href="${escapeAttribute(relatedItem.url || relatedItem.readerUrl || relatedItem.originalUrl)}">${escapeHtml(label)}</a></li>`);
    });
    parts.push("</ul>");
  }
  if (parts.length === 0) return null;
  return {
    title: item.title,
    byline: item.sourceName || item.channel || "",
    excerpt: item.summary || "",
    siteName: item.sourceName || "",
    content: sanitizeContent(parts.join("\n")),
    sourceUrl: item.readerUrl || item.url || item.originalUrl,
    fetchedAt: new Date().toISOString()
  };
}

function findRelatedItems(item, state) {
  const sourceNames = Array.isArray(item.raw?.sourceNames) ? item.raw.sourceNames : [];
  const titleTerms = new Set(
    normalizePlainText(item.title || "")
      .toLowerCase()
      .split(/[\s:：,，.。·\-_/()（）]+/)
      .filter((term) => term.length >= 4)
  );
  return state.itemOrder
    .map((id) => state.itemsById[id])
    .filter(Boolean)
    .filter((candidate) => candidate.id !== item.id)
    .filter((candidate) => {
      if (candidate.sourceId !== item.sourceId) return false;
      if (candidate.externalId === item.externalId) return true;
      if (sourceNames.includes(candidate.sourceName)) return true;
      const candidateText = normalizePlainText(`${candidate.title} ${candidate.summary}`).toLowerCase();
      let matches = 0;
      titleTerms.forEach((term) => {
        if (candidateText.includes(term)) matches += 1;
      });
      return matches >= Math.min(2, titleTerms.size);
    });
}

function stripHtml(value) {
  return normalizePlainText(String(value || "").replace(/<[^>]+>/g, " "));
}

function normalizePlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value || "").replaceAll("`", "&#096;");
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

function markAllRead() {
  store.setState((state) => ({
    ...state,
    readIds: Array.from(new Set([...state.readIds, ...state.itemOrder]))
  }));
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
  return runSyncNow({ notify: false, reason: "source-added" });
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
      refreshMinutes: Math.max(
        MIN_AUTO_SYNC_MINUTES,
        Number(patch.refreshMinutes || state.settings.refreshMinutes || DEFAULT_AUTO_SYNC_MINUTES)
      ),
      notifyMinScore: Math.max(0, Math.min(100, Number(patch.notifyMinScore ?? state.settings.notifyMinScore)))
    }
  }));
  scheduleSync();
  broadcastState();
  return publicState();
}

function autoSyncIntervalMs() {
  const minutes = store ? Number(store.getState().settings.refreshMinutes) : DEFAULT_AUTO_SYNC_MINUTES;
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_AUTO_SYNC_MINUTES;
  return Math.max(MIN_AUTO_SYNC_MINUTES, safeMinutes) * 60 * 1000;
}

function clearSyncTimer() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function scheduleSync(delayMs = autoSyncIntervalMs()) {
  if (!store || app.isQuitting) return;
  clearSyncTimer();
  const safeDelayMs = Math.max(MIN_SYNC_TIMER_DELAY_MS, Number(delayMs) || autoSyncIntervalMs());
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncAllSources({ notify: true, reason: "timer" })
      .catch((error) => console.error(error))
      .finally(() => scheduleSync());
  }, safeDelayMs);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
}

async function runSyncNow(options = {}) {
  if (!store || app.isQuitting) return null;
  clearSyncTimer();
  try {
    return await syncAllSources(options);
  } finally {
    scheduleSync();
  }
}

function syncIfStale(reason, options = {}) {
  if (!store || app.isQuitting || isSyncing) return;
  const lastSyncMs = new Date(store.getState().lastSyncAt || 0).getTime();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : autoSyncIntervalMs();
  if (lastSyncMs > 0 && Date.now() - lastSyncMs < maxAgeMs) return;
  runSyncNow({ notify: Boolean(options.notify), reason }).catch((error) => console.error(error));
}

function registerIpc() {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("content:sync", () => runSyncNow({ notify: true, reason: "manual" }));
  ipcMain.handle("updates:get-state", () => getUpdateState());
  ipcMain.handle("updates:check", (_event, options) => checkForUpdates(options || {}));
  ipcMain.handle("updates:download", () => downloadUpdate());
  ipcMain.handle("updates:install", () => installUpdate());
  ipcMain.handle("updates:open-release", () => openUpdateReleasePage());
  ipcMain.handle("article:load", (_event, itemId) => loadArticle(itemId));
  ipcMain.handle("item:mark-read", (_event, itemId, isRead) => markRead(itemId, isRead));
  ipcMain.handle("item:mark-all-read", () => markAllRead());
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
  ipcMain.on("window:start-pet-drag", (_event, pointerX, pointerY) => {
    startPetDrag(pointerX, pointerY);
  });
  ipcMain.on("window:drag-pet-to", (_event, pointerX, pointerY) => {
    dragPetTo(pointerX, pointerY);
  });
  ipcMain.on("window:end-pet-drag", () => {
    endPetDrag();
  });
  ipcMain.on("window:move-pet-by", (_event, deltaX, deltaY) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    movePetWindowTo(bounds.x + Number(deltaX || 0), bounds.y + Number(deltaY || 0), bounds);
  });
  ipcMain.handle("open:external", (_event, url) => {
    if (!url) return false;
    return shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  store = createStore(app);
  setUpdateBroadcaster(broadcastUpdateState);
  registerIpc();
  createMainWindow();
  createPetWindow();
  createTray();
  scheduleSync();
  runSyncNow({ notify: false, reason: "startup" }).catch((error) => console.error(error));
  setTimeout(() => {
    checkForUpdates({ silent: true, autoDownload: true }).catch((error) => console.error(error));
  }, 12000);
});

app.on("browser-window-focus", () => {
  syncIfStale("window-focus", { notify: false, maxAgeMs: STALE_SYNC_MAX_AGE_MS });
});

powerMonitor.on("resume", () => {
  syncIfStale("resume", { notify: true, maxAgeMs: STALE_SYNC_MAX_AGE_MS });
});

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
});

app.on("activate", () => {
  createPetWindow();
  showMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  clearSyncTimer();
  if (petBoundsSaveTimer) clearTimeout(petBoundsSaveTimer);
  persistPetBounds();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
