// Telegram K-style settings panel. Slides in over the chat list from the
// left at the same width as the sidebar. Lets the user edit their display
// name, handle, and bio (saved on blur) and exposes a redundant Logout entry.

import { useEffect, useState } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';
import type { User } from '@racass-pixel/quick-protocol';
import { usersClient } from '../../api/users';
import { setCachedUser } from '../../stores/useAuth';
import { Avatar } from '../primitives/Avatar';
import { HANDLE_RE } from '../auth/HandleField';

type Props = {
  open: boolean;
  user: User;
  onClose: () => void;
  onLogout: () => void;
};

export function SettingsPanel({ open, user, onClose, onLogout }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);

  // Reset local form state whenever the panel reopens or the underlying
  // user changes — otherwise edits made on the route-level page would be
  // overwritten by stale local state.
  useEffect(() => {
    if (open) {
      setDisplayName(user.displayName);
      setHandle(user.handle);
      setBio(user.bio ?? '');
      setNameError(null);
      setHandleError(null);
      setBioError(null);
    }
  }, [open, user.displayName, user.handle, user.bio]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function saveDisplayName() {
    const next = displayName.trim();
    if (next === user.displayName) return;
    if (next.length < 1 || next.length > 40) {
      setNameError('1–40 characters.');
      return;
    }
    setNameError(null);
    try {
      const r = await usersClient.updateProfile({ displayName: next });
      if (r.user) setCachedUser(r.user);
    } catch (e: unknown) {
      setNameError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  async function saveHandle() {
    const next = handle.trim();
    if (next === user.handle) return;
    if (!HANDLE_RE.test(next)) {
      setHandleError('3–20 chars, a–z, 0–9, _.');
      return;
    }
    setHandleError(null);
    try {
      const r = await usersClient.updateProfile({ handle: next });
      if (r.user) setCachedUser(r.user);
    } catch (e: unknown) {
      setHandleError(e instanceof Error ? e.message : 'Handle unavailable.');
    }
  }

  async function saveBio() {
    const next = bio.trim();
    if (next === (user.bio ?? '')) return;
    if (next.length > 256) {
      setBioError('Max 256 characters.');
      return;
    }
    setBioError(null);
    try {
      const r = await usersClient.updateProfile({ bio: next });
      if (r.user) setCachedUser(r.user);
    } catch (e: unknown) {
      setBioError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <aside
      aria-label="Settings"
      aria-hidden={!open}
      className={
        'absolute inset-y-0 left-0 w-full md:w-[360px] bg-bg border-r border-line ' +
        'z-50 flex flex-col transition-transform duration-200 ease-out ' +
        (open ? 'translate-x-0' : '-translate-x-full pointer-events-none')
      }
    >
      {/* Header */}
      <div className="h-14 px-3 flex items-center gap-2 border-b border-line shrink-0">
        <button
          type="button"
          aria-label="Back"
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors"
        >
          <ArrowLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="text-ink-1 text-base font-medium">Settings</h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Edit profile */}
        <section className="p-5 border-b border-line">
          <div className="flex items-center gap-4 mb-6">
            <Avatar
              displayName={user.displayName}
              color={user.avatarColor}
              size={80}
            />
            <div className="min-w-0">
              <div className="text-ink-1 text-base font-medium truncate">
                {user.displayName}
              </div>
              <div className="text-ink-3 text-sm font-mono truncate">
                @{user.handle}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <Field
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              onBlur={saveDisplayName}
              maxLength={40}
              error={nameError}
            />
            <Field
              label="Handle"
              value={handle}
              onChange={setHandle}
              onBlur={saveHandle}
              prefix="@"
              error={handleError}
            />
            <div>
              <label className="block text-xs font-mono text-ink-3 mb-2">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                onBlur={saveBio}
                maxLength={256}
                placeholder="A few words about yourself"
                rows={3}
                className="w-full bg-raised/40 text-ink-1 placeholder:text-ink-3 border border-line rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-ember transition-colors"
              />
              {bioError && (
                <p className="mt-1 text-err text-xs font-mono" role="alert">
                  {bioError}
                </p>
              )}
              <p className="mt-1 text-[10px] font-mono text-ink-3 text-right">
                {bio.length}/256
              </p>
            </div>
          </div>
        </section>

        {/* Account */}
        <section className="p-5">
          <div className="text-xs font-mono text-ink-3 mb-3 uppercase tracking-wider">
            Account
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={onLogout}
              className="w-full h-11 px-1 flex items-center gap-4 text-sm text-left text-err hover:bg-raised/40 rounded transition-colors"
            >
              <LogOut size={20} />
              <span>Log out</span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  maxLength,
  prefix,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  maxLength?: number;
  prefix?: string;
  error?: string | null;
}) {
  return (
    <div>
      <label className="block text-xs font-mono text-ink-3 mb-2">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3 text-sm font-mono pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          maxLength={maxLength}
          className={
            'w-full h-10 bg-raised/40 text-ink-1 placeholder:text-ink-3 ' +
            'border border-line rounded px-3 text-sm ' +
            'focus:outline-none focus:border-ember transition-colors ' +
            (prefix ? 'pl-7 ' : '')
          }
        />
      </div>
      {error && (
        <p className="mt-1 text-err text-xs font-mono" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
