// Left rail of the /chats screen. Shows the user's conversations sorted by
// most recently active, with a preview, time, and unread badge. Rows route to
// `/chats/$id` when clicked.

import { Link, useParams } from '@tanstack/react-router';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { useChats } from '../../stores/useChats';

function formatRelative(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatList() {
  const order = useChats((s) => s.conversationsOrder);
  const byId = useChats((s) => s.byId);
  const params = useParams({ strict: false }) as { id?: string };
  const activeId = params.id;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 pt-6 pb-4 border-b border-line">
        <Kicker>chats</Kicker>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search (coming soon)"
            disabled
            className="flex-1 bg-transparent text-ink-1 placeholder:text-ink-3 border-0 border-b border-line py-2 px-1 focus:outline-none focus:border-ember transition-colors text-sm disabled:opacity-60"
          />
          <span
            title="New chat (coming soon)"
            className="text-ink-3 text-sm font-mono px-2 py-1 border border-line opacity-50 select-none"
          >
            +
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {order.length === 0 ? (
          <div className="p-6 text-ink-3 text-sm">
            No conversations yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {order.map((id) => {
              const conv = byId[id];
              if (!conv) return null;
              const isActive = activeId === id;
              const ms = conv.lastMessageAt
                ? Number(conv.lastMessageAt.seconds) * 1000
                : 0;
              const previewText = conv.preview?.body ?? '';
              const displayName = conv.peer?.displayName ?? conv.title ?? 'Conversation';
              const handle = conv.peer?.handle;
              return (
                <li key={id}>
                  <Link
                    to="/chats/$id"
                    params={{ id }}
                    className={`flex items-center gap-3 px-6 py-3 hover:bg-raised transition-colors ${
                      isActive ? 'bg-raised' : ''
                    }`}
                  >
                    <Avatar
                      displayName={displayName}
                      color={conv.peer?.avatarColor ?? ''}
                      size={40}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-ink-1 text-sm truncate flex-1">
                          {displayName}
                        </span>
                        <span className="text-ink-3 text-[10px] font-mono uppercase tracking-wider">
                          {formatRelative(ms)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-ink-3 text-xs truncate flex-1">
                          {previewText || (handle ? `@${handle}` : '')}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-ember text-bg">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
