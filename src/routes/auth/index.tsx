import { createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Route as RootRoute } from '../__root';
import { authClient } from '../../api/auth';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Kicker } from '../../components/primitives/Kicker';
import { checkHealth } from '../../api/health';

function AuthEmailScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<{ version: string; commit: string } | null>(null);

  useEffect(() => {
    checkHealth()
      .then((r) => setVersion({ version: r.version, commit: r.commit }))
      .catch(() => setVersion(null));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || !/^\S+@\S+\.\S+$/.test(value)) {
      setError('That doesn’t look like an email.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authClient.requestCode({ email: value });
      navigate({ to: '/auth/code', search: { email: value } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <Kicker>sign in · step 1 of 2</Kicker>
          <h1 className="text-3xl tracking-tighter mb-2 text-ink-1">
            What’s your email?
          </h1>
          <p className="text-ink-2 text-sm mb-8">
            We’ll send you a 6-digit code. No password.
          </p>
          <form onSubmit={onSubmit} className="space-y-6">
            <Input
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            {error && (
              <p className="text-err text-xs font-mono" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Sending…' : 'Continue'}
            </Button>
          </form>
        </div>
      </div>
      <footer className="px-6 py-4 border-t border-line text-ink-3 text-xs font-mono flex justify-between">
        <span>quick</span>
        <span>
          {version
            ? `server v${version.version} · ${version.commit.slice(0, 7) || 'unknown'}`
            : 'server offline'}
        </span>
      </footer>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/auth',
  component: AuthEmailScreen,
});
