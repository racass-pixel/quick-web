// Full-screen image viewer. Opens on click of an image bubble, dismisses on
// backdrop click / Escape / explicit close button. Provides a download link
// for the original blob.

import { useEffect } from 'react';
import { Download, X } from 'lucide-react';

type Props = {
  url: string;
  filename?: string;
  onClose(): void;
};

export function ImageLightbox({ url, filename, onClose }: Props) {
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <a
          href={url}
          download={filename ?? 'image'}
          onClick={(e) => e.stopPropagation()}
          target="_blank"
          rel="noreferrer"
          aria-label="Download"
          title="Download"
          className="w-10 h-10 rounded-full bg-panel/80 border border-line flex items-center justify-center text-ink-1 hover:text-ember hover:border-ember transition-colors"
        >
          <Download size={18} strokeWidth={2} />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-10 h-10 rounded-full bg-panel/80 border border-line flex items-center justify-center text-ink-1 hover:text-ember hover:border-ember transition-colors"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <img
        src={url}
        alt={filename ?? ''}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[92vh] object-contain"
      />
    </div>
  );
}
