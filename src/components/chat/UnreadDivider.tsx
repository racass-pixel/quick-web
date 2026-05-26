// Telegram-style horizontal hairline with an ember pill in the middle,
// rendered just above the first unread message in a thread. Stays in place
// until the conversation is closed and reopened — it doesn't disappear as
// the user reads.

type Props = {
  count: number;
};

export function UnreadDivider({ count }: Props) {
  if (count <= 0) return null;
  const label = `${count} unread ${count === 1 ? 'message' : 'messages'}`;
  return (
    <div
      className="relative my-2 flex items-center select-none"
      role="separator"
      aria-label={label}
    >
      <div className="flex-1 h-px bg-ember/40" />
      <div className="mx-3 text-[11px] font-mono uppercase tracking-wider text-bg bg-ember rounded-full px-2.5 py-0.5">
        {label}
      </div>
      <div className="flex-1 h-px bg-ember/40" />
    </div>
  );
}
