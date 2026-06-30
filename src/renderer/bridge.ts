import type { AddRssInput, AppSettings, AppState, ReaderArticle, UpdateState } from "../preload/preload";

type MateBridge = NonNullable<Window["aihotMate"]>;

const sampleState: AppState = {
  version: 1,
  lastSyncAt: new Date().toISOString(),
  settings: {
    refreshMinutes: 5,
    notificationsEnabled: true,
    notifyMinScore: 78,
    keywords: ["OpenAI", "Claude", "Agent"]
  },
  sources: [
    {
      id: "aihot",
      name: "AIHOT",
      type: "aihot",
      enabled: true,
      description: "AIHOT selected items, hot topics, and daily report."
    },
    {
      id: "sample-rss",
      name: "Official RSS",
      type: "rss",
      enabled: true,
      feedUrl: "https://example.com/feed.xml",
      description: "Custom RSS source."
    }
  ],
  items: [
    {
      id: "preview:hot:meta",
      externalId: "meta",
      sourceId: "aihot",
      sourceName: "AIHOT",
      channel: "当前热点",
      title: "Meta 发布 Brain2Qwerty v2：非侵入式实时句子解码",
      summary: "4 个来源正在报道：AI at Meta、DAIR.AI、宝玉、小互。",
      url: "https://aihot.virxact.com/",
      originalUrl: "https://aihot.virxact.com/",
      readerUrl: "https://aihot.virxact.com/",
      publishedAt: new Date().toISOString(),
      category: "hot",
      score: null,
      selected: true,
      kind: "hot-topic",
      sourceCount: 4,
      badges: ["热点", "4 来源"],
      isRead: false,
      isFavorite: false,
      isSaved: false,
      hasCachedArticle: true
    },
    {
      id: "preview:item:claude",
      externalId: "claude",
      sourceId: "aihot",
      sourceName: "AIHOT",
      channel: "AIHOT 精选",
      title: "Claude apps gateway 支持 Amazon Bedrock 和 Google Cloud",
      summary: "Anthropic 推出自托管控制平面，让企业在 Bedrock 和 Google Cloud 上统一运行 Claude Code。",
      url: "https://aihot.virxact.com/",
      originalUrl: "https://claude.com/",
      readerUrl: "https://aihot.virxact.com/",
      publishedAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
      category: "ai-products",
      score: 82,
      selected: true,
      kind: "item",
      badges: ["精选"],
      isRead: false,
      isFavorite: true,
      isSaved: false,
      hasCachedArticle: true
    },
    {
      id: "preview:rss:openai",
      externalId: "openai",
      sourceId: "sample-rss",
      sourceName: "Official RSS",
      channel: "Official RSS",
      title: "OpenAI 发布新的开发者平台更新",
      summary: "示例 RSS 来源条目，展示非 AIHOT 通道进入统一信息流后的阅读体验。",
      url: "https://openai.com/",
      originalUrl: "https://openai.com/",
      readerUrl: "https://openai.com/",
      publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
      category: "rss",
      score: null,
      selected: false,
      kind: "rss",
      badges: ["RSS"],
      isRead: true,
      isFavorite: false,
      isSaved: true,
      hasCachedArticle: true
    }
  ],
  counts: {
    total: 3,
    unread: 2,
    favorites: 1,
    saved: 1
  }
};

let fallbackState = sampleState;

const fallbackUpdateState: UpdateState = {
  status: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  releaseUrl: null,
  assetName: null,
  downloadedPath: null,
  progress: null,
  error: null
};

const fallbackArticles: Record<string, ReaderArticle> = {
  "preview:hot:meta": {
    title: sampleState.items[0].title,
    byline: "AIHOT",
    excerpt: sampleState.items[0].summary,
    siteName: "AIHOT",
    sourceUrl: sampleState.items[0].url,
    fetchedAt: new Date().toISOString(),
    content:
      "<p>这是浏览器预览内容。Electron 运行时会通过主进程同步真实来源、缓存文章正文，并在桌面内呈现可读正文。</p><p>热点条目会合并多个来源，提醒策略优先处理高分、多源和关键词命中的内容。</p>"
  },
  "preview:item:claude": {
    title: sampleState.items[1].title,
    byline: "Anthropic",
    excerpt: sampleState.items[1].summary,
    siteName: "AIHOT",
    sourceUrl: sampleState.items[1].url,
    fetchedAt: new Date().toISOString(),
    content:
      "<p>Claude apps gateway 是一个企业控制平面示例。第一版桌面伴侣会优先读取站内 permalink 或 RSS 正文，抽取后缓存到本地。</p><h2>桌面阅读</h2><p>当来源只公开摘要时，阅读器保留摘要，并提供原文入口。</p>"
  },
  "preview:rss:openai": {
    title: sampleState.items[2].title,
    byline: "Official RSS",
    excerpt: sampleState.items[2].summary,
    siteName: "Official RSS",
    sourceUrl: sampleState.items[2].url,
    fetchedAt: new Date().toISOString(),
    content:
      "<p>通用 RSS 适配器让后续来源不用改界面即可进入统一信息流。每个来源输出同一种 FeedItem 结构。</p>"
  }
};

function recalcCounts(state: AppState): AppState {
  return {
    ...state,
    counts: {
      total: state.items.length,
      unread: state.items.filter((item) => !item.isRead).length,
      favorites: state.items.filter((item) => item.isFavorite).length,
      saved: state.items.filter((item) => item.isSaved).length
    }
  };
}

const browserFallback: MateBridge = {
  getState: async () => fallbackState,
  sync: async () => {
    fallbackState = { ...fallbackState, lastSyncAt: new Date().toISOString() };
    return fallbackState;
  },
  getUpdateState: async () => fallbackUpdateState,
  checkForUpdates: async () => fallbackUpdateState,
  downloadUpdate: async () => fallbackUpdateState,
  installUpdate: async () => fallbackUpdateState,
  openUpdateRelease: async () => true,
  loadArticle: async (itemId: string) => fallbackArticles[itemId] || fallbackArticles["preview:hot:meta"],
  markRead: async (itemId: string, isRead: boolean) => {
    fallbackState = recalcCounts({
      ...fallbackState,
      items: fallbackState.items.map((item) => (item.id === itemId ? { ...item, isRead } : item))
    });
    return fallbackState;
  },
  markAllRead: async () => {
    fallbackState = recalcCounts({
      ...fallbackState,
      items: fallbackState.items.map((item) => ({ ...item, isRead: true }))
    });
    return fallbackState;
  },
  toggleFavorite: async (itemId: string) => {
    fallbackState = recalcCounts({
      ...fallbackState,
      items: fallbackState.items.map((item) =>
        item.id === itemId ? { ...item, isFavorite: !item.isFavorite } : item
      )
    });
    return fallbackState;
  },
  toggleSaved: async (itemId: string) => {
    fallbackState = recalcCounts({
      ...fallbackState,
      items: fallbackState.items.map((item) => (item.id === itemId ? { ...item, isSaved: !item.isSaved } : item))
    });
    return fallbackState;
  },
  addRssSource: async (input: AddRssInput) => {
    fallbackState = {
      ...fallbackState,
      sources: [
        ...fallbackState.sources,
        {
          id: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rss",
          name: input.name,
          type: "rss",
          enabled: true,
          feedUrl: input.feedUrl,
          category: input.category || "rss"
        }
      ]
    };
    return fallbackState;
  },
  toggleSource: async (sourceId: string, enabled: boolean) => {
    fallbackState = {
      ...fallbackState,
      sources: fallbackState.sources.map((source) => (source.id === sourceId ? { ...source, enabled } : source))
    };
    return fallbackState;
  },
  updateSettings: async (patch: Partial<AppSettings>) => {
    fallbackState = { ...fallbackState, settings: { ...fallbackState.settings, ...patch } };
    return fallbackState;
  },
  openExternal: async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  },
  openMain: async () => true,
  openMini: async () => true,
  closeMini: async () => true,
  startPetDrag: () => undefined,
  dragPetTo: () => undefined,
  endPetDrag: () => undefined,
  movePetBy: () => undefined,
  onStateChanged: () => () => undefined,
  onFocusItem: () => () => undefined,
  onMiniFocusItem: () => () => undefined,
  onUpdateChanged: () => () => undefined
};

export const mate: MateBridge = window.aihotMate ?? browserFallback;
