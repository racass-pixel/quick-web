// Chip-style multi-select user picker. Renders an inline list of chosen
// users, an input that live-searches users by handle prefix, and an
// auto-suggest dropdown of unselected matches.

import { useEffect, useRef, useState } from 'react';
import type { User } from '@racass-pixel/quick-protocol';
import { usersClient } from '../../api/users';
import { Avatar } from '../primitives/Avatar';

type Props = {
  value: User[];
  onChange: (next: User[]) => void;
  placeholder?: string;
};

export function UserMultiPicker({ value, onChange, placeholder = 'Add by handle…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const selectedIds = new Set(value.map((u) => u.id));

  useEffect(() => {
    const cleaned = query.trim().toLowerCase().replace(/^@/, '');
    setError(null);
    if (!cleaned) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await usersClient.search({
          handlePrefix: cleaned,
          limit: 10,
        });
        setResults((r.users ?? []).filter((u) => !selectedIds.has(u.id)));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Search failed.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // selectedIds derived each render; safe to depend only on query + value length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, value.length]);

  function pick(u: User) {
    onChange([...value, u]);
    setQuery('');
    setResults([]);
  }

  function remove(id: string) {
    onChange(value.filter((u) => u.id !== id));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center border border-line px-2 py-2 min-h-[44px] bg-bg">
        {value.map((u) => (
          <span
            key={u.id}
            className="flex items-center gap-1.5 bg-raised border border-line px-2 py-0.5 text-xs"
          >
            <span className="text-ink-1">{u.displayName}</span>
            <span className="text-ink-3 font-mono">@{u.handle}</span>
            <button
              type="button"
              onClick={() => remove(u.id)}
              className="text-ink-3 hover:text-ember font-mono text-sm leading-none ml-1"
              aria-label={`Remove ${u.handle}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={value.length === 0 ? placeholder : ''}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 min-w-[140px] bg-transparent text-ink-1 placeholder:text-ink-3 text-sm font-mono px-1 py-1 focus:outline-none"
        />
      </div>
      {query.trim() && (
        <div className="border-x border-b border-line max-h-64 overflow-y-auto">
          {loading && (
            <p className="px-3 py-2 text-ink-3 text-xs font-mono cursor-blink">
              searching
            </p>
          )}
          {error && (
            <p className="px-3 py-2 text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && results.length === 0 && (
            <p className="px-3 py-2 text-ink-3 text-xs">No matches.</p>
          )}
          <ul className="divide-y divide-line">
            {results.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => pick(u)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-raised transition-colors text-left"
                >
                  <Avatar
                    displayName={u.displayName}
                    color={u.avatarColor}
                    size={28}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-ink-1 text-sm truncate">
                      {u.displayName}
                    </div>
                    <div className="text-ink-3 text-xs font-mono truncate">
                      @{u.handle}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
