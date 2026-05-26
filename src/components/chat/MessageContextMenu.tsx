// Right-click / long-press menu on a message bubble. Telegram-parity layout —
// Reply / Edit / Pin / Copy Text / Copy Link / Forward / Delete / Select /
// N Seen. Items not yet implemented (Reply, Forward, Select) render greyed
// out so the menu shape remains stable across releases.
//
// The menu is anchored at the cursor position passed in via `anchor`. It
// closes on outside click or Escape. The "N Seen" item expands a nested
// readers popover in place — clicking a reader opens their ProfileModal.

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  CornerUpLeft,
  Edit3,
  Forward,
  Link2,
  MousePointerSquareDashed,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import type { LocalMessage } from '../../stores/useChats';
import { messagingClient } from '../../api/messaging';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';

export type MessageContextMenuProps = {
  message: LocalMessage;
  isOwn: boolean;
  isGroupOrChannel: boolean;
  isDm: boolean;
  // 'owner' | 'admin' | 'member' | '' — empty implies non-member view.
  myRole: string;
  convId: string;
  // Conversation unread count — gates the "N Seen" item per spec (only show
  // when the caller has fully caught up on the thread).
  unreadCount: number;
  // Cursor position the menu anchors off (top-left of the panel).
  anchor: { x: number; y: number };
  onClose(): void;
  onStartEdit(): void;
  onAskDelete(): void;
};

type Reader = {
  userId: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  readAtMs: number;
};

function relTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function withinEditWindow(message: LocalMessage): boolean {
  const sec = message.createdAt ? Number(message.createdAt.seconds) : 0;
  if (!sec) return false;
  const createdMs = sec * 1000;
  return Date.now() - createdMs < 48 * 60 * 60 * 1000;
}

export function MessageContextMenu(props: MessageContextMenuProps) {
  const {
    message,
    isOwn,
    isGroupOrChannel,
    isDm,
    myRole,
    convId,
    unreadCount,
    anchor,
    onClose,
    onStartEdit,
    onAskDelete,
  } = props;

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [seenOpen, setSeenOpen] = useState(false);
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [seenLoading, setSeenLoading] = useState(false);
  const [seenError, setSeenError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'text' | 'link' | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    function onClick(ev: MouseEvent) {
      const el = menuRef.current;
      if (el && !el.contains(ev.target as Node)) onClose();
    }
    window.addEventListener('keydown', onKey);
    // Defer the click listener by a frame so the same right-click event that
    // opened the menu doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onClick);
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.clearTimeout(t);
    };
  }, [onClose]);

  // Position clamping: keep the menu inside the viewport.
  const PANEL_W = 240;
  const PANEL_H_GUESS = 380;
  const padding = 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = Math.min(Math.max(padding, anchor.x), vw - PANEL_W - padding);
  const top = Math.min(Math.max(padding, anchor.y), vh - PANEL_H_GUESS - padding);

  const canEdit = isOwn && withinEditWindow(message) && (message.kind ?? 'text') === 'text';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  // Pin: in groups/channels admins/owners only; in DMs both sides allowed.
  const canPin = isDm || (isGroupOrChannel && isAdmin);
  const isPinned = !!message.pinnedAt;
  // Seen list: own messages only, in groups/channels, after we've read the
  // whole thread. DMs use the existing tick indicator instead.
  const canSeeReaders =
    isOwn && isGroupOrChannel && unreadCount === 0 && (message.kind ?? 'text') === 'text';

  async function loadReaders() {
    setSeenOpen(true);
    if (readers || seenLoading) return;
    setSeenLoading(true);
    setSeenError(null);
    try {
      const res = await messagingClient.getMessageReaders({
        messageId: message.id,
      });
      const list: Reader[] = (res.readers ?? []).map((r) => {
        const u = r.user;
        const ms =
          r.readAt && r.readAt.seconds
            ? Number(r.readAt.seconds) * 1000 +
              Math.floor((r.readAt.nanos ?? 0) / 1_000_000)
            : 0;
        return {
          userId: u?.id ?? '',
          handle: u?.handle ?? '',
          displayName: u?.displayName ?? u?.handle ?? '',
          avatarColor: u?.avatarColor ?? '',
          readAtMs: ms,
        };
      });
      setReaders(list);
    } catch (e: unknown) {
      setSeenError(e instanceof Error ? e.message : 'Could not load readers.');
    } finally {
      setSeenLoading(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.body ?? '');
      setCopyFeedback('text');
      setTimeout(() => onClose(), 600);
    } catch {
      setCopyFeedback(null);
    }
  }

  async function copyLink() {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/chats/${convId}#m=${message.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback('link');
      setTimeout(() => onClose(), 600);
    } catch {
      setCopyFeedback(null);
    }
  }

  async function togglePin() {
    if (pinBusy) return;
    setPinBusy(true);
    try {
      if (isPinned) {
        await messagingClient.unpinMessage({ messageId: message.id });
      } else {
        await messagingClient.pinMessage({ messageId: message.id });
      }
      onClose();
    } catch {
      /* swallow — WS envelope is the source of truth */
    } finally {
      setPinBusy(false);
    }
  }

  function startEdit() {
    onStartEdit();
    onClose();
  }

  function askDelete() {
    onAskDelete();
    onClose();
  }

  // Items render. Disabled items are dimmed but kept in the layout to match
  // the eventual TG-parity menu.
  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-40 bg-panel border border-line shadow-lg rounded-md py-1 text-sm select-none"
      style={{ left, top, width: PANEL_W }}
    >
      <MenuItem icon={<CornerUpLeft size={16} />} label="Reply" disabled />
      {canEdit && (
        <MenuItem icon={<Edit3 size={16} />} label="Edit" onClick={startEdit} />
      )}
      {canPin && (
        <MenuItem
          icon={isPinned ? <PinOff size={16} /> : <Pin size={16} />}
          label={isPinned ? 'Unpin' : 'Pin'}
          onClick={togglePin}
          disabled={pinBusy}
        />
      )}
      <MenuItem
        icon={copyFeedback === 'text' ? <Check size={16} /> : <Copy size={16} />}
        label={copyFeedback === 'text' ? 'Copied' : 'Copy Text'}
        onClick={copyText}
      />
      <MenuItem
        icon={copyFeedback === 'link' ? <Check size={16} /> : <Link2 size={16} />}
        label={copyFeedback === 'link' ? 'Copied' : 'Copy Message Link'}
        onClick={copyLink}
      />
      <MenuItem icon={<Forward size={16} />} label="Forward" disabled />
      <MenuItem
        icon={<Trash2 size={16} />}
        label="Delete"
        onClick={askDelete}
        tone="err"
      />
      <MenuItem
        icon={<MousePointerSquareDashed size={16} />}
        label="Select"
        disabled
      />
      {canSeeReaders && (
        <div className="border-t border-line mt-1 pt-1">
          {!seenOpen ? (
            <MenuItem
              icon={<Check size={16} />}
              label="Seen by…"
              onClick={() => void loadReaders()}
            />
          ) : (
            <div className="px-3 py-2 max-h-56 overflow-y-auto">
              {seenLoading && (
                <div className="text-ink-3 text-xs font-mono">Loading…</div>
              )}
              {seenError && (
                <div className="text-err text-xs font-mono">{seenError}</div>
              )}
              {readers && readers.length === 0 && (
                <div className="text-ink-3 text-xs font-mono">No readers yet.</div>
              )}
              {readers && readers.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {readers.map((r) => (
                    <li key={r.userId}>
                      <button
                        type="button"
                        onClick={() => {
                          useProfile.getState().openLite({
                            id: r.userId,
                            handle: r.handle,
                            displayName: r.displayName,
                            avatarColor: r.avatarColor,
                          });
                          onClose();
                        }}
                        className="w-full flex items-center gap-2 px-1 py-1 rounded hover:bg-raised text-left"
                      >
                        <Avatar
                          displayName={r.displayName || r.handle || '?'}
                          color={r.avatarColor}
                          size={24}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-ink-1 text-[13px] truncate">
                            {r.displayName || r.handle || 'unknown'}
                          </div>
                        </div>
                        <span className="text-ink-3 text-[11px] font-mono tabular-nums shrink-0">
                          {r.readAtMs ? relTime(r.readAtMs) : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem(props: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'err';
}) {
  const { icon, label, onClick, disabled, tone } = props;
  const toneClass =
    tone === 'err'
      ? 'text-err hover:text-err hover:bg-err/10'
      : 'text-ink-2 hover:text-ink-1 hover:bg-raised';
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 ${toneClass} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent text-left`}
    >
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
