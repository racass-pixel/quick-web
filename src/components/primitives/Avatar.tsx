type Props = {
  displayName: string;
  color: string;
  size?: number;
};

export function Avatar({ displayName, color, size = 40 }: Props) {
  const initials = (displayName.trim().slice(0, 1) || '?').toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center text-bg font-medium select-none"
      style={{
        background: color || 'var(--color-ember)',
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
