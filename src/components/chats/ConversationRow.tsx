import type { Conversation } from '@racass-pixel/quick-protocol';
import { Link } from '@tanstack/react-router';

export function ConversationRow({ conv, active }: { conv: Conversation; active: boolean }) {
  const name = conv.peer?.displayName ?? conv.title ?? 'Conversation';
  return (
    <Link
      to="/chats/$id"
      params={{ id: conv.id }}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors ${
        active ? 'bg-raised' : ''
      }`}
    >
      <span className="text-ink-1 text-sm truncate">{name}</span>
    </Link>
  );
}
