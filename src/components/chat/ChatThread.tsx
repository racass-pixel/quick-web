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
import { Search } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { CallButton } from '../call/CallButton';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { TypingDot } from './TypingDot';
import { useChats } from '../../stores/useChats';
import { usePresence, formatPresence } from '../../stores/usePresence';
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
  const lastReadAtByPeer = useChats((s) => s.lastReadAtByPeer[convId] ?? 0);
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

  // usePresence must run on every render path (Rules of Hooks); pass undefined
  // when there's no peer (initial loading or non-DM) and the hook no-ops.
  const peerIdForPresence = conv?.peer?.id;
  const presence = usePresence(peerIdForPresence);

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

  const titleClickable = isGroup || isChannel;

  // Status line under the peer name.
  //   DM:      online / typing… / last seen Xm ago / last seen recently
  //   Group:   N members
  //   Channel: N subscribers
  let statusText = '';
  let statusOnline = false;
  if (isDm) {
    if (peerTyping) {
      statusText = 'typing…';
    } else if (presence?.online) {
      statusText = 'online';
      statusOnline = true;
    } else {
      statusText = formatPresence(presence);
    }
  } else if (isGroup) {
    statusText = `${conv.memberCount} ${conv.memberCount === 1 ? 'member' : 'members'}`;
  } else if (isChannel) {
    statusText = `${conv.memberCount} ${conv.memberCount === 1 ? 'subscriber' : 'subscribers'}`;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="h-14 border-b border-line px-4 flex items-center gap-3">
        <button
          type="button"
          onClick={titleClickable ? () => setShowMembers(true) : undefined}
          disabled={!titleClickable}
          className={`shrink-0 ${titleClickable ? 'cursor-pointer' : 'cursor-default'}`}
          aria-label={titleClickable ? 'View members' : undefined}
        >
          <Avatar displayName={peerName} color={headerColor} size={42} />
        </button>
        <button
          type="button"
          onClick={titleClickable ? () => setShowMembers(true) : undefined}
          disabled={!titleClickable}
          className={`flex-1 min-w-0 text-left ${
            titleClickable ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          <div className="text-ink-1 text-[16px] font-medium truncate">{peerName}</div>
          <div
            className={`text-[13px] truncate ${
              statusOnline ? 'text-ember' : 'text-ink-3'
            }`}
          >
            {statusText}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label="Search"
            title="Search (coming soon)"
            disabled
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:bg-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search size={20} strokeWidth={2} />
          </button>
          {isDm && conv.peer && (
            <>
              <CallButton
                peer={{
                  id: conv.peer.id,
                  displayName: conv.peer.displayName || conv.peer.handle || 'Peer',
                  handle: conv.peer.handle,
                  avatarColor: conv.peer.avatarColor,
                }}
                video={false}
                iconOnly
              />
              <CallButton
                peer={{
                  id: conv.peer.id,
                  displayName: conv.peer.displayName || conv.peer.handle || 'Peer',
                  handle: conv.peer.handle,
                  avatarColor: conv.peer.avatarColor,
                }}
                video={true}
                iconOnly
              />
              <DmHeaderMenu peerUserId={conv.peer.id} peerHandle={conv.peer.handle} />
            </>
          )}
        </div>
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
          messages.map((m) => {
            const isOwn = !!currentUserId && m.senderId === currentUserId;
            const createdMs = m.createdAt
              ? Number(m.createdAt.seconds) * 1000 +
                Math.floor(m.createdAt.nanos / 1_000_000)
              : 0;
            const isReadByPeer =
              isOwn && lastReadAtByPeer > 0 && createdMs <= lastReadAtByPeer;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={isOwn}
                isReadByPeer={isReadByPeer}
              />
            );
          })
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
