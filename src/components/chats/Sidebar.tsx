// Telegram-style left sidebar for /chats. Hosts the user-avatar settings
// trigger, a CHATS kicker, a "+" new-chat trigger, a search input, the
// conversation list, and a settings link at the bottom.
//
// State for the new-chat menu + modals lives here so the rest of the chats
// pane stays stateless.

import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
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
    <aside className="w-full md:w-[320px] md:shrink-0 bg-bg border-r border-line text-ink-1 flex flex-col min-h-0 h-full">
      {/* Top row: avatar (settings popover) + CHATS kicker + "+" trigger */}
      <div className="relative px-4 pt-4 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div ref={profileRef} className="relative">
            <button
              type="button"
              aria-label="Account menu"
              onClick={() => setProfileOpen((v) => !v)}
              className="block rounded-full focus:outline-none focus:ring-1 focus:ring-ember"
            >
              {user ? (
                <Avatar displayName={user.displayName} color={user.avatarColor} size={36} />
              ) : (
                <div className="w-9 h-9 rounded-full bg-raised" />
              )}
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
                  className="absolute z-20 left-0 top-12 w-56 bg-bg border border-line shadow-lg py-1 text-sm"
                >
                  {user && (
                    <div className="px-3 py-2 border-b border-line">
                      <div className="text-ink-1 truncate">{user.displayName}</div>
                      <div className="text-ink-3 text-xs font-mono truncate">
                        @{user.handle}
                      </div>
                    </div>
                  )}
                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block px-3 py-2 text-ink-2 hover:text-ember hover:bg-raised"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={doSignOut}
                    className="block w-full text-left px-3 py-2 text-ink-2 hover:text-ember hover:bg-raised"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
          <Kicker className="mb-0 flex-1">chats</Kicker>
          <div className="relative">
            <button
              ref={menuAnchorRef}
              type="button"
              aria-label="New chat"
              onClick={() => setMenuOpen((v) => !v)}
              className="text-ink-2 hover:text-ember text-base font-mono w-8 h-8 flex items-center justify-center border border-line hover:border-ember transition-colors"
            >
              +
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

        <div className="mt-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent py-1.5 px-3 focus:outline-none focus:border-ember transition-colors text-sm"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-ink-3 text-sm">
            {query ? 'No matches.' : 'No conversations yet. Tap + to start one.'}
          </div>
        ) : (
          <ul className="divide-y divide-line">
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

      {/* Bottom: settings link */}
      <div className="border-t border-line px-4 py-3">
        <Link
          to="/settings"
          className="text-ink-3 hover:text-ember text-xs font-mono"
        >
          settings
        </Link>
      </div>

      {/* New-chat modals */}
      {modal === 'dm' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === 'channel' && <NewChannelModal onClose={() => setModal(null)} />}
    </aside>
  );
}
