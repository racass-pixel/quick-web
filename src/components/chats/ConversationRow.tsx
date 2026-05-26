// Single row in the chats sidebar list. Telegram-Web-K style: 72px tall,
// 54px avatar, name 16/medium top-left, time 12/mono top-right, preview
// 14/ink-2 bottom-left, unread ember pill bottom-right.

import { Link } from '@tanstack/react-router';
import type { Conversation } from '@racass-pixel/quick-protocol';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';

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
  );
}
