// Right pane of /chats screen. Shows the open conversation thread, composer,
// and a typing indicator. Auto-scrolls to bottom when a new message arrives
// or is sent, unless the user has deliberately scrolled up to read history.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { TypingDot } from './TypingDot';
import { useChats } from '../../stores/useChats';

type Props = {
  convId: string;
};

const BOTTOM_THRESHOLD = 80; // px from bottom counts as "at bottom"

export function ChatThread({ convId }: Props) {
  const conv = useChats((s) => s.byId[convId]);
  const messages = useChats((s) => s.messages[convId] ?? []);
  const typing = useChats((s) => s.typing[convId]);
  const currentUserId = useChats((s) => s.currentUserId);
  const loadMessages = useChats((s) => s.loadMessages);
  const setActiveConv = useChats((s) => s.setActiveConv);
  const sendFn = useChats((s) => s.send);
  const markReadFn = useChats((s) => s.markRead);
  const sendTyping = useChats((s) => s.sendTyping);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);
  const lastReadFiredRef = useRef<string | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Load messages + mark this conv active on mount / id change.
  useEffect(() => {
    setActiveConv(convId);
    void loadMessages(convId);
    return () => {
      setActiveConv(null);
    };
  }, [convId, loadMessages, setActiveConv]);

  // Track whether user is at the bottom by observing scroll position.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinnedToBottom(distance < BOTTOM_THRESHOLD);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // After every messages change, scroll to bottom if pinned. Also fire markRead
  // for the latest message we haven't yet ack'd to the server.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (pinnedToBottom) {
      el.scrollTop = el.scrollHeight;
    }
    const last = messages[messages.length - 1];
    if (last && last.id !== lastSeenIdRef.current) {
      lastSeenIdRef.current = last.id;
    }
    if (
      last &&
      currentUserId &&
      last.id !== lastReadFiredRef.current &&
      // Only mark read when the latest message isn't ours and we're at bottom.
      last.senderId !== currentUserId &&
      pinnedToBottom
    ) {
      lastReadFiredRef.current = last.id;
      void markReadFn(convId, last.id);
    }
  }, [messages, pinnedToBottom, convId, currentUserId, markReadFn]);

  // The peer is typing if there exists any user-id in the typing set other
  // than ourselves within the last 3s (the store expires entries on a timer).
  const peerTyping =
    !!typing &&
    Array.from(typing).some((uid) => uid !== currentUserId);

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Loading conversation…
      </div>
    );
  }

  const peerName = conv.peer?.displayName ?? conv.title ?? 'Conversation';
  const peerHandle = conv.peer?.handle;

  async function handleSend(body: string) {
    setPinnedToBottom(true);
    await sendFn(convId, body);
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b border-line px-6 py-4 flex items-center gap-4">
        <Avatar
          displayName={peerName}
          color={conv.peer?.avatarColor ?? ''}
          size={40}
        />
        <div className="flex-1 min-w-0">
          <Kicker className="mb-1">DM</Kicker>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-ink-1 text-base truncate">{peerName}</span>
            {peerHandle && (
              <span className="text-ink-3 text-xs font-mono truncate">
                @{peerHandle}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Coming in S5"
          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-transparent text-ink-2 border border-line"
        >
          Call
        </button>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col gap-3"
      >
        {messages.length === 0 ? (
          <div className="m-auto text-ink-3 text-sm">
            Say hi to @{peerHandle ?? peerName}.
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={!!currentUserId && m.senderId === currentUserId}
            />
          ))
        )}
      </div>

      <div className="px-6 h-6 flex items-center">
        {peerTyping && <TypingDot label={`@${peerHandle ?? 'peer'} is typing`} />}
      </div>

      <Composer
        onSend={handleSend}
        onTyping={() => sendTyping(convId)}
        placeholder={`Message @${peerHandle ?? peerName}`}
      />
    </div>
  );
}
