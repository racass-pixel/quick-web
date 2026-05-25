// Left rail navigation shared by authenticated screens. Editorial style: mono
// kicker brand, a stack of nav links, and a low-key sign-out button anchored
// at the bottom.

import { Link, useNavigate } from '@tanstack/react-router';
import { Avatar } from './primitives/Avatar';
import { Kicker } from './primitives/Kicker';
import { useAuth } from '../stores/useAuth';

export function AppSidebar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <aside className="hidden md:flex w-64 shrink-0 border-r border-line flex-col p-6">
      <Kicker>quick</Kicker>
      <div className="flex items-center gap-3 mb-8">
        <Avatar displayName={user.displayName} color={user.avatarColor} />
        <div className="min-w-0">
          <div className="text-ink-1 text-sm truncate">{user.displayName}</div>
          <div className="text-ink-3 text-xs font-mono truncate">@{user.handle}</div>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-2 text-sm">
        <Link
          to="/chats"
          className="text-ink-2 hover:text-ember [&.active]:text-ember"
          activeProps={{ className: 'text-ember' }}
        >
          chats
        </Link>
        <Link
          to="/friends"
          className="text-ink-2 hover:text-ember [&.active]:text-ember"
          activeProps={{ className: 'text-ember' }}
        >
          friends
        </Link>
        <Link
          to="/friends/add"
          className="text-ink-2 hover:text-ember"
        >
          add friend
        </Link>
        <Link
          to="/settings"
          className="text-ink-2 hover:text-ember [&.active]:text-ember"
          activeProps={{ className: 'text-ember' }}
        >
          settings
        </Link>
      </nav>
      <button
        type="button"
        onClick={() => {
          signOut();
          navigate({ to: '/auth' });
        }}
        className="text-ink-3 hover:text-ember text-xs font-mono text-left"
      >
        sign out
      </button>
    </aside>
  );
}
