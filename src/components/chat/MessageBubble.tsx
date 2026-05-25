import type { Message } from '@racass-pixel/quick-protocol';

type Props = {
  message: Message;
  isOwn: boolean;
};

function fmtTime(seconds: bigint | undefined, nanos: number | undefined): string {
  if (seconds == null) return '';
  const ms = Number(seconds) * 1000 + Math.floor((nanos ?? 0) / 1_000_000);
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MessageBubble({ message, isOwn }: Props) {
  const time = fmtTime(message.createdAt?.seconds, message.createdAt?.nanos);
  const sideClass = isOwn ? 'ml-auto' : '';
  const surfaceClass = isOwn ? 'bg-panel border-line' : 'bg-raised border-line';
  return (
    <div className={`group flex flex-col gap-1 max-w-[70%] ${sideClass}`}>
      <div
        className={`border px-4 py-2 text-sm leading-relaxed text-ink-1 whitespace-pre-wrap break-words ${surfaceClass}`}
        title={time}
      >
        {message.body}
      </div>
      <div
        className={`text-[10px] font-mono uppercase tracking-wider text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity ${
          isOwn ? 'text-right' : 'text-left'
        }`}
      >
        {time}
      </div>
    </div>
  );
}
