// Telegram K-style hamburger drawer that slides in over the sidebar.
//
// Shows the signed-in user at the top, then a stack of menu actions:
// My Profile, New Group, New Channel, Settings, and Logout at the bottom.
// The drawer owns its dismiss surface (backdrop + ESC) and delegates
// destination work to the parent so each entry can hook into existing
// modal/route flows.

import { useEffect } from 'react';
import {
  LogOut,
  Megaphone,
  Settings as SettingsIcon,
  UserCircle,
  Users,
} from 'lucide-react';
import type { User } from '@racass-pixel/quick-protocol';
import { Avatar } from '../primitives/Avatar';

type Props = {
  open: boolean;
  user: User;
  onClose: () => void;
  onProfile: () => void;
  onNewGroup: () => void;
  onNewChannel: () => void;
  onSettings: () => void;
  onLogout: () => void;
};

export function SidebarMenu({
  open,
  user,
  onClose,
  onProfile,
  onNewGroup,
  onNewChannel,
  onSettings,
  onLogout,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only mounted while open so it doesn't swallow clicks. */}
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 z-30 bg-black/40 cursor-default"
        />
      )}
      {/* Drawer panel. Always mounted so the slide transition can play in
          both directions; visibility is driven by translate-x. */}
      <aside
        aria-label="Main menu"
        aria-hidden={!open}
        className={
          'absolute inset-y-0 left-0 w-[280px] bg-panel border-r border-line ' +
          'z-40 flex flex-col transition-transform duration-200 ease-out ' +
          (open ? 'translate-x-0' : '-translate-x-full pointer-events-none')
        }
      >
        {/* Identity header — large avatar, name, handle. */}
        <div className="p-5 border-b border-line">
          <Avatar
            displayName={user.displayName}
            color={user.avatarColor}
            size={56}
          />
          <div className="mt-3 min-w-0">
            <div className="text-ink-1 text-base font-medium truncate">
              {user.displayName || `@${user.handle}`}
            </div>
            <div className="text-ink-3 text-sm font-mono truncate">
              @{user.handle}
            </div>
          </div>
        </div>

        {/* Primary actions */}
        <nav className="flex-1 py-2 flex flex-col">
          <MenuItem icon={<UserCircle size={20} />} label="My Profile" onClick={onProfile} />
          <MenuItem icon={<Users size={20} />} label="New Group" onClick={onNewGroup} />
          <MenuItem icon={<Megaphone size={20} />} label="New Channel" onClick={onNewChannel} />
          <MenuItem icon={<SettingsIcon size={20} />} label="Settings" onClick={onSettings} />
        </nav>

        {/* Logout pinned at the bottom, ember/err for emphasis. */}
        <div className="border-t border-line py-2">
          <MenuItem
            icon={<LogOut size={20} />}
            label="Logout"
            danger
            onClick={onLogout}
          />
        </div>
      </aside>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'w-full h-11 px-5 flex items-center gap-4 text-sm text-left ' +
        'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
        (danger
          ? 'text-err hover:bg-raised/40'
          : 'text-ink-1 hover:bg-raised/40')
      }
    >
      <span className={danger ? 'text-err' : 'text-ink-3'}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
