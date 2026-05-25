// Lightweight session-token store backed by localStorage.
// Cross-tab updates work via the native "storage" event; intra-tab writes
// re-dispatch a synthetic storage event so subscribers also fire.

const KEY = 'quick.token';

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key === null || ev.key === KEY) emit();
  });
}

export const session = {
  get token(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(KEY);
  },
  setToken(t: string | null): void {
    if (typeof window === 'undefined') return;
    if (t === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, t);
    // Notify same-tab subscribers — the native "storage" event only fires
    // for other tabs/windows.
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: t }));
    emit();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
