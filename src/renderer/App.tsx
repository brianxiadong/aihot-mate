import {
  Bell,
  BellOff,
  Bookmark,
  Check,
  FileText,
  Clock3,
  ExternalLink,
  Flame,
  Globe2,
  Inbox,
  Layers3,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Sparkles,
  Star,
  X
} from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import type { AddRssInput, AppSettings, AppState, FeedItem, ReaderArticle } from "../preload/preload";
import { mate } from "./bridge";

type ViewKey = "latest" | "hot" | "unread" | "favorites" | "saved" | "ai-models" | "ai-products" | "paper" | "industry" | "tip";

type ArticleStatus = "idle" | "loading" | "ready" | "error";
type ReaderMode = "article" | "source";

const categoryLabels: Record<string, string> = {
  "ai-models": "模型",
  "ai-products": "产品",
  industry: "行业",
  paper: "论文",
  tip: "观点",
  hot: "热点",
  daily: "日报",
  rss: "RSS"
};

const viewItems: Array<{ key: ViewKey; label: string; icon: typeof Inbox }> = [
  { key: "latest", label: "最新", icon: Inbox },
  { key: "hot", label: "热点", icon: Flame },
  { key: "unread", label: "未读", icon: Sparkles },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "saved", label: "稍后读", icon: Bookmark },
  { key: "ai-models", label: "模型", icon: Layers3 },
  { key: "ai-products", label: "产品", icon: Layers3 },
  { key: "paper", label: "论文", icon: Newspaper },
  { key: "industry", label: "行业", icon: Newspaper },
  { key: "tip", label: "观点", icon: Newspaper }
];

const initialState: AppState = {
  version: 1,
  lastSyncAt: null,
  settings: {
    refreshMinutes: 10,
    notificationsEnabled: true,
    notifyMinScore: 78,
    keywords: []
  },
  sources: [],
  items: [],
  counts: {
    total: 0,
    unread: 0,
    favorites: 0,
    saved: 0
  }
};

function formatRelativeTime(value: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days <= 2) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatFullTime(value: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function itemMatchesView(item: FeedItem, view: ViewKey) {
  if (view === "latest") return true;
  if (view === "hot") return item.kind === "hot-topic" || item.category === "hot";
  if (view === "unread") return !item.isRead;
  if (view === "favorites") return item.isFavorite;
  if (view === "saved") return item.isSaved;
  return item.category === view;
}

function scoreTone(score: number | null) {
  if (score === null) return "score muted";
  if (score >= 80) return "score high";
  if (score >= 68) return "score medium";
  return "score";
}

function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [articleStatus, setArticleStatus] = useState<ArticleStatus>("idle");
  const [readerMode, setReaderMode] = useState<ReaderMode>("article");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("latest");
  const [isSyncing, setIsSyncing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rssInput, setRssInput] = useState<AddRssInput>({ name: "", feedUrl: "", category: "rss" });
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(initialState.settings);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mate.getState().then((nextState) => {
      setState(nextState);
      setSettingsDraft(nextState.settings);
      if (!selectedId && nextState.items[0]) {
        setSelectedId(nextState.items[0].id);
      }
    });

    const offState = mate.onStateChanged((nextState) => {
      setState(nextState);
      setSettingsDraft(nextState.settings);
      if (!selectedId && nextState.items[0]) {
        setSelectedId(nextState.items[0].id);
      }
    });

    const offFocus = mate.onFocusItem((itemId) => {
      setSelectedId(itemId);
    });

    return () => {
      offState();
      offFocus();
    };
  }, [selectedId]);

  const selectedItem = useMemo(
    () => state.items.find((item) => item.id === selectedId) || state.items[0] || null,
    [selectedId, state.items]
  );

  useEffect(() => {
    if (!selectedItem) {
      setArticle(null);
      setArticleStatus("idle");
      return;
    }

    let canceled = false;
    setArticle(null);
    setArticleStatus("loading");
    setReaderMode("article");
    mate.markRead(selectedItem.id, true).then(setState).catch(() => undefined);
    mate
      .loadArticle(selectedItem.id)
      .then((nextArticle) => {
        if (!canceled) {
          setArticle(nextArticle);
          setArticleStatus("ready");
        }
      })
      .catch((loadError) => {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : "正文加载失败");
          setArticleStatus("error");
        }
      });

    return () => {
      canceled = true;
    };
  }, [selectedItem?.id]);

  const filteredItems = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return state.items.filter((item) => {
      if (!itemMatchesView(item, view)) return false;
      if (!lowerQuery) return true;
      return `${item.title} ${item.summary} ${item.sourceName} ${item.channel}`.toLowerCase().includes(lowerQuery);
    });
  }, [query, state.items, view]);

  useEffect(() => {
    if (!selectedItem && filteredItems[0]) {
      setSelectedId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItem]);

  async function handleSync() {
    setIsSyncing(true);
    setError(null);
    try {
      setState(await mate.sync());
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步失败");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleToggleFavorite(item: FeedItem) {
    setState(await mate.toggleFavorite(item.id));
  }

  async function handleToggleSaved(item: FeedItem) {
    setState(await mate.toggleSaved(item.id));
  }

  async function handleSettingsSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keywords = Array.isArray(settingsDraft.keywords)
      ? settingsDraft.keywords
      : String(settingsDraft.keywords || "")
          .split(",")
          .map((keyword) => keyword.trim())
          .filter(Boolean);
    setState(await mate.updateSettings({ ...settingsDraft, keywords }));
  }

  async function handleAddRss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setState(await mate.addRssSource(rssInput));
      setRssInput({ name: "", feedUrl: "", category: "rss" });
    } catch (rssError) {
      setError(rssError instanceof Error ? rssError.message : "RSS 添加失败");
    }
  }

  function handleArticleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor instanceof HTMLAnchorElement && anchor.href) {
      event.preventDefault();
      mate.openExternal(anchor.href);
    }
  }

  function embeddedSourceUrl(item: FeedItem) {
    return item.originalUrl || item.readerUrl || item.url;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>AIHOT Mate</strong>
            <span>{state.counts.unread} 未读</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="内容视图">
          {viewItems.map((item) => {
            const Icon = item.icon;
            const count = countForView(state.items, item.key);
            return (
              <button
                key={item.key}
                className={view === item.key ? "nav-item active" : "nav-item"}
                type="button"
                title={item.label}
                onClick={() => setView(item.key)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </nav>

        <section className="source-panel" aria-label="来源">
          <div className="panel-heading">
            <Rss size={16} />
            <span>来源</span>
          </div>
          {state.sources.map((source) => (
            <label className="source-row" key={source.id}>
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={(event) => mate.toggleSource(source.id, event.target.checked).then(setState)}
              />
              <span>
                <strong>{source.name}</strong>
                <small>{source.type.toUpperCase()}</small>
              </span>
            </label>
          ))}
        </section>

        <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} title="设置">
          <Settings size={17} />
          <span>设置</span>
        </button>
      </aside>

      <section className="feed-pane">
        <header className="feed-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要、来源" />
          </div>
          <button className="icon-button primary" type="button" title="立即同步" onClick={handleSync} disabled={isSyncing}>
            <RefreshCw size={17} className={isSyncing ? "spin" : ""} />
          </button>
        </header>

        <div className="feed-meta">
          <span>{filteredItems.length} 条</span>
          <span>最近同步 {state.lastSyncAt ? formatRelativeTime(state.lastSyncAt) : "尚未同步"}</span>
        </div>

        {error ? (
          <div className="error-strip">
            <span>{error}</span>
            <button type="button" title="关闭" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div className="feed-list">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className={selectedItem?.id === item.id ? "feed-card selected" : item.isRead ? "feed-card read" : "feed-card"}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="feed-card-top">
                <span className="source-name">{item.sourceName}</span>
                <span>{formatRelativeTime(item.publishedAt)}</span>
              </div>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <div className="feed-card-bottom">
                <span className="category-pill">{categoryLabels[item.category] || item.category}</span>
                {item.badges?.slice(0, 2).map((badge) => (
                  <span className="badge" key={badge}>
                    {badge}
                  </span>
                ))}
                {item.score !== null ? <span className={scoreTone(item.score)}>{item.score}</span> : null}
              </div>
            </article>
          ))}
          {filteredItems.length === 0 ? (
            <div className="empty-state">
              <Inbox size={28} />
              <span>暂无内容</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="reader-pane">
        {selectedItem ? (
          <>
            <header className="reader-header">
              <div>
                <div className="reader-kicker">
                  <span>{selectedItem.sourceName}</span>
                  <span>{formatFullTime(selectedItem.publishedAt)}</span>
                </div>
                <h1>{selectedItem.title}</h1>
              </div>
              <div className="reader-actions">
                <button
                  className={selectedItem.isFavorite ? "icon-button active" : "icon-button"}
                  type="button"
                  title="收藏"
                  onClick={() => handleToggleFavorite(selectedItem)}
                >
                  <Star size={18} />
                </button>
                <button
                  className={selectedItem.isSaved ? "icon-button active" : "icon-button"}
                  type="button"
                  title="稍后读"
                  onClick={() => handleToggleSaved(selectedItem)}
                >
                  <Bookmark size={18} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="浏览器打开"
                  onClick={() => mate.openExternal(selectedItem.url)}
                >
                  <ExternalLink size={18} />
                </button>
              </div>
            </header>

            <div className="reader-summary">
              <span className="category-pill">{categoryLabels[selectedItem.category] || selectedItem.category}</span>
              {selectedItem.score !== null ? <span className={scoreTone(selectedItem.score)}>{selectedItem.score}</span> : null}
              <button
                className={readerMode === "article" ? "reader-mode-button active" : "reader-mode-button"}
                type="button"
                onClick={() => setReaderMode("article")}
              >
                <FileText size={15} />
                <span>阅读版</span>
              </button>
              <button
                className={readerMode === "source" ? "reader-mode-button active" : "reader-mode-button"}
                type="button"
                onClick={() => setReaderMode("source")}
              >
                <Globe2 size={15} />
                <span>原网页</span>
              </button>
              {selectedItem.originalUrl && selectedItem.originalUrl !== selectedItem.url ? (
                <button type="button" onClick={() => mate.openExternal(selectedItem.originalUrl || selectedItem.url)}>
                  原文
                </button>
              ) : null}
            </div>

            {readerMode === "source" ? (
              <div className="embedded-reader">
                <webview
                  className="embedded-webview"
                  src={embeddedSourceUrl(selectedItem)}
                  partition="persist:aihot-mate-reader"
                  webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
                />
              </div>
            ) : (
              <article className="article-body" onClick={handleArticleClick}>
                {articleStatus === "loading" ? (
                  <div className="loading-state">
                    <Loader2 size={22} className="spin" />
                    <span>加载正文</span>
                  </div>
                ) : null}
                {articleStatus === "error" ? (
                  <div className="fallback-body">
                    <p>{selectedItem.summary}</p>
                    <button type="button" onClick={() => setReaderMode("source")}>
                      <Globe2 size={16} />
                      <span>在伴侣内看原网页</span>
                    </button>
                    <button type="button" onClick={() => mate.openExternal(selectedItem.url)}>
                      <ExternalLink size={16} />
                      <span>浏览器打开</span>
                    </button>
                  </div>
                ) : null}
                {articleStatus === "ready" && article ? (
                  <>
                    {article.byline ? <p className="article-byline">{article.byline}</p> : null}
                    <div dangerouslySetInnerHTML={{ __html: article.content }} />
                    <div className="article-source-hint">
                      <span>如果这里不是完整正文，可以切到原网页，仍在桌面伴侣内查看。</span>
                      <button type="button" onClick={() => setReaderMode("source")}>
                        <Globe2 size={15} />
                        <span>原网页</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </article>
            )}
          </>
        ) : (
          <div className="reader-empty">
            <Newspaper size={34} />
            <span>暂无选中内容</span>
          </div>
        )}
      </section>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
            <header>
              <h2>设置</h2>
              <button className="icon-button" type="button" title="关闭" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form className="settings-grid" onSubmit={handleSettingsSave}>
              <label>
                <span>同步间隔</span>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={settingsDraft.refreshMinutes}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, refreshMinutes: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <span>提醒阈值</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settingsDraft.notifyMinScore}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, notifyMinScore: Number(event.target.value) }))
                  }
                />
              </label>
              <label className="wide">
                <span>关注关键词</span>
                <input
                  value={settingsDraft.keywords.join(", ")}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      keywords: event.target.value
                        .split(",")
                        .map((keyword) => keyword.trim())
                        .filter(Boolean)
                    }))
                  }
                />
              </label>
              <label className="toggle-row wide">
                <input
                  type="checkbox"
                  checked={settingsDraft.notificationsEnabled}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, notificationsEnabled: event.target.checked }))
                  }
                />
                {settingsDraft.notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                <span>系统提醒</span>
              </label>
              <button className="form-button" type="submit">
                <Check size={16} />
                <span>保存</span>
              </button>
            </form>

            <form className="rss-form" onSubmit={handleAddRss}>
              <h3>RSS 来源</h3>
              <input
                value={rssInput.name}
                onChange={(event) => setRssInput((current) => ({ ...current, name: event.target.value }))}
                placeholder="来源名称"
              />
              <input
                value={rssInput.feedUrl}
                onChange={(event) => setRssInput((current) => ({ ...current, feedUrl: event.target.value }))}
                placeholder="https://example.com/feed.xml"
              />
              <button className="form-button" type="submit">
                <Plus size={16} />
                <span>添加</span>
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function countForView(items: FeedItem[], view: ViewKey) {
  return items.filter((item) => itemMatchesView(item, view)).length;
}

export default App;
