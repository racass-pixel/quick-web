// Three-dot typing animation rendered inline. Uses CSS opacity keyframes —
// declared inline so we don't need to touch globals.css for a one-off.

export function TypingDot({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-3 text-xs font-mono">
      <span className="flex gap-1">
        <span
          className="inline-block w-1 h-1 rounded-full bg-ink-3"
          style={{ animation: 'typing-dot 1.2s infinite', animationDelay: '0s' }}
        />
        <span
          className="inline-block w-1 h-1 rounded-full bg-ink-3"
          style={{ animation: 'typing-dot 1.2s infinite', animationDelay: '0.15s' }}
        />
        <span
          className="inline-block w-1 h-1 rounded-full bg-ink-3"
          style={{ animation: 'typing-dot 1.2s infinite', animationDelay: '0.3s' }}
        />
      </span>
      {label ? <span>{label}</span> : null}
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
}
