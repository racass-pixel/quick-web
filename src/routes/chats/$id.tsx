import { createRoute, redirect, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Route as RootRoute } from '../__root';
import { session } from '../../api/session';
import { ws } from '../../api/ws';
import { useAuth } from '../../stores/useAuth';
import { useChats } from '../../stores/useChats';
import { Sidebar } from '../../components/chats/Sidebar';
import { ChatThread } from '../../components/chat/ChatThread';

function ChatThreadScreen() {
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { user, isLoading } = useAuth();
  const loadConversations = useChats((s) => s.loadConversations);
  const setCurrentUserId = useChats((s) => s.setCurrentUserId);

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
      <div className="hidden md:flex h-screen flex-col">
        <Sidebar />
      </div>
      <section className="flex-1 flex min-w-0 min-h-0">
        <ChatThread convId={id} />
      </section>
    </main>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/chats/$id',
  beforeLoad: () => {
    if (!session.token) throw redirect({ to: '/auth' });
  },
  component: ChatThreadScreen,
});
