const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    hasCompletedInitialSync: false,
    lastSyncAt: null,
    itemsById: {},
    itemOrder: [],
    articlesById: {},
    readIds: [],
    favoriteIds: [],
    savedIds: [],
    petBounds: null,
    etags: {},
    settings: {
      refreshMinutes: 10,
      notificationsEnabled: true,
      notifyMinScore: 78,
      keywords: ["OpenAI", "Claude", "Anthropic", "Google", "Meta", "Agent", "Sora"]
    },
    sources: [
      {
        id: "aihot",
        name: "AIHOT",
        type: "aihot",
        enabled: true,
        description: "AIHOT selected items, hot topics, and daily report."
      }
    ]
  };
}

function createStore(app) {
  const userData = app.getPath("userData");
  ensureDir(userData);
  const statePath = path.join(userData, "state.json");
  let state = loadState(statePath);

  function loadState(file) {
    if (!fs.existsSync(file)) {
      return defaultState();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return migrateState(parsed);
    } catch (error) {
      const backup = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, backup);
      return defaultState();
    }
  }

  function migrateState(current) {
    const base = defaultState();
    return {
      ...base,
      ...current,
      settings: { ...base.settings, ...(current.settings || {}) },
      sources: Array.isArray(current.sources) && current.sources.length > 0 ? current.sources : base.sources,
      itemsById: current.itemsById || {},
      itemOrder: Array.isArray(current.itemOrder) ? current.itemOrder : [],
      articlesById: current.articlesById || {},
      readIds: Array.isArray(current.readIds) ? current.readIds : [],
      favoriteIds: Array.isArray(current.favoriteIds) ? current.favoriteIds : [],
      savedIds: Array.isArray(current.savedIds) ? current.savedIds : [],
      petBounds: current.petBounds || null,
      etags: current.etags || {}
    };
  }

  function save() {
    const temp = `${statePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temp, statePath);
  }

  function getState() {
    return state;
  }

  function setState(updater) {
    const next = typeof updater === "function" ? updater(state) : updater;
    state = migrateState(next);
    save();
    return state;
  }

  return {
    getState,
    setState,
    save,
    statePath
  };
}

module.exports = {
  createStore,
  defaultState
};
