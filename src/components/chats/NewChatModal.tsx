// Modal for starting a new DM. Live-searches users by handle prefix (no @
// needed) and opens a DM with the clicked result, then routes to /chats/{id}.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { User } from '@racass-pixel/quick-protocol';
import { usersClient } from '../../api/users';
import { messagingClient } from '../../api/messaging';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

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
        setResults(r.users ?? []);
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
  }, [query]);

  async function openDm(userId: string) {
    setOpening(userId);
    setError(null);
    try {
      const r = await messagingClient.openDM({ userId });
      const id = r.conversation?.id;
      if (!id) throw new Error('No conversation returned.');
      onClose();
      navigate({ to: '/chats/$id', params: { id } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open DM.');
      setOpening(null);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-bg/80 pt-24 px-4">
      <button
        type="button"
        aria-hidden
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative bg-bg border border-line w-full max-w-md shadow-lg">
        <div className="px-5 pt-5 pb-3 border-b border-line flex items-center justify-between">
          <Kicker className="mb-0">new dm</Kicker>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 text-xs font-mono hover:text-ember"
          >
            close
          </button>
        </div>
        <div className="px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="text-ink-3 font-mono text-sm">@</span>
            <input
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="handle"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-ink-1 placeholder:text-ink-3 border-0 border-b border-line py-1 px-1 focus:outline-none focus:border-ember transition-colors text-sm font-mono"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {error && (
            <p className="px-5 py-3 text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
          {!query.trim() && !loading && (
            <p className="px-5 py-6 text-ink-3 text-sm">
              Start typing a handle to find someone.
            </p>
          )}
          {loading && (
            <p className="px-5 py-3 text-ink-3 text-xs font-mono cursor-blink">
              searching
            </p>
          )}
          {!loading && query.trim() && results.length === 0 && !error && (
            <p className="px-5 py-6 text-ink-3 text-sm">No matches.</p>
          )}
          <ul className="divide-y divide-line">
            {results.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={opening === u.id}
                  onClick={() => openDm(u.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-raised transition-colors text-left disabled:opacity-60"
                >
                  <Avatar
                    displayName={u.displayName}
                    color={u.avatarColor}
                    size={36}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-ink-1 text-sm truncate">
                      {u.displayName}
                    </div>
                    <div className="text-ink-3 text-xs font-mono truncate">
                      @{u.handle}
                    </div>
                  </div>
                  {opening === u.id && (
                    <span className="text-ink-3 text-xs font-mono">
                      opening…
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
