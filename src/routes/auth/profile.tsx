import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Route as RootRoute } from '../__root';
import { session } from '../../api/session';
import { usersClient } from '../../api/users';
import { setCachedUser, useAuth } from '../../stores/useAuth';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Kicker } from '../../components/primitives/Kicker';
import { HandleField, HANDLE_RE } from '../../components/auth/HandleField';

function AuthProfileScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setHandle(user.handle ?? '');
    }
  }, [user]);

  if (isLoading || !user) return null;

  const canSubmit =
    displayName.trim().length >= 1 &&
    displayName.trim().length <= 40 &&
    HANDLE_RE.test(handle.trim());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await usersClient.updateProfile({
        displayName: displayName.trim(),
        handle: handle.trim(),
      });
      if (r.user) setCachedUser(r.user);
      navigate({ to: '/friends' });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Kicker>welcome</Kicker>
        <h1 className="text-3xl tracking-tighter mb-2 text-ink-1">
          Pick a name & handle
        </h1>
        <p className="text-ink-2 text-sm mb-8">
          Both are visible to anyone you connect with. You can change them
          later in settings.
        </p>
        <form onSubmit={onSubmit} className="space-y-8">
          <div>
            <label className="kicker block mb-2">display name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              autoFocus
              autoComplete="name"
              placeholder="e.g. Anna"
            />
          </div>
          <div>
            <label className="kicker block mb-2">handle</label>
            <HandleField
              value={handle}
              onChange={setHandle}
              suggestion={user.handle}
            />
          </div>
          {error && (
            <p className="text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={!canSubmit || submitting}
            className="w-full"
          >
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        </form>
      </div>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/auth/profile',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: AuthProfileScreen,
});
