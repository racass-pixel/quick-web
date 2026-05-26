// Telegram-style profile card. Opens whenever any avatar in the app is
// clicked (sidebar row, thread header, group attribution, members modal,
// etc). Two actions: «Send message» → openDM + route, «Block» → Users.block.

import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';
import { useAuth } from '../../stores/useAuth';
import { messagingClient } from '../../api/messaging';
import { usersClient } from '../../api/users';

export function ProfileModal() {
  const user = useProfile((s) => s.user);
  const close = useProfile((s) => s.close);
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [busy, setBusy] = useState<'dm' | 'block' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, close]);

  // Reset transient state every time the modal opens/closes.
  useEffect(() => {
    setBusy(null);
    setError(null);
  }, [user?.id]);

  if (!user) return null;

  const isSelf = !!me && me.id === user.id;

  async function sendMessage() {
    if (!user || busy) return;
    setBusy('dm');
    setError(null);
    try {
      const r = await messagingClient.openDM({ userId: user.id });
      const id = r.conversation?.id;
      if (!id) throw new Error('No conversation returned.');
      close();
      navigate({ to: '/chats/$id', params: { id } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open DM.');
    } finally {
      setBusy(null);
    }
  }

  async function block() {
    if (!user || busy) return;
    const label = user.handle ? `@${user.handle}` : user.displayName || 'this user';
    if (!window.confirm(`Block ${label}? You won't receive their messages.`)) return;
    setBusy('block');
    setError(null);
    try {
      await usersClient.block({ userId: user.id });
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not block.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close profile"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        className="relative bg-panel border border-line rounded-lg p-8 w-[420px] max-w-full shadow-2xl"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <Avatar
            displayName={user.displayName || user.handle || '?'}
            color={user.avatarColor}
            size={88}
          />
          <div className="space-y-1">
            <div className="text-xl text-ink-1">
              {user.displayName || user.handle || 'Unknown'}
            </div>
            {user.handle && (
              <div className="text-sm font-mono text-ink-3">@{user.handle}</div>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 text-err text-xs font-mono text-center" role="alert">
            {error}
          </p>
        )}

        {!isSelf && (
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={sendMessage}
              disabled={busy !== null}
              className="h-10 rounded-md bg-ember text-bg font-medium hover:bg-ember-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {busy === 'dm' ? 'Opening…' : 'Send message'}
            </button>
            <button
              type="button"
              onClick={block}
              disabled={busy !== null}
              className="h-10 rounded-md border border-err/60 text-err hover:bg-err/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-err"
            >
              {busy === 'block' ? 'Blocking…' : 'Block'}
            </button>
          </div>
        )}

        {isSelf && (
          <p className="mt-6 text-center text-ink-3 text-xs font-mono">
            this is you
          </p>
        )}

        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 text-ink-3 hover:text-ember text-xs font-mono"
        >
          close
        </button>
      </div>
    </div>
  );
}
