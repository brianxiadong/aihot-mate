import { ExternalLink, Flame, Inbox, Newspaper, Sparkles } from "lucide-react";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, FeedItem } from "../preload/preload";
import { mate } from "./bridge";
import petSkinUrl from "../../assets/pet/aihot-mate-pet-runtime.png";

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

function displayTitle(item: FeedItem | null) {
  if (!item) return "正在守着 AI 圈";
  return item.title;
}

function PetApp() {
  const [state, setState] = useState<AppState>(initialState);
  const [isSyncing, setIsSyncing] = useState(false);
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, totalX: 0, totalY: 0 });

  useEffect(() => {
    mate.getState().then(setState);
    return mate.onStateChanged(setState);
  }, []);

  const featured = useMemo(() => {
    return state.items.find((item) => !item.isRead) || state.items.find((item) => item.kind === "hot-topic") || state.items[0] || null;
  }, [state.items]);

  const mood = featured?.kind === "hot-topic" ? "hot" : state.counts.unread > 0 ? "new" : "idle";

  async function openMini() {
    await mate.openMini(featured?.id);
  }

  function handlePetPointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragRef.current = {
      active: true,
      moved: false,
      x: event.screenX,
      y: event.screenY,
      totalX: 0,
      totalY: 0
    };
    mate.startPetDrag(event.screenX, event.screenY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePetPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const deltaX = event.screenX - drag.x;
    const deltaY = event.screenY - drag.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 1) return;
    drag.totalX += Math.abs(deltaX);
    drag.totalY += Math.abs(deltaY);
    if (drag.totalX + drag.totalY > 4) {
      drag.moved = true;
    }
    mate.dragPetTo(event.screenX, event.screenY);
    drag.x = event.screenX;
    drag.y = event.screenY;
  }

  function handlePetPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const moved = dragRef.current.moved;
    dragRef.current.active = false;
    mate.endPetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!moved) {
      openMini();
    }
  }

  function handlePetPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    dragRef.current.active = false;
    mate.endPetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function syncNow() {
    setIsSyncing(true);
    try {
      setState(await mate.sync());
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <main className={`pet-surface ${mood}`}>
      <button className="pet-bubble" type="button" onClick={openMini} title="快速阅读">
        <span className="pet-bubble-kicker">
          {featured?.kind === "hot-topic" ? <Flame size={13} /> : <Sparkles size={13} />}
          {state.counts.unread > 0 ? `${state.counts.unread} 条新内容` : "AIHOT Mate"}
        </span>
        <strong>{displayTitle(featured)}</strong>
      </button>

      <button
        className="pet-body"
        type="button"
        title="拖动宠物，轻点快速阅读"
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerCancel}
      >
        <img className="pet-skin" src={petSkinUrl} alt="" draggable={false} />
        <span className="pet-core">
          {mood === "hot" ? <Flame size={19} /> : state.counts.unread > 0 ? <Inbox size={19} /> : <Newspaper size={19} />}
        </span>
        {state.counts.unread > 0 ? <span className="pet-count">{state.counts.unread}</span> : null}
      </button>

      <div className="pet-actions">
        <button type="button" title="同步" onClick={syncNow} className={isSyncing ? "syncing" : ""}>
          <Sparkles size={14} />
        </button>
        <button type="button" title="主页面" onClick={() => mate.openMain(featured?.id)}>
          <ExternalLink size={14} />
        </button>
      </div>
    </main>
  );
}

export default PetApp;
