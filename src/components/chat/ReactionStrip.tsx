// Telegram-style aggregated-reaction strip rendered below a message bubble.
// Groups individual (user_id, emoji) reactions by emoji into pill counters;
// the caller's own reactions get an ember tint. Tapping a pill toggles the
// caller's reaction for that emoji.

import type { Reaction } from '@racass-pixel/quick-protocol';
import { messagingClient } from '../../api/messaging';
import { useChats } from '../../stores/useChats';

type Props = {
  messageId: string;
  reactions: Reaction[];
};

export function ReactionStrip({ messageId, reactions }: Props) {
  const currentUserId = useChats((s) => s.currentUserId);
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji: { emoji -> { count, mine } }.
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = counts.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (currentUserId && r.userId === currentUserId) cur.mine = true;
    counts.set(r.emoji, cur);
  }

  async function toggle(emoji: string, mine: boolean) {
    try {
      if (mine) {
        await messagingClient.removeReaction({ messageId, emoji });
      } else {
        await messagingClient.addReaction({ messageId, emoji });
      }
    } catch {
      // WS reconciles; swallow.
    }
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Array.from(counts.entries()).map(([emoji, info]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => void toggle(emoji, info.mine)}
          className={
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-none font-mono tabular-nums border transition-colors ' +
            (info.mine
              ? 'bg-ember/20 border-ember/40 text-ember'
              : 'bg-raised/60 border-line text-ink-2 hover:border-ember/40')
          }
        >
          <span className="text-[13px] leading-none">{emoji}</span>
          <span>{info.count}</span>
        </button>
      ))}
    </div>
  );
}
