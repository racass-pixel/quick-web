// Renders search-message hits. Each row shows the sender avatar, conv name,
// matched body snippet with the query highlighted in ember, and a relative
// time stamp. Clicking a row navigates to the conv and pulses the message.

import { useNavigate } from '@tanstack/react-router';
import type { Message } from '@racass-pixel/quick-protocol';
import { Avatar } from '../primitives/Avatar';
import { useChats } from '../../stores/useChats';

type Props = {
  query: string;
  hits: Message[];
  loading: boolean;
  // When set, hide the conversation name (caller is already inside that conv).
  scopedConvId?: string;
  onHitClick?(): void;
};

function relTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSnippet(body: string, query: string): React.ReactNode {
  if (!query || !body) return body;
  const re = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  const parts = body.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <span key={i} className="text-ember font-medium">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function SearchResults({ query, hits, loading, scopedConvId, onHitClick }: Props) {
  const navigate = useNavigate();
  const byId = useChats((s) => s.byId);
  const senders = useChats((s) => s.senderUserByMsgId);

  if (loading && hits.length === 0) {
    return (
      <div className="p-4 text-ink-3 text-xs font-mono">Searching…</div>
    );
  }
  if (!loading && hits.length === 0) {
    return (
      <div className="p-4 text-ink-3 text-xs font-mono">No matches.</div>
    );
  }

  function open(h: Message) {
    onHitClick?.();
    void navigate({ to: '/chats/$id', params: { id: h.conversationId } });
    // Defer the pulse so the route has time to mount the thread.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-msg-id="${CSS.escape(h.id)}"]`,
      );
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      useChats.getState().pulseMessage(h.id);
    }, 250);
  }

  return (
    <ul className="py-1">
      {hits.map((h) => {
        const conv = byId[h.conversationId];
        const sender = senders[h.id];
        const senderName =
          sender?.displayName ||
          sender?.handle ||
          (h.senderId ? `${h.senderId.slice(0, 6)}…` : 'unknown');
        const senderColor = sender?.avatarColor ?? '';
        const convName = conv?.peer?.displayName || conv?.title || 'Conversation';
        const ms = h.createdAt
          ? Number(h.createdAt.seconds) * 1000 +
            Math.floor((h.createdAt.nanos ?? 0) / 1_000_000)
          : 0;
        return (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => open(h)}
              className="w-full flex items-start gap-3 px-3 py-2 hover:bg-raised text-left transition-colors"
            >
              <Avatar displayName={senderName} color={senderColor} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-ink-1 text-[13px] font-medium truncate">
                    {senderName}
                  </span>
                  {!scopedConvId && (
                    <span className="text-ink-3 text-[11px] font-mono truncate">
                      in {convName}
                    </span>
                  )}
                  <span className="ml-auto text-ink-3 text-[11px] font-mono tabular-nums shrink-0">
                    {ms ? relTime(ms) : ''}
                  </span>
                </div>
                <div className="text-ink-2 text-[12px] truncate">
                  {renderSnippet(h.body ?? '', query)}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
