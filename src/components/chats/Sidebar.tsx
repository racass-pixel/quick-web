// Telegram-style left sidebar for /chats. 360px wide on desktop with a 56px
// top bar (hamburger + search + pencil) and a 72px-row conversation list.
//
// The hamburger opens a full-height drawer (SidebarMenu) that slides in over
// the sidebar; the pencil at the right opens the NewChatMenu popover.

import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@racass-pixel/quick-protocol';
import { Menu, Pencil, Search } from 'lucide-react';
import { useAuth } from '../../stores/useAuth';
import { useChats } from '../../stores/useChats';
import { useProfile } from '../../stores/useProfile';
import { useUi } from '../../stores/useUi';
import { ConversationRow } from './ConversationRow';
import { NewChatMenu } from './NewChatMenu';
import { NewChatModal } from './NewChatModal';
import { NewGroupModal } from './NewGroupModal';
import { NewChannelModal } from './NewChannelModal';
import { SidebarMenu } from './SidebarMenu';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SearchResults } from '../chat/SearchResults';
import { messagingClient } from '../../api/messaging';

type ModalKind = 'dm' | 'group' | 'channel' | null;

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const order = useChats((s) => s.conversationsOrder);
  const byId = useChats((s) => s.byId);
  const params = useParams({ strict: false }) as { id?: string };
  const activeId = params.id;
  const openProfile = useProfile((s) => s.open);
  const sidebarMenuOpen = useUi((s) => s.sidebarMenuOpen);
  const settingsPanelOpen = useUi((s) => s.settingsPanelOpen);
  const openSidebarMenu = useUi((s) => s.openSidebarMenu);
  const closeSidebarMenu = useUi((s) => s.closeSidebarMenu);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);

  // Global message-search state. We debounce queries >= 2 chars and call
  // SearchMessages without a conversation_id (so it spans the whole user).
  const [msgHits, setMsgHits] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const reqIdRef = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMsgHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      const id = ++reqIdRef.current;
      try {
        const res = await messagingClient.searchMessages({
          query: q,
          conversationId: '',
          limit: 30,
          beforeId: '',
        });
        if (id !== reqIdRef.current) return;
        setMsgHits(res.messages ?? []);
      } catch {
        if (id !== reqIdRef.current) return;
        setMsgHits([]);
      } finally {
        if (id === reqIdRef.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query]);

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
    if (!window.confirm('Logout?')) return;
    closeSidebarMenu();
    closeSettings();
    signOut();
    navigate({ to: '/auth' });
  }

  return (
    <aside className="relative w-full md:w-[360px] md:shrink-0 bg-bg border-r border-line text-ink-1 flex flex-col min-h-0 h-full overflow-hidden">
      {/* Top bar — 56px: hamburger, search, pencil. */}
      <div className="relative h-14 px-3 flex items-center gap-2 border-b border-line">
        <button
          type="button"
          aria-label="Main menu"
          onClick={openSidebarMenu}
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors focus:outline-none focus:ring-1 focus:ring-ember"
        >
          <Menu size={24} strokeWidth={2} />
        </button>

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

      {/* Conversation list — replaced by global search results when the
          query has 2+ chars. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {query.trim().length >= 2 ? (
          <>
            <div className="px-4 pt-3 pb-1 text-[11px] font-mono uppercase tracking-wider text-ink-3">
              Chats
            </div>
            {filtered.length === 0 ? (
              <div className="px-4 py-2 text-ink-3 text-sm">No matching chats.</div>
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
            <div className="px-4 pt-3 pb-1 text-[11px] font-mono uppercase tracking-wider text-ink-3">
              Messages
            </div>
            <SearchResults
              query={query.trim()}
              hits={msgHits}
              loading={searching}
              onHitClick={() => setQuery('')}
            />
          </>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-ink-3 text-sm">
            No conversations yet. Tap the pencil to start one.
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

      {/* Slide-in hamburger drawer */}
      {user && (
        <SidebarMenu
          open={sidebarMenuOpen}
          user={user}
          onClose={closeSidebarMenu}
          onProfile={() => {
            closeSidebarMenu();
            openProfile(user);
          }}
          onNewGroup={() => {
            closeSidebarMenu();
            setModal('group');
          }}
          onNewChannel={() => {
            closeSidebarMenu();
            setModal('channel');
          }}
          onSettings={openSettings}
          onLogout={doSignOut}
        />
      )}

      {/* Slide-in settings panel — sits above the drawer when open */}
      {user && (
        <SettingsPanel
          open={settingsPanelOpen}
          user={user}
          onClose={closeSettings}
          onLogout={doSignOut}
        />
      )}
    </aside>
  );
}
