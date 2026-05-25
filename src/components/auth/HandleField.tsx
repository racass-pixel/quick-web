import { Input } from '../primitives/Input';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

type Props = {
  value: string;
  onChange: (next: string) => void;
  suggestion?: string;
  disabled?: boolean;
};

export function HandleField({ value, onChange, suggestion, disabled }: Props) {
  const trimmed = value.trim();
  const invalid = trimmed.length > 0 && !HANDLE_RE.test(trimmed);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-ink-3 font-mono">@</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder={suggestion ?? 'your_handle'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'handle-error' : undefined}
          className="font-mono"
        />
      </div>
      {invalid && (
        <p id="handle-error" className="text-err text-xs font-mono">
          3–20 chars, lowercase letters, digits, underscore only.
        </p>
      )}
      {!invalid && suggestion && suggestion !== trimmed && (
        <p className="text-ink-3 text-xs font-mono">
          suggestion:{' '}
          <button
            type="button"
            onClick={() => onChange(suggestion)}
            className="text-ember hover:underline"
          >
            use &lsquo;{suggestion}&rsquo;
          </button>
        </p>
      )}
    </div>
  );
}

export { HANDLE_RE };
