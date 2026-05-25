import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Route as RootRoute } from './__root';
import { session } from '../api/session';
import { authClient } from '../api/auth';
import { usersClient } from '../api/users';
import { setCachedUser, useAuth } from '../stores/useAuth';
import { Button } from '../components/primitives/Button';
import { Input } from '../components/primitives/Input';
import { Kicker } from '../components/primitives/Kicker';
import { HANDLE_RE, HandleField } from '../components/auth/HandleField';

function SettingsScreen() {
  const navigate = useNavigate();
  const { user, isLoading, signOut } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setHandle(user.handle);
    }
  }, [user]);

  if (isLoading) return null;
  if (!user) {
    navigate({ to: '/auth' });
    return null;
  }

  const canSave =
    displayName.trim().length >= 1 &&
    displayName.trim().length <= 40 &&
    HANDLE_RE.test(handle.trim()) &&
    (displayName.trim() !== user.displayName || handle.trim() !== user.handle);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await usersClient.updateProfile({
        displayName: displayName.trim(),
        handle: handle.trim(),
      });
      if (r.user) setCachedUser(r.user);
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSubmitting(false);
    }
  }

  async function doSignOut() {
    try {
      await authClient.logout({});
    } catch {
      // ignore — proceed locally
    }
    signOut();
    navigate({ to: '/auth' });
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
        <Kicker>account</Kicker>
        <h1 className="text-3xl tracking-tighter mb-8 text-ink-1">Settings</h1>
        <form onSubmit={save} className="space-y-8">
          <div>
            <label className="kicker block mb-2">display name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
            />
          </div>
          <div>
            <label className="kicker block mb-2">handle</label>
            <HandleField value={handle} onChange={setHandle} />
          </div>
          {error && (
            <p className="text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canSave || submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
            {savedAt && (
              <span className="text-ink-3 text-xs font-mono">saved.</span>
            )}
          </div>
        </form>

        <hr className="my-12 border-line" />

        <Kicker>session</Kicker>
        <div className="flex items-center justify-between">
          <p className="text-ink-2 text-sm">
            Sign out of this device.
          </p>
          <Button variant="ghost" onClick={doSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/settings',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: SettingsScreen,
});
