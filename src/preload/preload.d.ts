export type FeedSource = {
  id: string;
  name: string;
  type: "aihot" | "rss";
  enabled: boolean;
  description?: string;
  feedUrl?: string;
  category?: string;
};

export type FeedItem = {
  id: string;
  externalId: string;
  sourceId: string;
  sourceName: string;
  channel: string;
  title: string;
  summary: string;
  url: string;
  originalUrl?: string;
  readerUrl?: string;
  publishedAt: string | null;
  category: string;
  score: number | null;
  selected: boolean;
  kind: "item" | "hot-topic" | "daily" | "rss";
  sourceCount?: number;
  badges?: string[];
  isRead: boolean;
  isFavorite: boolean;
  isSaved: boolean;
  hasCachedArticle: boolean;
};

export type ReaderArticle = {
  title: string;
  byline: string;
  excerpt: string;
  siteName: string;
  content: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type AppSettings = {
  refreshMinutes: number;
  notificationsEnabled: boolean;
  notifyMinScore: number;
  keywords: string[];
};

export type AppState = {
  version: number;
  lastSyncAt: string | null;
  settings: AppSettings;
  sources: FeedSource[];
  items: FeedItem[];
  counts: {
    total: number;
    unread: number;
    favorites: number;
    saved: number;
  };
};

export type AddRssInput = {
  name: string;
  feedUrl: string;
  category?: string;
};

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  downloadedPath: string | null;
  progress: {
    transferred: number | null;
    total: number | null;
    percent: number | null;
  } | null;
  error: string | null;
};

declare global {
  interface Window {
    aihotMate?: {
      getState: () => Promise<AppState>;
      sync: () => Promise<AppState>;
      getUpdateState: () => Promise<UpdateState>;
      checkForUpdates: (options?: { silent?: boolean; autoDownload?: boolean }) => Promise<UpdateState>;
      downloadUpdate: () => Promise<UpdateState>;
      installUpdate: () => Promise<UpdateState>;
      openUpdateRelease: () => Promise<boolean>;
      loadArticle: (itemId: string) => Promise<ReaderArticle>;
      markRead: (itemId: string, isRead: boolean) => Promise<AppState>;
      markAllRead: () => Promise<AppState>;
      toggleFavorite: (itemId: string) => Promise<AppState>;
      toggleSaved: (itemId: string) => Promise<AppState>;
      addRssSource: (input: AddRssInput) => Promise<AppState>;
      toggleSource: (sourceId: string, enabled: boolean) => Promise<AppState>;
      updateSettings: (patch: Partial<AppSettings>) => Promise<AppState>;
      openExternal: (url: string) => Promise<boolean>;
      openMain: (itemId?: string) => Promise<boolean>;
      openMini: (itemId?: string) => Promise<boolean>;
      closeMini: () => Promise<boolean>;
      startPetDrag: (pointerX: number, pointerY: number) => void;
      dragPetTo: (pointerX: number, pointerY: number) => void;
      endPetDrag: () => void;
      movePetBy: (deltaX: number, deltaY: number) => void;
      onStateChanged: (callback: (state: AppState) => void) => () => void;
      onFocusItem: (callback: (itemId: string) => void) => () => void;
      onMiniFocusItem: (callback: (itemId: string) => void) => () => void;
      onUpdateChanged: (callback: (state: UpdateState) => void) => () => void;
    };
  }
}
