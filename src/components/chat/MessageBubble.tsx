// Single message bubble — TG-style rounded rectangle. Own messages float
// right with a warm ember-tinted background; peer messages float left on the
// panel surface. Time + (for own) a tick icon live in a row inside the
// bubble, bottom-right.
//
// In groups/channels, incoming peer bubbles also get an avatar to the left
// and the sender's display name above the bubble in an ember-tinted small
// caption (controlled by `showAttribution`).

import type { Message } from '@racass-pixel/quick-protocol';
import { Check, CheckCheck } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';

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
}: Props) {
  const time = fmtTime(message.createdAt?.seconds, message.createdAt?.nanos);
  const sideClass = isOwn ? 'ml-auto items-end' : 'items-start';
  // Own bubble — warm ember tint over the panel. Keeps the accent visible
  // without screaming. Peer — flat panel.
  const surfaceClass = isOwn
    ? 'bg-[rgba(234,88,12,0.18)] text-ink-1'
    : 'bg-panel text-ink-1';

  const showHeader = showAttribution && !isOwn;
  const senderLabel =
    senderUser?.displayName ||
    senderUser?.handle ||
    (message.senderId ? `${message.senderId.slice(0, 6)}…` : 'unknown');

  const bubble = (
    <div className={`group flex flex-col gap-0.5 max-w-[70%] ${sideClass} animate-[bubble-in_200ms_ease-out]`}>
      {showHeader && (
        <div className="text-[12px] font-mono text-ember/90 pl-1 select-none">
          {senderLabel}
        </div>
      )}
      <div
        className={`rounded-[14px] px-3 py-2 text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm ${surfaceClass}`}
      >
        <span>{message.body}</span>
        <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-ink-3 select-none">
          <span>{time}</span>
          {isOwn && (
            isReadByPeer ? (
              <CheckCheck size={14} strokeWidth={2.25} className="text-ember" aria-label="Read" />
            ) : (
              <Check size={14} strokeWidth={2.25} className="text-ink-3" aria-label="Sent" />
            )
          )}
        </span>
      </div>
    </div>
  );

  if (!showHeader) return bubble;

  // Group/channel attribution layout: 32px avatar + bubble stack on the left.
  return (
    <div className="flex items-end gap-2 max-w-full">
      <div className="shrink-0 self-end mb-1">
        <Avatar
          displayName={senderUser?.displayName ?? senderLabel}
          color={senderUser?.avatarColor ?? ''}
          size={32}
        />
      </div>
      {bubble}
    </div>
  );
}
