// "..." menu shown in the DM header. For now it exposes a Block action that
// calls Users.block on the peer; on success we just close the menu (server
// will fan out conversation_removed if it deletes the DM on its end).

import { useState } from 'react';
import { usersClient } from '../../api/users';

export function DmHeaderMenu({
  peerUserId,
  peerHandle,
}: {
  peerUserId: string;
  peerHandle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    if (busy) return;
    const label = peerHandle ? `@${peerHandle}` : 'this user';
    if (!window.confirm(`Block ${label}? You won't receive their messages.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await usersClient.block({ userId: peerUserId });
      setOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not block.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Conversation menu"
        onClick={() => setOpen((v) => !v)}
        className="text-ink-2 hover:text-ember w-8 h-8 flex items-center justify-center border border-line hover:border-ember transition-colors text-sm font-mono"
      >
        ⋯
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute z-20 right-0 top-10 w-40 bg-bg border border-line shadow-lg py-1 text-sm"
          >
            <button
              type="button"
              onClick={block}
              disabled={busy}
              className="block w-full text-left px-3 py-2 text-ink-2 hover:text-err hover:bg-raised disabled:opacity-60"
            >
              {busy ? 'Blocking…' : 'Block'}
            </button>
            {error && (
              <p className="px-3 py-2 text-err text-xs font-mono" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
