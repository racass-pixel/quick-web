import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';

type Props = {
  onSend: (body: string) => Promise<void> | void;
  onTyping?: () => void;
  disabled?: boolean;
  placeholder?: string;
};

const LINE_HEIGHT_PX = 20; // matches text-sm leading-relaxed at default font size
const MIN_HEIGHT = 44;
const MAX_LINES = 6;

export function Composer({ onSend, onTyping, disabled, placeholder }: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize: reset height then expand up to MAX_LINES * LINE_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = MIN_HEIGHT + (MAX_LINES - 1) * LINE_HEIGHT_PX;
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), cap);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [value]);

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

  return (
    <div className="border-t border-line bg-bg">
      <div className="flex items-end gap-3 px-6 py-4">
        <textarea
          ref={ref}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          placeholder={placeholder ?? 'Write a message'}
          rows={1}
          className="flex-1 resize-none bg-transparent text-ink-1 placeholder:text-ink-3 border-0 border-b border-line py-2 px-1 focus:outline-none focus:border-ember transition-colors text-sm leading-relaxed disabled:opacity-50 min-h-[44px]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || sending || value.trim().length === 0}
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ember bg-ember text-bg hover:bg-ember-soft"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
