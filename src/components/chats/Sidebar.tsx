// Telegram-style left sidebar for /chats. 360px wide on desktop with a 56px
// top bar (hamburger + search + pencil) and a 72px-row conversation list.
//
// The user-avatar settings popover anchors off the hamburger button at the
// left of the top bar; the pencil at the right opens the NewChatMenu.

import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { Menu, Pencil, Search } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useAuth } from '../../stores/useAuth';
import { useChats } from '../../stores/useChats';
import { ConversationRow } from './ConversationRow';
import { NewChatMenu } from './NewChatMenu';
import { NewChatModal } from './NewChatModal';
import { NewGroupModal } from './NewGroupModal';
import { NewChannelModal } from './NewChannelModal';

type ModalKind = 'dm' | 'group' | 'channel' | null;

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const order = useChats((s) => s.conversationsOrder);
  const byId = useChats((s) => s.byId);
  const params = useParams({ strict: false }) as { id?: string };
  const activeId = params.id;

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return order;
    return order.filter((id) => {
      const c = byId[id];
      if (!c) return false;
      const name = (c.peer?.displayName || c.title || '').toLowerCase();
      const handle = (c.peer?.handle || '').toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }, [order, byId, query]);

  function doSignOut() {
    setProfileOpen(false);
    signOut();
    navigate({ to: '/auth' });
  }

  return (
    <aside className="w-full md:w-[360px] md:shrink-0 bg-bg border-r border-line text-ink-1 flex flex-col min-h-0 h-full">
      {/* Top bar — 56px: hamburger (anchors account popover), search, pencil. */}
      <div className="relative h-14 px-3 flex items-center gap-2 border-b border-line">
        <div ref={profileRef} className="relative">
          <button
            type="button"
            aria-label="Account menu"
            onClick={() => setProfileOpen((v) => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ink-1 hover:bg-raised transition-colors focus:outline-none focus:ring-1 focus:ring-ember"
          >
            <Menu size={22} strokeWidth={2} />
          </button>
          {profileOpen && (
            <>
              <button
                type="button"
                aria-hidden
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setProfileOpen(false)}
              />
              <div
                role="menu"
                className="absolute z-20 left-0 top-12 w-60 bg-panel border border-line shadow-lg rounded-md py-1.5 text-sm"
              >
                {user && (
                  <div className="px-3 py-2.5 border-b border-line flex items-center gap-3">
                    <Avatar displayName={user.displayName} color={user.avatarColor} size={36} />
                    <div className="min-w-0">
                      <div className="text-ink-1 truncate">{user.displayName}</div>
                      <div className="text-ink-3 text-xs font-mono truncate">
                        @{user.handle}
                      </div>
                    </div>
                  </div>
                )}
                <Link
                  to="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="block px-3 py-2 text-ink-2 hover:text-ink-1 hover:bg-raised"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={doSignOut}
                  className="block w-full text-left px-3 py-2 text-ink-2 hover:text-err hover:bg-raised"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex-1 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
            strokeWidth={2}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full h-9 bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent rounded-full pl-9 pr-3 focus:outline-none focus:border-ember transition-colors text-sm"
          />
        </div>

        <div className="relative">
          <button
            ref={menuAnchorRef}
            type="button"
            aria-label="New chat"
            onClick={() => setMenuOpen((v) => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors"
          >
            <Pencil size={18} strokeWidth={2} />
          </button>
          {menuOpen && (
            <NewChatMenu
              onClose={() => setMenuOpen(false)}
              onPick={(kind) => {
                setMenuOpen(false);
                setModal(kind);
              }}
            />
          )}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-ink-3 text-sm">
            {query ? 'No matches.' : 'No conversations yet. Tap the pencil to start one.'}
          </div>
        ) : (
          <ul>
            {filtered.map((id) => {
              const conv = byId[id];
              if (!conv) return null;
              return (
                <li key={id}>
                  <ConversationRow conv={conv} active={activeId === id} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* New-chat modals */}
      {modal === 'dm' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === 'channel' && <NewChannelModal onClose={() => setModal(null)} />}
    </aside>
  );
}
