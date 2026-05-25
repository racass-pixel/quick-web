// TG-style composer.
//
// Layout:  [📎]  [ textarea (auto-grow 44→120) ]  [🎤 / ➤]
//
// The right-side button morphs: a microphone icon when the input is empty
// (voice — placeholder for a future feature), an ember send arrow when the
// user has typed something. Both are crossfaded with a 150ms transition.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { Mic, Paperclip, Send } from 'lucide-react';

type Props = {
  onSend: (body: string) => Promise<void> | void;
  onTyping?: () => void;
  disabled?: boolean;
  placeholder?: string;
};

const LINE_HEIGHT_PX = 20;
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 120;

export function Composer({ onSend, onTyping, disabled, placeholder }: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize: reset height then expand up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  // Reference LINE_HEIGHT_PX so it isn't dead — handy elsewhere if the
  // composer ever needs to enforce a precise line count.
  void LINE_HEIGHT_PX;

  async function submit() {
    const body = value.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setValue('');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void submit();
    }
  }

  function handleChange(ev: ChangeEvent<HTMLTextAreaElement>) {
    setValue(ev.target.value);
    if (ev.target.value.trim().length > 0) onTyping?.();
  }

  const hasText = value.trim().length > 0;

  return (
    <div className="border-t border-line bg-bg px-3 py-2">
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach (coming soon)"
          title="Attach (coming soon)"
          disabled
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:bg-raised transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        >
          <Paperclip size={20} strokeWidth={2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          placeholder={placeholder ?? 'Write a message'}
          rows={1}
          className="flex-1 resize-none bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent rounded-2xl px-4 py-2.5 focus:outline-none focus:border-ember/40 transition-colors text-[15px] leading-snug disabled:opacity-50 min-h-[44px]"
        />

        <div className="relative w-10 h-10 shrink-0">
          {/* Mic — voice placeholder, fades out when text appears. */}
          <button
            type="button"
            aria-label="Record voice (coming soon)"
            title="Record voice (coming soon)"
            disabled
            className={
              'absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:bg-raised transition-opacity duration-150 disabled:cursor-not-allowed ' +
              (hasText ? 'opacity-0 pointer-events-none' : 'opacity-100')
            }
          >
            <Mic size={20} strokeWidth={2} />
          </button>
          {/* Send — primary action, fades in once there's text. */}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || sending || !hasText}
            aria-label="Send"
            title="Send"
            className={
              'absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center bg-ember text-bg hover:bg-ember-soft transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ember ' +
              (hasText ? 'opacity-100' : 'opacity-0 pointer-events-none')
            }
          >
            <Send size={18} strokeWidth={2.25} className="-ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
