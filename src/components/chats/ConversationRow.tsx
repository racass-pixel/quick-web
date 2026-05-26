// Single row in the chats sidebar list. Telegram-Web-K style: 72px tall,
// 54px avatar, name 16/medium top-left, time 12/mono top-right, preview
// 14/ink-2 bottom-left, unread ember pill bottom-right.
//
// Right-click or long-press opens a tiny Pin/Unpin menu — pinned conversations
// get a small pin icon next to the time and float to the top of the list
// (server-side sort).

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '@racass-pixel/quick-protocol';
import { Pin, PinOff } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';
import { useChats } from '../../stores/useChats';

function formatRelative(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function kindBadge(type: string): string | null {
  if (type === 'group') return 'G';
  if (type === 'channel') return 'C';
  return null;
}

const LONG_PRESS_MS = 480;

export function ConversationRow({
  conv,
  active,
}: {
  conv: Conversation;
  active: boolean;
}) {
  const ms = conv.lastMessageAt
    ? Number(conv.lastMessageAt.seconds) * 1000
    : 0;
  const previewText = conv.preview?.body ?? '';
  const isDm = conv.type === 'dm' || !!conv.peer;
  const displayName = isDm
    ? conv.peer?.displayName ?? conv.title ?? 'Conversation'
    : conv.title || 'Conversation';
  const handle = conv.peer?.handle;
  const avatarColor = (isDm ? conv.peer?.avatarColor : conv.avatarColor) ?? '';
  const badge = kindBadge(conv.type);

  const pinned = useChats((s) => s.pinnedConvIds.has(conv.id));
  const togglePin = useChats((s) => s.togglePinnedConv);

  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuAt) return;
    function onClick(ev: MouseEvent) {
      const el = menuRef.current;
      if (el && !el.contains(ev.target as Node)) setMenuAt(null);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setMenuAt(null);
    }
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onClick);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [menuAt]);

  function clearLongPress() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function onTouchStart(ev: React.TouchEvent) {
    const t = ev.touches[0];
    if (!t) return;
    const x = t.clientX;
    const y = t.clientY;
    longPressTimerRef.current = window.setTimeout(() => {
      setMenuAt({ x, y });
    }, LONG_PRESS_MS);
  }

  function onContextMenu(ev: React.MouseEvent) {
    ev.preventDefault();
    setMenuAt({ x: ev.clientX, y: ev.clientY });
  }

  async function handleTogglePin() {
    await togglePin(conv.id, !pinned);
    setMenuAt(null);
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const PANEL_W = 160;
  const PANEL_H = 44;
  const padding = 6;
  const menuLeft = menuAt
    ? Math.min(Math.max(padding, menuAt.x), vw - PANEL_W - padding)
    : 0;
  const menuTop = menuAt
    ? Math.min(Math.max(padding, menuAt.y), vh - PANEL_H - padding)
    : 0;

  return (
    <>
      <Link
        to="/chats/$id"
        params={{ id: conv.id }}
        onContextMenu={onContextMenu}
        onTouchStart={onTouchStart}
        onTouchEnd={clearLongPress}
        onTouchMove={clearLongPress}
        className={`flex items-center gap-3 px-3 h-[72px] transition-colors ${
          active ? 'bg-raised' : 'hover:bg-raised/60'
        }`}
      >
        <div className="relative shrink-0">
          {isDm && conv.peer ? (
            <button
              type="button"
              aria-label={`Open profile for ${displayName}`}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                useProfile.getState().open(conv.peer!);
              }}
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <Avatar displayName={displayName} color={avatarColor} size={54} />
            </button>
          ) : (
            <Avatar displayName={displayName} color={avatarColor} size={54} />
          )}
          {badge && (
            <span className="absolute -bottom-0.5 -right-0.5 text-[9px] font-mono px-1 py-px bg-bg text-ink-2 border border-line rounded pointer-events-none">
              {badge}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-ink-1 text-[16px] font-medium truncate flex-1">
              {displayName}
            </span>
            {pinned && (
              <Pin
                size={12}
                strokeWidth={2.5}
                className="text-ember shrink-0"
                aria-label="Pinned"
              />
            )}
            <span className="text-ink-3 text-[12px] font-mono tabular-nums shrink-0">
              {formatRelative(ms)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-ink-2 text-[14px] truncate flex-1 leading-5">
              {previewText || (isDm && handle ? `@${handle}` : '')}
            </span>
            {conv.unreadCount > 0 && (
              <span className="text-[12px] font-mono leading-none px-1.5 min-w-[20px] h-5 inline-flex items-center justify-center bg-ember text-bg rounded-full shrink-0">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
      {menuAt && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-40 bg-panel border border-line shadow-lg rounded-md py-1 text-sm select-none"
          style={{ left: menuLeft, top: menuTop, width: PANEL_W }}
        >
          <button
            type="button"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              void handleTogglePin();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-ink-2 hover:text-ink-1 hover:bg-raised text-left"
          >
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
            {pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      )}
    </>
  );
}
