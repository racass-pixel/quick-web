import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Route as RootRoute } from '../__root';
import { session } from '../../api/session';
import { ws } from '../../api/ws';
import { useAuth } from '../../stores/useAuth';
import { useChats } from '../../stores/useChats';
import { Sidebar } from '../../components/chats/Sidebar';
import { Kicker } from '../../components/primitives/Kicker';

function ChatsScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const loadConversations = useChats((s) => s.loadConversations);
  const setCurrentUserId = useChats((s) => s.setCurrentUserId);

  // Ensure the realtime socket is up and the user id is in the store.
  useEffect(() => {
    if (!user) return;
    setCurrentUserId(user.id);
    ws.connect();
    void loadConversations();
  }, [user, loadConversations, setCurrentUserId]);

  if (isLoading) return null;
  if (!user) {
    navigate({ to: '/auth' });
    return null;
  }

  return (
    <main className="h-screen flex overflow-hidden">
      <div className="h-screen flex flex-col">
        <Sidebar />
      </div>
      <section className="hidden md:flex flex-1 items-center justify-center px-12 min-w-0 min-h-0">
        <div className="max-w-sm text-center">
          <Kicker>chats · empty</Kicker>
          <h2 className="text-2xl tracking-tighter text-ink-1 mb-3">
            Pick a conversation
          </h2>
          <p className="text-ink-3 text-sm">
            Open one on the left, or start a new one with the + button.
          </p>
        </div>
      </section>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/chats',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: ChatsScreen,
});
