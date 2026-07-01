import {
  Bookmark,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe2,
  Loader2,
  Maximize2,
  Star,
  X
} from "lucide-react";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import type { AppState, FeedItem, ReaderArticle } from "../preload/preload";
import { mate } from "./bridge";

type ArticleStatus = "idle" | "loading" | "ready" | "error";
type ReaderMode = "article" | "source";

const initialState: AppState = {
  version: 1,
  lastSyncAt: null,
  settings: {
    refreshMinutes: 5,
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

function formatTime(value: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function pickInitialItem(items: FeedItem[], requestedId: string | null) {
  if (requestedId) {
    const requested = items.find((item) => item.id === requestedId);
    if (requested) return requested;
  }
  return items.find((item) => !item.isRead) || items.find((item) => item.kind === "hot-topic") || items[0] || null;
}

function MiniReader() {
  const [state, setState] = useState<AppState>(initialState);
  const [selectedId, setSelectedId] = useState<string | null>(new URLSearchParams(window.location.search).get("itemId"));
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [articleStatus, setArticleStatus] = useState<ArticleStatus>("idle");
  const [readerMode, setReaderMode] = useState<ReaderMode>("article");

  useEffect(() => {
    mate.getState().then((nextState) => {
      setState(nextState);
      if (!selectedId) {
        setSelectedId(pickInitialItem(nextState.items, null)?.id || null);
      }
    });

    const offState = mate.onStateChanged((nextState) => {
      setState(nextState);
      if (!selectedId) {
        setSelectedId(pickInitialItem(nextState.items, null)?.id || null);
      }
    });
    const offFocus = mate.onMiniFocusItem((itemId) => {
      setSelectedId(itemId);
    });

    return () => {
      offState();
      offFocus();
    };
  }, [selectedId]);

  const selectedItem = useMemo(() => pickInitialItem(state.items, selectedId), [selectedId, state.items]);
  const selectedIndex = selectedItem ? state.items.findIndex((item) => item.id === selectedItem.id) : -1;

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
      .catch(() => {
        if (!canceled) {
          setArticleStatus("error");
        }
      });

    return () => {
      canceled = true;
    };
  }, [selectedItem?.id]);

  function move(offset: number) {
    if (selectedIndex < 0) return;
    const next = state.items[selectedIndex + offset];
    if (next) setSelectedId(next.id);
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
    return item.readerUrl || item.url || item.originalUrl;
  }

  if (!selectedItem) {
    return (
      <main className="mini-surface empty">
        <button className="mini-close" type="button" title="关闭" onClick={() => mate.closeMini()}>
          <X size={15} />
        </button>
        <p>暂无新内容</p>
        <button type="button" onClick={() => mate.openMain()}>
          打开主页面
        </button>
      </main>
    );
  }

  return (
    <main className="mini-surface">
      <header className="mini-titlebar">
        <div>
          <span>{selectedItem.sourceName}</span>
          <small>{formatTime(selectedItem.publishedAt)}</small>
        </div>
        <button type="button" title="关闭" onClick={() => mate.closeMini()}>
          <X size={15} />
        </button>
      </header>

      <div className={readerMode === "source" ? "mini-content source" : "mini-content"}>
        <section className="mini-headline">
          <h1>{selectedItem.title}</h1>
          <p>{selectedItem.summary}</p>
        </section>

        {readerMode === "source" ? (
          <div className="mini-webview-wrap">
            <webview
              className="mini-webview"
              src={embeddedSourceUrl(selectedItem)}
              partition="persist:aihot-mate-reader"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            />
          </div>
        ) : (
          <article className="mini-article" onClick={handleArticleClick}>
            {articleStatus === "loading" ? (
              <div className="mini-loading">
                <Loader2 size={18} className="spin" />
              <span>加载正文</span>
            </div>
            ) : null}
            {articleStatus === "error" ? (
              <div className="mini-inline-fallback">
                <p>{selectedItem.summary}</p>
                <button type="button" onClick={() => setReaderMode("source")}>
                  <Globe2 size={14} />
                <span>看原网页</span>
                </button>
            </div>
            ) : null}
            {articleStatus === "ready" && article ? <div dangerouslySetInnerHTML={{ __html: article.content }} /> : null}
          </article>
        )}
      </div>

      <footer className="mini-actions">
        <button type="button" title="上一条" onClick={() => move(-1)} disabled={selectedIndex <= 0}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          title="收藏"
          className={selectedItem.isFavorite ? "active" : ""}
          onClick={() => mate.toggleFavorite(selectedItem.id).then(setState)}
        >
          <Star size={16} />
        </button>
        <button
          type="button"
          title="稍后读"
          className={selectedItem.isSaved ? "active" : ""}
          onClick={() => mate.toggleSaved(selectedItem.id).then(setState)}
        >
          <Bookmark size={16} />
        </button>
        <button type="button" title="全部已读" onClick={() => mate.markAllRead().then(setState)}>
          <CheckCheck size={16} />
        </button>
        <button type="button" title="浏览器打开" onClick={() => mate.openExternal(selectedItem.url)}>
          <ExternalLink size={16} />
        </button>
        <button type="button" title="主页面" onClick={() => mate.openMain(selectedItem.id)}>
          <Maximize2 size={16} />
        </button>
        <button type="button" title="下一条" onClick={() => move(1)} disabled={selectedIndex >= state.items.length - 1}>
          <ChevronRight size={16} />
        </button>
      </footer>
    </main>
  );
}

export default MiniReader;
