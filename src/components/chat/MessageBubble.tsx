// Single message bubble — TG-style rounded rectangle. Own messages float
// right with a warm ember-tinted background; peer messages float left on the
// panel surface. Time + (for own) a tick icon live in a row inside the
// bubble, bottom-right.

import type { Message } from '@racass-pixel/quick-protocol';
import { Check, CheckCheck } from 'lucide-react';

type Props = {
  message: Message;
  isOwn: boolean;
  // True when the peer has read this message (msg.createdAt <= last_read_at).
  isReadByPeer?: boolean;
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

export function MessageBubble({ message, isOwn, isReadByPeer = false }: Props) {
  const time = fmtTime(message.createdAt?.seconds, message.createdAt?.nanos);
  const sideClass = isOwn ? 'ml-auto items-end' : 'items-start';
  // Own bubble — warm ember tint over the panel. Keeps the accent visible
  // without screaming. Peer — flat panel.
  const surfaceClass = isOwn
    ? 'bg-[rgba(234,88,12,0.18)] text-ink-1'
    : 'bg-panel text-ink-1';

  return (
    <div className={`group flex flex-col gap-1 max-w-[70%] ${sideClass} animate-[bubble-in_200ms_ease-out]`}>
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
}
