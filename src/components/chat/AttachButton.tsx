// Composer paperclip button. Opens the OS file picker (multi-select on);
// callers receive the chosen files and drive the upload pipeline themselves.

import { useRef } from 'react';
import { Paperclip } from 'lucide-react';

type Props = {
  onPick(files: File[]): void;
  disabled?: boolean;
};

export function AttachButton({ onPick, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach files"
        title="Attach files"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-ember hover:bg-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        <Paperclip size={20} strokeWidth={2} />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length > 0) onPick(files);
          // Reset so picking the same file twice in a row still fires.
          e.target.value = '';
        }}
      />
    </>
  );
}
