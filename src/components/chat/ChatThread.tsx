// Right pane of /chats screen. Shows the open conversation thread, composer,
// and a typing indicator. Auto-scrolls to bottom when a new message arrives
// or is sent, unless the user has deliberately scrolled up to read history.
//
// The header varies by conversation type:
//   - DM: peer avatar + name + @handle, call buttons + "..." menu (block).
//   - Group: title + "GROUP · N members" kicker, members modal trigger.
//   - Channel: title + "CHANNEL · N subscribers" kicker; composer hidden for
//     non-admins with a grey caption.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '@racass-pixel/quick-protocol';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { CallButton } from '../call/CallButton';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { TypingDot } from './TypingDot';
import { useChats } from '../../stores/useChats';
import { MembersModal } from '../chats/MembersModal';
import { DmHeaderMenu } from '../chats/DmHeaderMenu';

type Props = {
  convId: string;
};

const BOTTOM_THRESHOLD = 80; // px from bottom counts as "at bottom"

// Stable empty array so the selector returns the same reference between renders
// when there are no messages yet — otherwise every render builds a new `[]`,
// which makes effect deps see a "new" array each time and creates an infinite
// re-render loop (React #185).
const EMPTY_MESSAGES: Message[] = [];

export function ChatThread({ convId }: Props) {
  const conv = useChats((s) => s.byId[convId]);
  const messages = useChats((s) => s.messages[convId] ?? EMPTY_MESSAGES);
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

  const [showMembers, setShowMembers] = useState(false);

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Loading conversation…
      </div>
    );
  }

  const isDm = conv.type === 'dm' || !!conv.peer;
  const isGroup = conv.type === 'group';
  const isChannel = conv.type === 'channel';
  const peerName = isDm
    ? conv.peer?.displayName ?? conv.title ?? 'Conversation'
    : conv.title || 'Conversation';
  const peerHandle = conv.peer?.handle;
  const headerColor = (isDm ? conv.peer?.avatarColor : conv.avatarColor) ?? '';
  const canPostInChannel =
    isChannel && (conv.myRole === 'owner' || conv.myRole === 'admin');
  const composerHidden = isChannel && !canPostInChannel;

  async function handleSend(body: string) {
    setPinnedToBottom(true);
    await sendFn(convId, body);
  }

  const kickerText = isDm
    ? 'DM'
    : isGroup
      ? `group · ${conv.memberCount} ${conv.memberCount === 1 ? 'member' : 'members'}`
      : isChannel
        ? `channel · ${conv.memberCount} ${conv.memberCount === 1 ? 'subscriber' : 'subscribers'}`
        : '';

  const titleClickable = isGroup || isChannel;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b border-line px-6 py-4 flex items-center gap-4">
        <button
          type="button"
          onClick={titleClickable ? () => setShowMembers(true) : undefined}
          disabled={!titleClickable}
          className={`shrink-0 ${titleClickable ? 'cursor-pointer' : 'cursor-default'}`}
          aria-label={titleClickable ? 'View members' : undefined}
        >
          <Avatar displayName={peerName} color={headerColor} size={40} />
        </button>
        <button
          type="button"
          onClick={titleClickable ? () => setShowMembers(true) : undefined}
          disabled={!titleClickable}
          className={`flex-1 min-w-0 text-left ${
            titleClickable ? 'hover:[&_span]:text-ember' : ''
          }`}
        >
          <Kicker className="mb-1">{kickerText}</Kicker>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-ink-1 text-base truncate">{peerName}</span>
            {isDm && peerHandle && (
              <span className="text-ink-3 text-xs font-mono truncate">
                @{peerHandle}
              </span>
            )}
          </div>
        </button>
        {isDm && conv.peer && (
          <div className="flex items-center gap-2">
            <CallButton
              peer={{
                id: conv.peer.id,
                displayName: conv.peer.displayName || conv.peer.handle || 'Peer',
                handle: conv.peer.handle,
                avatarColor: conv.peer.avatarColor,
              }}
              video={false}
            />
            <CallButton
              peer={{
                id: conv.peer.id,
                displayName: conv.peer.displayName || conv.peer.handle || 'Peer',
                handle: conv.peer.handle,
                avatarColor: conv.peer.avatarColor,
              }}
              video={true}
            />
            <DmHeaderMenu peerUserId={conv.peer.id} peerHandle={conv.peer.handle} />
          </div>
        )}
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col gap-3"
      >
        {messages.length === 0 ? (
          <div className="m-auto text-ink-3 text-sm">
            {isDm
              ? `Say hi to @${peerHandle ?? peerName}.`
              : isChannel
                ? 'No posts yet.'
                : 'No messages yet.'}
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

      {composerHidden ? (
        <div className="px-6 py-6 border-t border-line text-ink-3 text-xs font-mono text-center">
          Only admins can post in this channel.
        </div>
      ) : (
        <Composer
          onSend={handleSend}
          onTyping={() => sendTyping(convId)}
          placeholder={
            isDm
              ? `Message @${peerHandle ?? peerName}`
              : isChannel
                ? 'Post to channel'
                : `Message ${peerName}`
          }
        />
      )}

      {showMembers && (
        <MembersModal
          conversationId={convId}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}
