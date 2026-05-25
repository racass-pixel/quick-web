import { createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Route as RootRoute } from '../__root';
import { authClient } from '../../api/auth';
import { session } from '../../api/session';
import { setCachedUser } from '../../stores/useAuth';
import { Button } from '../../components/primitives/Button';
import { Kicker } from '../../components/primitives/Kicker';
import { CodeInput } from '../../components/auth/CodeInput';

function AuthCodeScreen() {
  const navigate = useNavigate();
  // Read email from search params; if missing, bounce back.
  const search = Route.useSearch();
  const email = search.email;
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);

  useEffect(() => {
    if (!email) {
      navigate({ to: '/auth' });
    }
  }, [email, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(() => {
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  async function submitCode(c: string) {
    if (!email || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await authClient.verifyCode({ email, code: c });
      session.setToken(r.token);
      setCachedUser(r.user ?? null);
      if (r.isNewAccount) {
        navigate({ to: '/auth/profile' });
      } else {
        navigate({ to: '/friends' });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code.');
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!email || resendCooldown > 0) return;
    setError(null);
    try {
      await authClient.requestCode({ email });
      setResendCooldown(60);
      setCode('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not resend.');
    }
  }

  if (!email) return null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Kicker>sign in · step 2 of 2</Kicker>
        <h1 className="text-3xl tracking-tighter mb-2 text-ink-1">
          Check your email
        </h1>
        <p className="text-ink-2 text-sm mb-8 font-mono">
          code sent to{' '}
          <span className="text-ink-1">{email}</span>
        </p>
        <div className="space-y-6">
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            disabled={submitting}
          />
          {error && (
            <p className="text-err text-xs font-mono text-center" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between text-xs font-mono text-ink-3">
            <button
              type="button"
              onClick={() => navigate({ to: '/auth' })}
              className="hover:text-ember"
              disabled={submitting}
            >
              ← change email
            </button>
            {resendCooldown > 0 ? (
              <span>resend in {resendCooldown}s</span>
            ) : (
              <button
                type="button"
                onClick={resend}
                className="text-ink-1 hover:text-ember"
              >
                resend code
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            disabled={code.length !== 6 || submitting}
            onClick={() => submitCode(code)}
            className="w-full"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
      </div>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/auth/code',
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === 'string' ? search.email : '',
  }),
  component: AuthCodeScreen,
});
