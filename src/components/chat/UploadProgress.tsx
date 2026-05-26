// Small inline upload-progress card rendered in the composer above the input
// while one or more attachments are being uploaded. Shows per-file progress
// bars and a cancel button on each row.

import { X, FileIcon as FileIco, Image as ImageIco, Loader2 } from 'lucide-react';

export type PendingUpload = {
  id: string;
  name: string;
  isImage: boolean;
  // 0..1; -1 indicates an error.
  progress: number;
  error?: string;
};

type Props = {
  items: PendingUpload[];
  onCancel(id: string): void;
};

export function UploadProgress({ items, onCancel }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 px-3 py-2 bg-raised/60 border-t border-line">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2 text-[12px]">
          <span className="shrink-0 text-ink-3">
            {it.isImage ? <ImageIco size={14} /> : <FileIco size={14} />}
          </span>
          <span className="flex-1 min-w-0 text-ink-2 truncate">{it.name}</span>
          {it.error ? (
            <span className="text-err font-mono shrink-0">{it.error}</span>
          ) : it.progress >= 1 ? (
            <span className="text-ember font-mono shrink-0">ready</span>
          ) : (
            <div className="w-24 h-1.5 bg-bg rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-ember transition-all"
                style={{ width: `${Math.max(0, Math.min(1, it.progress)) * 100}%` }}
              />
            </div>
          )}
          {it.progress < 1 && !it.error && (
            <Loader2 size={12} className="animate-spin text-ember shrink-0" />
          )}
          <button
            type="button"
            onClick={() => onCancel(it.id)}
            aria-label="Remove attachment"
            className="w-6 h-6 rounded-full flex items-center justify-center text-ink-3 hover:text-err hover:bg-raised transition-colors shrink-0"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
