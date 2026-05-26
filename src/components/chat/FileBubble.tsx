// File-attachment card. Shows a generic file icon, the original filename,
// and a human-readable size. The whole row is an anchor that downloads the
// file (the server returns a signed URL with Content-Disposition: attachment
// in practice, but we still hint `download` for browsers that honour it).

import { Download, FileIcon } from 'lucide-react';

type Props = {
  url: string;
  filename: string;
  sizeBytes: number;
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function FileBubble({ url, filename, sizeBytes }: Props) {
  return (
    <a
      href={url}
      download={filename}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-3 px-3 py-2 rounded-md bg-raised/60 border border-line hover:border-ember/60 transition-colors group max-w-full"
    >
      <span className="w-10 h-10 rounded-md bg-ember/10 border border-ember/30 flex items-center justify-center text-ember shrink-0">
        <FileIcon size={18} strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-ink-1 text-[13px] truncate">{filename}</span>
        <span className="block text-ink-3 text-[11px] font-mono tabular-nums">
          {fmtSize(sizeBytes)}
        </span>
      </span>
      <Download
        size={16}
        strokeWidth={2}
        className="text-ink-3 group-hover:text-ember transition-colors shrink-0"
      />
    </a>
  );
}
