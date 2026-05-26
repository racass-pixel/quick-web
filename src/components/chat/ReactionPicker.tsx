// Small 6-emoji quick-pick popover that floats next to a message bubble.
// Telegram-style choice set + a "+" expander button that flips the popover
// into a wider grid of common emojis. Calls AddReaction / RemoveReaction
// via messagingClient and closes itself.

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { messagingClient } from '../../api/messaging';

type Props = {
  messageId: string;
  // The set of emojis the current user has already reacted with. Tapping one
  // of these toggles (removes) the reaction instead of re-adding it.
  myEmojis: Set<string>;
  anchor: { x: number; y: number };
  onClose(): void;
};

const QUICK: string[] = ['heart', 'thumbs-up', 'thumbs-down', 'fire', '100', 'joy'];

// Map our internal slugs to the actual unicode glyphs. Keeping a slug layer
// lets us swap to a dedicated emoji font later without touching call sites.
const SLUG_TO_GLYPH: Record<string, string> = {
  heart: '❤️',
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  fire: '🔥',
  '100': '💯',
  joy: '😂',
  cry: '😢',
  rage: '😡',
  party: '🎉',
  clap: '👏',
  pray: '🙏',
  eyes: '👀',
  rocket: '🚀',
  star: '⭐',
  check: '✅',
  cross: '❌',
};

const EXTRA_SLUGS = [
  'cry', 'rage', 'party', 'clap', 'pray', 'eyes', 'rocket', 'star', 'check', 'cross',
];

const PANEL_W = 260;
const PANEL_H = 56;

export function ReactionPicker({ messageId, myEmojis, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Outside-click + Escape to close.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    function onClick(ev: MouseEvent) {
      const el = ref.current;
      if (el && !el.contains(ev.target as Node)) onClose();
    }
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onClick);
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.clearTimeout(t);
    };
  }, [onClose]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const pad = 8;
  const left = Math.min(Math.max(pad, anchor.x - PANEL_W / 2), vw - PANEL_W - pad);
  const top = Math.min(Math.max(pad, anchor.y - PANEL_H - 8), vh - PANEL_H - pad);

  async function pick(emoji: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (myEmojis.has(emoji)) {
        await messagingClient.removeReaction({ messageId, emoji });
      } else {
        await messagingClient.addReaction({ messageId, emoji });
      }
      onClose();
    } catch {
      // WS-driven update is the source of truth; if the call fails just close.
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const slugs = expanded ? [...QUICK, ...EXTRA_SLUGS] : QUICK;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="React to message"
      className={
        'fixed z-50 bg-panel border border-line rounded-full shadow-xl px-2 py-1.5 flex items-center gap-0.5 ' +
        (expanded ? 'flex-wrap max-w-[320px]' : '')
      }
      style={{ left, top }}
    >
      {slugs.map((slug) => {
        const glyph = SLUG_TO_GLYPH[slug];
        const mine = myEmojis.has(glyph);
        return (
          <button
            key={slug}
            type="button"
            onClick={() => void pick(glyph)}
            disabled={busy}
            aria-label={`React with ${slug}`}
            className={
              'w-8 h-8 rounded-full flex items-center justify-center text-[18px] leading-none transition-transform hover:scale-125 ' +
              (mine ? 'bg-ember/20' : 'hover:bg-raised') +
              ' disabled:opacity-50'
            }
          >
            {glyph}
          </button>
        );
      })}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="More reactions"
          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:bg-raised hover:text-ink-1 transition-colors"
        >
          <Plus size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
