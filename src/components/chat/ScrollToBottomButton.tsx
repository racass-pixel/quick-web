// Floating "jump to latest" button anchored to the bottom-right of the
// thread scroller. Telegram-style — 48px ember disc with a chevron and an
// unread-count mini badge on top-right.

import { ChevronDown } from 'lucide-react';

type Props = {
  unreadCount: number;
  onClick: () => void;
};

export function ScrollToBottomButton({ unreadCount, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        unreadCount > 0
          ? `Scroll to bottom (${unreadCount} unread)`
          : 'Scroll to bottom'
      }
      className="absolute right-6 bottom-24 w-12 h-12 rounded-full bg-ember text-bg shadow-lg flex items-center justify-center hover:bg-ember-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
    >
      <ChevronDown size={22} strokeWidth={2.25} />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center text-[11px] font-mono leading-none bg-bg text-ember border border-ember rounded-full">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
