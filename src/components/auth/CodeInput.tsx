import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  length?: number;
};

const DIGIT_RE = /^[0-9]$/;

export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  length = 6,
}: Props) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = padTo(value, length);

  // Auto-focus the first empty box on mount.
  useEffect(() => {
    const i = digits.findIndex((d) => !d);
    const target = i === -1 ? length - 1 : i;
    refs.current[target]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAt(i: number, next: string) {
    const arr = digits.slice();
    arr[i] = next;
    const joined = arr.join('').slice(0, length);
    onChange(joined);
    if (joined.length === length && /^\d+$/.test(joined)) {
      // Defer to next tick so the keystroke fully commits before the parent
      // potentially navigates away.
      queueMicrotask(() => onComplete(joined));
    }
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const k = e.key;
    if (k === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        setAt(i, '');
      } else if (i > 0) {
        const arr = digits.slice();
        arr[i - 1] = '';
        onChange(arr.join(''));
        refs.current[i - 1]?.focus();
      }
      return;
    }
    if (k === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
      return;
    }
    if (k === 'ArrowRight' && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
      return;
    }
    if (DIGIT_RE.test(k)) {
      e.preventDefault();
      setAt(i, k);
      if (i < length - 1) refs.current[i + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const raw = e.clipboardData.getData('text');
    const cleaned = (raw.match(/\d/g) ?? []).slice(0, length).join('');
    if (!cleaned) return;
    e.preventDefault();
    const filled = cleaned.padEnd(0, '');
    onChange(filled);
    const focusTarget = Math.min(cleaned.length, length - 1);
    refs.current[focusTarget]?.focus();
    if (cleaned.length === length) {
      queueMicrotask(() => onComplete(cleaned));
    }
  }

  return (
    <div className="flex gap-2 justify-center" role="group" aria-label="Verification code">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digits[i] ?? ''}
          onChange={() => {
            /* handled in keydown/paste — onChange noop to silence React warning */
          }}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className={
            'w-12 h-14 text-center font-mono text-3xl tabular-nums ' +
            'bg-transparent text-ink-1 ' +
            'border-0 border-b border-line ' +
            'focus:outline-none focus:border-ember transition-colors ' +
            'disabled:opacity-40 caret-ember'
          }
        />
      ))}
    </div>
  );
}

function padTo(value: string, length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i++) out.push(value[i] ?? '');
  return out;
}
