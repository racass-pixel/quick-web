// Right pane of /chats screen. Shows the open conversation thread, composer,
// and a floating scroll-to-bottom button. TG-style history behaviour:
//
//   - On open, if the conv has unread messages, we load enough history to
//     cover them and scroll the unread anchor to the top of the viewport,
//     rendering a sticky-style divider above it. Otherwise we tail the
//     newest page like a normal chat.
//   - Scroll near the TOP triggers a "load older" pagination (preserves
//     position by adjusting scrollTop after insert).
//   - Scroll back toward the BOTTOM while not pinned triggers a "load newer"
//     pagination so messages received while we were elsewhere reach us.
//   - A floating ember chevron button jumps to the bottom + marks read.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '@racass-pixel/quick-protocol';
import { Search } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { CallButton } from '../call/CallButton';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { UnreadDivider } from './UnreadDivider';
import { useChats } from '../../stores/useChats';
import { useProfile } from '../../stores/useProfile';
import { usePresence, formatPresence } from '../../stores/usePresence';
import { MembersModal } from '../chats/MembersModal';
import { DmHeaderMenu } from '../chats/DmHeaderMenu';
import { DaySeparator, dayLabel, sameDay } from './DaySeparator';

type Props = {
  convId: string;
};

const BOTTOM_THRESHOLD = 80; // px from bottom counts as "at bottom"
const EDGE_TRIGGER = 200; // px from top/bottom to fire pagination

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
  const senderUserByMsgId = useChats((s) => s.senderUserByMsgId);
  const hasMore = useChats((s) => s.hasMore[convId] ?? false);
  const unreadAnchorId = useChats((s) => s.unreadAnchorByConv[convId]);
  const loadAroundUnread = useChats((s) => s.loadAroundUnread);
  const loadMessages = useChats((s) => s.loadMessages);
  const setActiveConv = useChats((s) => s.setActiveConv);
  const sendFn = useChats((s) => s.send);
  const markReadFn = useChats((s) => s.markRead);
  const sendTyping = useChats((s) => s.sendTyping);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastReadFiredRef = useRef<string | null>(null);
  const initialAnchoredRef = useRef<string | null>(null);
  // Captured before a prepend so we can preserve scrollTop after the new
  // messages are inserted at the top.
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const unreadCount = conv?.unreadCount ?? 0;

  // Load messages + mark this conv active on mount / id change.
  useEffect(() => {
    setActiveConv(convId);
    initialAnchoredRef.current = null;
    void loadAroundUnread(convId);
    return () => {
      setActiveConv(null);
    };
  }, [convId, loadAroundUnread, setActiveConv]);

  // Track scroll position: pinnedToBottom + edge-triggered pagination.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinnedToBottom(distance < BOTTOM_THRESHOLD);

      // Top trigger — load older.
      const topDistance = el.scrollTop;
      if (
        topDistance < EDGE_TRIGGER &&
        !loadingOlderRef.current &&
        useChats.getState().hasMore[convId]
      ) {
        const msgs = useChats.getState().messages[convId] ?? [];
        const first = msgs[0];
        if (first) {
          loadingOlderRef.current = true;
          // Snapshot scroll metrics so we can restore position after insert.
          prependAnchorRef.current = {
            scrollHeight: el.scrollHeight,
            scrollTop: el.scrollTop,
          };
          void loadMessages(convId, { before: first.id }).finally(() => {
            loadingOlderRef.current = false;
          });
        }
      }

      // Bottom trigger — load newer (catch-up on missed messages).
      if (
        distance < EDGE_TRIGGER &&
        distance >= BOTTOM_THRESHOLD &&
        !loadingNewerRef.current
      ) {
        const msgs = useChats.getState().messages[convId] ?? [];
        const last = msgs[msgs.length - 1];
        if (last) {
          loadingNewerRef.current = true;
          void loadMessages(convId, { after: last.id }).finally(() => {
            loadingNewerRef.current = false;
          });
        }
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [convId, loadMessages]);

  // After every messages change: handle initial unread-anchor scroll first
  // (one-shot per mount), then prepend scroll preservation, then the normal
  // "pinned → tail" auto-scroll.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    // 1. One-shot initial scroll to the unread anchor.
    if (
      messages.length > 0 &&
      initialAnchoredRef.current !== convId
    ) {
      initialAnchoredRef.current = convId;
      if (unreadAnchorId) {
        const target = el.querySelector<HTMLElement>(
          `[data-msg-id="${CSS.escape(unreadAnchorId)}"]`,
        );
        if (target) {
          // Position the divider/anchor near the top with a small padding.
          const offset = target.offsetTop - 50;
          el.scrollTop = Math.max(0, offset);
          setPinnedToBottom(false);
          return;
        }
      }
      // No anchor → tail the newest message.
      el.scrollTop = el.scrollHeight;
      setPinnedToBottom(true);
      return;
    }

    // 2. Prepend scroll preservation — keep the user looking at the same
    //    message after older history is inserted at the top.
    if (prependAnchorRef.current) {
      const { scrollHeight: oldHeight, scrollTop: oldTop } =
        prependAnchorRef.current;
      prependAnchorRef.current = null;
      el.scrollTop = el.scrollHeight - oldHeight + oldTop;
      return;
    }

    // 3. Normal tail-when-pinned behaviour for new bottom messages.
    if (pinnedToBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pinnedToBottom, convId, unreadAnchorId]);

  // MarkRead — when the user is at the bottom and the latest message is from
  // someone else, ack it to the server. Debounced via the firedRef.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || !currentUserId) return;
    if (!pinnedToBottom) return;
    if (last.senderId === currentUserId) return;
    if (last.id === lastReadFiredRef.current) return;
    const handle = window.setTimeout(() => {
      lastReadFiredRef.current = last.id;
      void markReadFn(convId, last.id);
    }, 500);
    return () => window.clearTimeout(handle);
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

  function jumpToBottom() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setPinnedToBottom(true);
    const last = messages[messages.length - 1];
    if (last && currentUserId && last.senderId !== currentUserId) {
      lastReadFiredRef.current = last.id;
      void markReadFn(convId, last.id);
    }
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

  // Pre-compute the unread divider count once per render.
  // Anchor still maps to a real message — the divider stays until reopen
  // even as the user scrolls past it.
  const dividerCount = unreadAnchorId
    ? Math.max(1, messages.length - messages.findIndex((m) => m.id === unreadAnchorId))
    : 0;

  const showJumpButton = !pinnedToBottom || unreadCount > 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
      <header className="shrink-0 h-14 border-b border-line px-4 flex items-center gap-3">
        <button
          type="button"
          onClick={
            isDm && conv.peer
              ? () => useProfile.getState().open(conv.peer!)
              : titleClickable
                ? () => setShowMembers(true)
                : undefined
          }
          disabled={!isDm && !titleClickable}
          className={`shrink-0 ${isDm || titleClickable ? 'cursor-pointer' : 'cursor-default'} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ember`}
          aria-label={isDm ? `Open profile for ${peerName}` : titleClickable ? 'View members' : undefined}
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
        {hasMore && (
          <div className="text-center text-ink-3 text-[11px] font-mono py-1 select-none">
            loading older…
          </div>
        )}
        {messages.length === 0 ? (
          <div className="m-auto text-ink-3 text-sm">
            {isDm
              ? `Say hi to @${peerHandle ?? peerName}.`
              : isChannel
                ? 'No posts yet.'
                : 'No messages yet.'}
          </div>
        ) : (
          messages.map((m, i) => {
            const isOwn = !!currentUserId && m.senderId === currentUserId;
            const createdMs = m.createdAt
              ? Number(m.createdAt.seconds) * 1000 +
                Math.floor(m.createdAt.nanos / 1_000_000)
              : 0;
            const isReadByPeer =
              isOwn && lastReadAtByPeer > 0 && createdMs <= lastReadAtByPeer;
            const day = createdMs ? new Date(createdMs) : null;
            const prev = i > 0 ? messages[i - 1] : null;
            const prevDay = prev?.createdAt
              ? new Date(
                  Number(prev.createdAt.seconds) * 1000 +
                    Math.floor(prev.createdAt.nanos / 1_000_000),
                )
              : null;
            const needsSeparator = !!day && (!prevDay || !sameDay(day, prevDay));
            const showAttribution = (isGroup || isChannel) && !isOwn;
            const senderUser = showAttribution ? senderUserByMsgId[m.id] : undefined;
            const isAnchor = unreadAnchorId === m.id;
            return (
              <Fragment key={m.id}>
                {needsSeparator && day && <DaySeparator label={dayLabel(day)} />}
                {isAnchor && dividerCount > 0 && (
                  <UnreadDivider count={dividerCount} />
                )}
                <div data-msg-id={m.id} className="flex flex-col">
                  <MessageBubble
                    message={m}
                    isOwn={isOwn}
                    isReadByPeer={isReadByPeer}
                    showAttribution={showAttribution}
                    senderUser={senderUser}
                    status={(m as Message & { status?: 'pending' | 'sent' | 'read' | 'failed' }).status}
                  />
                </div>
              </Fragment>
            );
          })
        )}
      </div>

      {showJumpButton && (
        <ScrollToBottomButton
          unreadCount={unreadCount}
          onClick={jumpToBottom}
        />
      )}

      {composerHidden ? (
        <div className="shrink-0 px-6 py-6 border-t border-line text-ink-3 text-xs font-mono text-center">
          Only admins can post in this channel.
        </div>
      ) : (
        <div className="shrink-0 border-t border-line">
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
        </div>
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
