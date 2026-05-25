import { useEffect, useState } from 'react';
import { checkHealth } from './api/health';
import { useTheme } from './theme/use-theme';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; version: string; commit: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const { theme, toggle } = useTheme();

  useEffect(() => {
    checkHealth()
      .then((r) => setStatus({ kind: 'ok', version: r.version, commit: r.commit }))
      .catch((e: unknown) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);

  return (
    <main className="relative min-h-screen flex items-center justify-center">
      <button
        onClick={toggle}
        className="absolute top-4 right-4 text-qk-muted hover:text-qk-text text-xs"
        type="button"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-qk-text">quick</h1>
        {status.kind === 'loading' && <p className="text-qk-muted text-sm">Connecting…</p>}
        {status.kind === 'error' && <p className="text-qk-danger text-sm">{status.message}</p>}
        {status.kind === 'ok' && (
          <p className="text-qk-muted text-sm font-mono">
            server v{status.version} · {status.commit.slice(0, 7) || 'unknown'}
          </p>
        )}
      </div>
    </main>
  );
}
