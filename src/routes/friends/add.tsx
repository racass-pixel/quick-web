import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@racass-pixel/quick-protocol';
import { Route as RootRoute } from '../__root';
import { session } from '../../api/session';
import { usersClient } from '../../api/users';
import { friendsClient } from '../../api/friends';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Kicker } from '../../components/primitives/Kicker';
import { HANDLE_RE } from '../../components/auth/HandleField';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; user: User }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

function AddFriendScreen() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const cleaned = query.trim().toLowerCase().replace(/^@/, '');
    setSendError(null);
    if (!cleaned) {
      setState({ kind: 'idle' });
      return;
    }
    if (!HANDLE_RE.test(cleaned)) {
      setState({ kind: 'idle' });
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setState({ kind: 'searching' });
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await usersClient.search({ handle: cleaned });
        if (r.user) setState({ kind: 'found', user: r.user });
        else setState({ kind: 'empty' });
      } catch (e: unknown) {
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Search failed.',
        });
      }
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function sendRequest(handle: string) {
    setSending(true);
    setSendError(null);
    try {
      await friendsClient.sendRequest({ handle });
      navigate({ to: '/friends' });
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Could not send request.');
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-start justify-center px-6 py-24">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Link
            to="/friends"
            className="text-ink-3 hover:text-ember text-xs font-mono"
          >
            ← back
          </Link>
        </div>
        <Kicker>find someone</Kicker>
        <h1 className="text-3xl tracking-tighter mb-8 text-ink-1">
          Search by handle
        </h1>
        <div className="flex items-center gap-2 mb-8">
          <span className="text-ink-3 font-mono">@</span>
          <Input
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="their_handle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="font-mono"
          />
        </div>

        {state.kind === 'searching' && (
          <p className="text-ink-3 font-mono text-xs cursor-blink">
            searching
          </p>
        )}
        {state.kind === 'empty' && (
          <p className="text-ink-2 text-sm">
            No one with that handle yet.
          </p>
        )}
        {state.kind === 'error' && (
          <p className="text-err text-xs font-mono" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === 'found' && (
          <div className="card-raised p-6 flex items-center gap-4">
            <Avatar
              displayName={state.user.displayName}
              color={state.user.avatarColor}
              size={48}
            />
            <div className="flex-1 min-w-0">
              <div className="text-ink-1 truncate">
                {state.user.displayName}
              </div>
              <div className="text-ink-3 text-xs font-mono truncate">
                @{state.user.handle}
              </div>
            </div>
            <Button
              onClick={() => sendRequest(state.user.handle)}
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        )}
        {sendError && (
          <p className="text-err text-xs font-mono mt-4" role="alert">
            {sendError}
          </p>
        )}
      </div>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/friends/add',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: AddFriendScreen,
});
