// Telegram-style profile card. Opens whenever any avatar in the app is
// clicked (sidebar row, thread header, group attribution, members modal,
// etc). Layout follows TG K mobile profile:
//   - Big circular avatar centered top.
//   - Display name + presence status under it.
//   - 4-up action grid: Message / Mute / Call / More.
//   - Bio card (placeholder until users.bio lands) + handle row with copy.
//   - Full-width Block user at the bottom (hidden on self).
//
// Modal API stays the same as before: `useProfile.getState().open(user)`.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Bell,
  Copy,
  MessageSquare,
  MoreHorizontal,
  Phone,
  X,
} from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useProfile } from '../../stores/useProfile';
import { useAuth } from '../../stores/useAuth';
import { useCall } from '../../stores/useCall';
import { usePresence, formatPresence } from '../../stores/usePresence';
import { messagingClient } from '../../api/messaging';
import { usersClient } from '../../api/users';

export function ProfileModal() {
  const user = useProfile((s) => s.user);
  const close = useProfile((s) => s.close);
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [busy, setBusy] = useState<'dm' | 'block' | 'call' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Presence is fetched for any non-self peer. Hook MUST be called on every
  // render path (Rules of Hooks) — pass undefined when there's no peer.
  const isSelf = !!me && !!user && me.id === user.id;
  const presence = usePresence(!user || isSelf ? undefined : user.id);

  useEffect(() => {
    if (!user) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, close]);

  // Reset transient state whenever the modal opens/closes (or switches user).
  useEffect(() => {
    setBusy(null);
    setError(null);
    setMenuOpen(false);
    setCopied(false);
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, [user?.id]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  if (!user) return null;

  const handle = user.handle;
  // Title resolution: prefer a real display_name. Fall back to @handle so we
  // never render the raw user-id-looking string when display_name is empty
  // or accidentally equals the handle (legacy rows). Avatar still uses the
  // best name available for initials.
  const hasDistinctDisplayName =
    !!user.displayName &&
    user.displayName.trim().length > 0 &&
    user.displayName !== handle;
  const titleText = hasDistinctDisplayName
    ? user.displayName
    : handle
      ? `@${handle}`
      : 'Unknown';
  const avatarName = user.displayName || handle || 'Unknown';

  const bio = ((user as { bio?: string }).bio ?? '').trim();

  const statusText = isSelf ? '' : formatPresence(presence);
  const statusOnline = !!presence?.online && !isSelf;

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

  async function startCall() {
    if (!user || busy) return;
    setBusy('call');
    setError(null);
    try {
      await useCall.getState().start(
        {
          id: user.id,
          displayName: user.displayName,
          handle: user.handle,
          avatarColor: user.avatarColor,
        },
        false /* video */,
      );
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start call.');
    } finally {
      setBusy(null);
    }
  }

  async function block() {
    if (!user || busy) return;
    const label = handle ? `@${handle}` : titleText;
    setMenuOpen(false);
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

  function copyHandle() {
    if (!handle) return;
    const text = `@${handle}`;
    try {
      void navigator.clipboard.writeText(text);
    } catch {
      /* ignored — clipboard may be blocked in non-secure contexts */
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
    setMenuOpen(false);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4">
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
        className="relative bg-panel border border-line rounded-2xl w-[360px] max-w-[90vw] overflow-hidden text-ink-1 shadow-2xl ring-1 ring-ember/10"
      >
        {/* Top-right close */}
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-1 hover:bg-raised transition-colors"
        >
          <X size={18} strokeWidth={2} />
        </button>

        {/* Avatar + identity */}
        <div className="pt-8 pb-4 px-6 flex flex-col items-center text-center gap-3">
          <Avatar
            displayName={avatarName}
            color={user.avatarColor}
            size={104}
          />
          <div className="space-y-1 w-full">
            <div className="text-2xl font-semibold text-ink-1 leading-tight text-center break-words line-clamp-2 px-2">
              {titleText}
            </div>
            {isSelf ? (
              <div className="kicker text-ink-3">This is you</div>
            ) : (
              <div className="text-sm text-ink-3 flex items-center justify-center gap-1.5">
                {statusOnline && (
                  <span
                    className="rounded-full bg-ember inline-block"
                    style={{ height: 6, width: 6 }}
                  />
                )}
                <span className={statusOnline ? 'text-ember' : 'text-ink-3'}>
                  {statusText}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action grid */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-4 gap-1 bg-raised/40 border border-line rounded-xl p-1">
            <ActionButton
              icon={<MessageSquare size={20} strokeWidth={2} />}
              label={busy === 'dm' ? '…' : 'Message'}
              onClick={sendMessage}
              disabled={isSelf || busy !== null}
              hidden={isSelf}
              active
            />
            <ActionButton
              icon={<Bell size={20} strokeWidth={2} />}
              label="Mute"
              disabled
              title="Notifications coming soon"
            />
            <ActionButton
              icon={<Phone size={20} strokeWidth={2} />}
              label={busy === 'call' ? '…' : 'Call'}
              onClick={startCall}
              disabled={isSelf || busy !== null}
              hidden={isSelf}
              active
            />
            <div className="relative">
              <ActionButton
                icon={<MoreHorizontal size={20} strokeWidth={2} />}
                label="More"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={busy !== null}
                ariaExpanded={menuOpen}
                active
              />
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-panel border border-line rounded-lg shadow-xl py-1 text-sm"
                >
                  {handle && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={copyHandle}
                      className="block w-full text-left px-3 py-2 text-ink-1 hover:bg-raised transition-colors"
                    >
                      Copy handle
                    </button>
                  )}
                  {!isSelf && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={block}
                      disabled={busy !== null}
                      className="block w-full text-left px-3 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      Block user
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bio + username card */}
        <div className="px-4 pb-4">
          <div className="border border-line rounded-lg divide-y divide-line">
            <div className="p-4 space-y-1">
              <div className="kicker text-ink-3">Bio</div>
              {bio ? (
                <div className="text-sm text-ink-1 whitespace-pre-wrap break-words">
                  {bio}
                </div>
              ) : (
                <div className="text-sm italic text-ink-3">No bio yet</div>
              )}
            </div>
            {handle && (
              <div className="p-4 flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="text-sm font-mono text-ember break-all">
                    @{handle}
                  </div>
                  <div className="kicker text-ink-3">Username</div>
                  {copied && (
                    <div
                      className="text-xs font-mono text-ember"
                      aria-live="polite"
                    >
                      Copied
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={copyHandle}
                  aria-label="Copy handle"
                  className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-ink-3 hover:text-ember hover:bg-raised transition-colors"
                >
                  <Copy size={16} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p
            className="px-6 pb-3 text-err text-xs font-mono text-center"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Block user — bottom red action, hidden on self */}
        {!isSelf && (
          <button
            type="button"
            onClick={block}
            disabled={busy !== null}
            className="w-full text-rose-400 hover:text-rose-300 border-t border-line py-3 text-sm font-medium hover:bg-rose-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:bg-rose-500/10"
          >
            {busy === 'block' ? 'Blocking…' : 'Block user'}
          </button>
        )}
      </div>
    </div>
  );
}

// Single column in the 4-up action grid: icon stacked over label.
function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  hidden,
  title,
  ariaExpanded,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  title?: string;
  ariaExpanded?: boolean;
  // active = enabled-and-interactive (ember icon). Inactive (disabled w/o
  // hidden) renders the icon greyed for the "Mute coming soon" slot.
  active?: boolean;
}) {
  // Hidden actions still occupy a column so the grid stays balanced when one
  // of them is removed for self-profile (Message/Call).
  if (hidden) {
    return <div aria-hidden className="h-[60px]" />;
  }
  const iconTone = active ? 'text-ember' : 'text-ink-3 opacity-60';
  const labelTone = active ? 'text-ink-2' : 'text-ink-3 opacity-60';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-expanded={ariaExpanded}
      className="h-[60px] w-full rounded-lg flex flex-col items-center justify-center gap-1 text-ink-1 transition-colors duration-150 hover:bg-raised/60 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-ember"
    >
      <span className={iconTone}>{icon}</span>
      <span className={`text-[11px] font-medium ${labelTone}`}>{label}</span>
    </button>
  );
}
