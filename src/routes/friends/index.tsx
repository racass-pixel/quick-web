import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { Friendship } from '@racass-pixel/quick-protocol';
import { Route as RootRoute } from '../__root';
import { session } from '../../api/session';
import { friendsClient } from '../../api/friends';
import { messagingClient } from '../../api/messaging';
import { useAuth } from '../../stores/useAuth';
import { AppSidebar } from '../../components/AppSidebar';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Kicker } from '../../components/primitives/Kicker';

function FriendsScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [friends, setFriends] = useState<Friendship[] | null>(null);
  const [requests, setRequests] = useState<Friendship[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [f, r] = await Promise.all([
        friendsClient.listFriends({}),
        friendsClient.listRequests({}),
      ]);
      setFriends(f.friends);
      setRequests(r.requests);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load friends.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return null;
  if (!user) {
    navigate({ to: '/auth' });
    return null;
  }

  async function accept(id: string) {
    setBusy(id);
    try {
      await friendsClient.accept({ friendshipId: id });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not accept.');
    } finally {
      setBusy(null);
    }
  }

  async function decline(id: string) {
    setBusy(id);
    try {
      await friendsClient.decline({ friendshipId: id });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not decline.');
    } finally {
      setBusy(null);
    }
  }

  async function openDm(peerId: string) {
    if (!peerId) return;
    setBusy(peerId);
    setError(null);
    try {
      const res = await messagingClient.openDM({ userId: peerId });
      const conv = res.conversation;
      if (!conv?.id) throw new Error('No conversation returned.');
      navigate({ to: '/chats/$id', params: { id: conv.id } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open DM.');
    } finally {
      setBusy(null);
    }
  }

  const hasIncoming = (requests?.length ?? 0) > 0;
  const hasFriends = (friends?.length ?? 0) > 0;

  return (
    <main className="min-h-screen flex">
      <AppSidebar />

      <section className="flex-1 px-6 md:px-12 py-12 md:py-24">
        <Kicker>your network</Kicker>
        <h1 className="text-3xl tracking-tighter mb-8 text-ink-1">Friends</h1>

        {error && (
          <p className="text-err text-xs font-mono mb-6" role="alert">
            {error}
          </p>
        )}

        {hasIncoming && (
          <div className="mb-12">
            <Kicker>incoming requests · {requests?.length ?? 0}</Kicker>
            <ul className="divide-y divide-line">
              {(requests ?? []).map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-4 py-4"
                >
                  <Avatar
                    displayName={req.peer?.displayName ?? '?'}
                    color={req.peer?.avatarColor ?? ''}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-ink-1 truncate">
                      {req.peer?.displayName}
                    </div>
                    <div className="text-ink-3 text-xs font-mono truncate">
                      @{req.peer?.handle}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => accept(req.id)}
                      disabled={busy === req.id}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => decline(req.id)}
                      disabled={busy === req.id}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasFriends ? (
          <div>
            <Kicker>connected · {friends?.length ?? 0}</Kicker>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-line">
              {(friends ?? []).map((f) => (
                <li
                  key={f.id}
                  className="card-raised p-6 flex items-center gap-4 hover:border-ember transition-colors"
                >
                  <Avatar
                    displayName={f.peer?.displayName ?? '?'}
                    color={f.peer?.avatarColor ?? ''}
                    size={48}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-ink-1 truncate">
                      {f.peer?.displayName}
                    </div>
                    <div className="text-ink-3 text-xs font-mono truncate">
                      @{f.peer?.handle}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => openDm(f.peer?.id ?? '')}
                    disabled={busy === f.peer?.id || !f.peer?.id}
                  >
                    Message
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          !hasIncoming && (
            <div className="mt-16">
              <Kicker>no friends yet</Kicker>
              <p className="text-ink-2 max-w-md">
                Find your friends by their <span className="font-mono text-ink-1">@handle</span>.{' '}
                <Link
                  to="/friends/add"
                  className="text-ember hover:underline"
                >
                  Add someone →
                </Link>
              </p>
            </div>
          )
        )}
      </section>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/friends',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: FriendsScreen,
});
