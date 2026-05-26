// Single message bubble — TG-style rounded rectangle. Own messages float
// right with a warm ember-tinted background; peer messages float left on the
// panel surface. Time + (for own) a tick icon live in a row inside the
// bubble, bottom-right.
//
// In groups/channels, incoming peer bubbles also get an avatar to the left
// and the sender's display name above the bubble in an ember-tinted small
// caption (controlled by `showAttribution`).

import type { Message } from '@racass-pixel/quick-protocol';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';
import { useChats, type MessageStatus } from '../../stores/useChats';

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

export function MessageBubble({
  message,
  isOwn,
  isReadByPeer = false,
  showAttribution = false,
  senderUser,
  status,
  convId,
}: Props) {
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

  const bubble = (
    <div className={`group flex flex-col gap-0.5 max-w-[70%] ${sideClass} animate-[bubble-in_200ms_ease-out]`}>
      {showHeader && (
        <div className="text-[12px] font-mono text-ember/90 pl-1 select-none">
          {senderLabel}
        </div>
      )}
      <div
        onClick={canRetry ? handleRetry : undefined}
        role={canRetry ? 'button' : undefined}
        title={canRetry ? 'Tap to retry' : undefined}
        aria-label={canRetry ? 'Failed message — tap to retry' : undefined}
        className={`rounded-[14px] px-3 py-2 text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm ${surfaceClass}`}
      >
        <span>{message.body}</span>
        <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-ink-3 select-none">
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
    </div>
  );

  if (!showHeader) return bubble;

  // Group/channel attribution layout: 32px avatar + bubble stack on the left.
  return (
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
}
