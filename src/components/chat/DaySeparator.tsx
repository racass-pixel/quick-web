// Day-grouping separator. Drops a centered pill between message groups
// labelled "Today", "Yesterday", or e.g. "12 May".

export function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  // Same year as today → "12 May"; older → include the year too.
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-2 select-none" role="separator" aria-label={label}>
      <div className="flex-1 h-px bg-line" />
      <span className="text-[11px] font-mono uppercase tracking-wider text-ink-3 px-3 py-1 bg-panel/60 rounded-full">
        {label}
      </span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}
