// Single message bubble — TG-style rounded rectangle. Own messages float
// right with a warm ember-tinted background; peer messages float left on the
// panel surface. Time + (for own) a tick icon live in a row inside the
// bubble, bottom-right.
//
// In groups/channels, incoming peer bubbles also get an avatar to the left
// and the sender's display name above the bubble in an ember-tinted small
// caption (controlled by `showAttribution`).
//
// Right-click / long-press on any bubble opens the MessageContextMenu with
// Reply/Edit/Pin/Copy/Forward/Delete/Select/Seen items. Edit replaces the
// bubble body with an inline textarea; Delete opens DeleteMessageModal.

import { useEffect, useRef, useState } from 'react';
import type { Message } from '@racass-pixel/quick-protocol';
import { AlertCircle, Check, CheckCheck, Clock, Pin } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';
import {
  useChats,
  type LocalMessage,
  type MessageStatus,
} from '../../stores/useChats';
import { messagingClient } from '../../api/messaging';
import { MessageContextMenu } from './MessageContextMenu';
import { DeleteMessageModal } from './DeleteMessageModal';
import { VoiceBubble, type VoicePayload } from './VoiceBubble';

// Per-page memo of voice messages we've already reported as played, so a
// re-render or scroll-back-then-forward doesn't re-fire markVoicePlayed for
// the same message id.
const playedReportedIds = new Set<string>();

export type SenderUserLite = {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
};

type Props = {
  message: Message;
  isOwn: boolean;
  // True when the peer has read this message (msg.createdAt <= last_read_at).
  isReadByPeer?: boolean;
  // Render avatar + sender name above the bubble. Only used for peer messages
  // in groups/channels.
  showAttribution?: boolean;
  // The sender's user snapshot, when available. Falls back to a truncated
  // senderId label if missing.
  senderUser?: SenderUserLite;
  // TG-style local status for own messages: pending (clock) / sent (tick) /
  // read (double tick) / failed (red exclamation). Server messages have no
  // status — they're rendered as `sent` for back-compat.
  status?: MessageStatus;
  // Conversation id, used to retry a failed send. When provided alongside a
  // failed own message, clicking anywhere on the bubble re-enqueues it.
  convId?: string;
  // Conversation context for the context menu — what kind of conv and our
  // role in it. Drives availability of Pin / Delete-for-everyone / Seen.
  convType?: 'dm' | 'group' | 'channel' | string;
  myRole?: string;
  unreadCount?: number;
};

function fmtTime(seconds: bigint | undefined, nanos: number | undefined): string {
  if (seconds == null) return '';
  const ms = Number(seconds) * 1000 + Math.floor((nanos ?? 0) / 1_000_000);
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LONG_PRESS_MS = 420;

export function MessageBubble({
  message,
  isOwn,
  isReadByPeer = false,
  showAttribution = false,
  senderUser,
  status,
  convId,
  convType,
  myRole = '',
  unreadCount = 0,
}: Props) {
  const localMsg = message as LocalMessage;
  const time = fmtTime(message.createdAt?.seconds, message.createdAt?.nanos);
  const sideClass = isOwn ? 'ml-auto items-end' : 'items-start';
  // Effective status. Legacy server messages have no `status` — render as
  // `sent` so the single tick keeps showing. `read` overrides via the
  // existing isReadByPeer signal so we don't regress S8 behaviour.
  const effectiveStatus: MessageStatus = !isOwn
    ? 'sent'
    : status === 'failed'
      ? 'failed'
      : status === 'pending'
        ? 'pending'
        : isReadByPeer
          ? 'read'
          : 'sent';

  const isFailed = effectiveStatus === 'failed';
  const canRetry = isFailed && isOwn && !!convId;

  // Own bubble — warm ember tint over the panel. Failed gets a subtle red
  // border and (when we can act on it) a pointer cursor to advertise the
  // tap-to-retry affordance.
  const surfaceClass = isOwn
    ? `bg-[rgba(234,88,12,0.18)] text-ink-1 ${
        isFailed ? 'border border-err/70' : ''
      } ${canRetry ? 'cursor-pointer hover:bg-[rgba(234,88,12,0.26)] transition-colors' : ''}`
    : 'bg-panel text-ink-1';

  const showHeader = showAttribution && !isOwn;
  const senderLabel =
    senderUser?.displayName ||
    senderUser?.handle ||
    (message.senderId ? `${message.senderId.slice(0, 6)}…` : 'unknown');

  function handleRetry() {
    if (!canRetry) return;
    const tempId = (message as Message & { tempId?: string }).tempId;
    if (!tempId) return;
    useChats.getState().retrySend(convId!, tempId);
  }

  // Context-menu + edit + delete state. The menu position is captured at the
  // moment the user opens it (right-click cursor xy or the bubble center on
  // long-press) so it stays under the pointer without re-positioning on
  // scroll while the menu is open.
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body ?? '');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const editAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  function openMenuAt(x: number, y: number) {
    setMenuAnchor({ x, y });
  }

  function onContextMenu(ev: React.MouseEvent<HTMLDivElement>) {
    // Don't hijack while editing — let the textarea's native menu show.
    if (editing) return;
    ev.preventDefault();
    openMenuAt(ev.clientX, ev.clientY);
  }

  function onTouchStart(ev: React.TouchEvent<HTMLDivElement>) {
    if (editing) return;
    longPressFiredRef.current = false;
    const t = ev.touches[0];
    if (!t) return;
    const x = t.clientX;
    const y = t.clientY;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      openMenuAt(x, y);
    }, LONG_PRESS_MS);
  }

  function clearLongPress() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function onTouchEnd() {
    clearLongPress();
  }

  function onTouchMove() {
    clearLongPress();
  }

  useEffect(() => () => clearLongPress(), []);

  // Focus + select the textarea contents when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const el = editAreaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  function startEditMode() {
    setEditDraft(message.body ?? '');
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditDraft(message.body ?? '');
    setEditError(null);
  }

  async function commitEdit() {
    const next = editDraft.trim();
    if (!next) {
      cancelEdit();
      return;
    }
    if (next === (message.body ?? '').trim()) {
      cancelEdit();
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await messagingClient.editMessage({
        messageId: message.id,
        body: next,
      });
      setEditing(false);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Edit failed.');
    } finally {
      setEditBusy(false);
    }
  }

  function onEditKeyDown(ev: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelEdit();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void commitEdit();
    }
  }

  // canDeleteForEveryone — sender within 48h, OR admin/owner in group/channel.
  const isGroupOrChannel = convType === 'group' || convType === 'channel';
  const isDm = convType === 'dm';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const createdMs = message.createdAt
    ? Number(message.createdAt.seconds) * 1000
    : 0;
  const within48h = createdMs > 0 && Date.now() - createdMs < 48 * 3600 * 1000;
  const canDeleteForEveryone =
    (isOwn && within48h) || (isGroupOrChannel && isAdmin);

  const forEveryoneLabel = isDm
    ? 'Also delete for the other side'
    : 'Delete for everyone in the group';

  const editedAt = localMsg.editedAt;
  const pinned = !!localMsg.pinnedAt;
  // Voice attachment, if any. Wire shape is camelCased into LocalMessage by
  // the WS bridge, but we cast to read it without leaking the type elsewhere.
  const voice = (message as Message & { voice?: VoicePayload }).voice;
  const isVoice = !!voice;

  function handleVoiceFirstPlay() {
    if (!voice) return;
    if (playedReportedIds.has(message.id)) return;
    playedReportedIds.add(message.id);
    // Fire-and-forget — the WS echo will flip the bubble to read state for
    // both peers, so we don't need to await or optimistically mutate here.
    void messagingClient
      .markVoicePlayed({ messageId: message.id })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[voice] markVoicePlayed failed', err);
        // Roll back so a manual retry on next play works.
        playedReportedIds.delete(message.id);
      });
  }

  const bubble = (
    <div
      className={`group flex flex-col gap-0.5 max-w-[70%] ${sideClass} animate-[bubble-in_200ms_ease-out]`}
    >
      {showHeader && (
        <div className="text-[12px] font-mono text-ember/90 pl-1 select-none">
          {senderLabel}
        </div>
      )}
      <div
        onClick={canRetry && !editing ? handleRetry : undefined}
        onContextMenu={onContextMenu}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        role={canRetry ? 'button' : undefined}
        title={canRetry ? 'Tap to retry' : undefined}
        aria-label={canRetry ? 'Failed message — tap to retry' : undefined}
        className={`relative rounded-[14px] px-3 py-2 text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm ${surfaceClass}`}
      >
        {pinned && (
          <Pin
            size={12}
            strokeWidth={2.5}
            className="absolute -top-1 -right-1 text-ember bg-bg rounded-full p-0.5"
            aria-label="Pinned"
          />
        )}
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea
              ref={editAreaRef}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={onEditKeyDown}
              disabled={editBusy}
              rows={Math.min(6, Math.max(1, editDraft.split('\n').length))}
              className="w-full bg-bg text-ink-1 border border-ember rounded px-2 py-1 text-[14px] resize-none focus:outline-none disabled:opacity-60"
              aria-label="Edit message"
            />
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-ink-3">
              <span>{editError ? <span className="text-err">{editError}</span> : 'Enter to save · Esc to cancel'}</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={editBusy}
                  className="uppercase tracking-wider hover:text-ink-1 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void commitEdit()}
                  disabled={editBusy}
                  className="uppercase tracking-wider text-ember hover:text-ember/80 disabled:opacity-40"
                >
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        ) : isVoice && voice ? (
          <div className="flex flex-col gap-1">
            <VoiceBubble
              voice={voice}
              isOwn={isOwn}
              onFirstPlay={handleVoiceFirstPlay}
            />
            <span className="self-end inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-ink-3 select-none">
              <span>{time}</span>
              {isOwn && effectiveStatus === 'pending' && (
                <Clock size={14} strokeWidth={2.25} className="text-ink-3" aria-label="Pending" />
              )}
              {isOwn && effectiveStatus === 'sent' && (
                <Check size={14} strokeWidth={2.25} className="text-ink-3" aria-label="Sent" />
              )}
              {isOwn && effectiveStatus === 'read' && (
                <CheckCheck size={14} strokeWidth={2.25} className="text-ember" aria-label="Read" />
              )}
              {isOwn && effectiveStatus === 'failed' && (
                <AlertCircle size={14} strokeWidth={2.25} className="text-err" aria-label="Failed — tap to retry" />
              )}
            </span>
          </div>
        ) : (
          <>
            <span>{message.body}</span>
            <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-ink-3 select-none">
              {editedAt && (
                <span
                  className="italic"
                  title={`Edited ${new Date(editedAt).toLocaleString()}`}
                >
                  edited
                </span>
              )}
              <span>{time}</span>
              {isOwn && effectiveStatus === 'pending' && (
                <Clock size={14} strokeWidth={2.25} className="text-ink-3" aria-label="Pending" />
              )}
              {isOwn && effectiveStatus === 'sent' && (
                <Check size={14} strokeWidth={2.25} className="text-ink-3" aria-label="Sent" />
              )}
              {isOwn && effectiveStatus === 'read' && (
                <CheckCheck size={14} strokeWidth={2.25} className="text-ember" aria-label="Read" />
              )}
              {isOwn && effectiveStatus === 'failed' && (
                <AlertCircle size={14} strokeWidth={2.25} className="text-err" aria-label="Failed — tap to retry" />
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );

  // The actual layout — bubble alone, or bubble + avatar for group attribution.
  const layout = !showHeader ? (
    bubble
  ) : (
    <div className="flex items-end gap-2 max-w-full">
      <button
        type="button"
        onClick={() =>
          useProfile.getState().openLite({
            id: senderUser?.id ?? message.senderId,
            handle: senderUser?.handle ?? '',
            displayName: senderUser?.displayName ?? senderLabel,
            avatarColor: senderUser?.avatarColor ?? '',
          })
        }
        className="shrink-0 self-end mb-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        aria-label={`Open profile for ${senderLabel}`}
      >
        <Avatar
          displayName={senderUser?.displayName ?? senderLabel}
          color={senderUser?.avatarColor ?? ''}
          size={32}
        />
      </button>
      {bubble}
    </div>
  );

  return (
    <>
      {layout}
      {menuAnchor && convId && (
        <MessageContextMenu
          message={localMsg}
          isOwn={isOwn}
          isGroupOrChannel={isGroupOrChannel}
          isDm={isDm}
          myRole={myRole}
          convId={convId}
          unreadCount={unreadCount}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          onStartEdit={startEditMode}
          onAskDelete={() => setDeleteOpen(true)}
        />
      )}
      {deleteOpen && (
        <DeleteMessageModal
          messageId={message.id}
          canDeleteForEveryone={canDeleteForEveryone}
          forEveryoneLabel={forEveryoneLabel}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}
