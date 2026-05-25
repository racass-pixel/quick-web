// Single row in the chats sidebar list. Telegram-style: 60px tall, with
// avatar, title, last-message preview, timestamp, and unread badge. Title is
// the peer's display name for DMs, otherwise the conversation title.

import { Link } from '@tanstack/react-router';
import type { Conversation } from '@racass-pixel/quick-protocol';
import { Avatar } from '../primitives/Avatar';

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

function kindBadge(type: string): string | null {
  if (type === 'group') return 'G';
  if (type === 'channel') return 'C';
  return null;
}

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

  return (
    <Link
      to="/chats/$id"
      params={{ id: conv.id }}
      className={`flex items-center gap-3 px-4 h-[60px] hover:bg-raised transition-colors ${
        active ? 'bg-raised' : ''
      }`}
    >
      <div className="relative shrink-0">
        <Avatar displayName={displayName} color={avatarColor} size={42} />
        {badge && (
          <span className="absolute -bottom-0.5 -right-0.5 text-[9px] font-mono px-1 py-px bg-bg text-ink-2 border border-line">
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-ink-1 text-sm truncate flex-1">
            {displayName}
          </span>
          <span className="text-ink-3 text-[10px] font-mono uppercase tracking-wider shrink-0">
            {formatRelative(ms)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-ink-3 text-xs truncate flex-1">
            {previewText || (isDm && handle ? `@${handle}` : '')}
          </span>
          {conv.unreadCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-ember text-bg shrink-0">
              {conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
