// Chats store: holds the user's conversations + per-conversation message
// history, plus typing presence. Subscribes to the realtime WebSocket once
// (lazily on first store use) and merges incoming envelopes into state.
//
// Selector pattern: callers should prefer narrow selectors over destructuring
// the entire store, e.g. `useChats((s) => s.messages[id])` — this keeps
// re-renders scoped to the slice that actually changed.

import { create } from 'zustand';
import type {
  Conversation,
  Message,
} from '@racass-pixel/quick-protocol';
import { messagingClient } from '../api/messaging';
import { ws, type WsEnvelope } from '../api/ws';

// Wire-side envelope shapes — JSON, not protobuf.
type WireUser = {
  id: string;
  handle: string;
  display_name: string;
  avatar_color: string;
};

type WireMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string; // ISO timestamp
  sender_user?: WireUser;
};

type WireMessageEnv = {
  kind: 'message';
  // Backend only puts conversation_id inside .message — keep it optional at
  // the top level for forward-compat with envelopes that include it later.
  conversation_id?: string;
  message: WireMessage;
};

type WireReadEnv = {
  kind: 'read';
  conversation_id: string;
  by_user_id: string;
  last_read_at: string;
};

type WireTypingEnv = {
  kind: 'typing';
  conversation_id: string;
  by_user_id: string;
};

type WireConvAdded = {
  id: string;
  type: string;
  title?: string;
  avatar_color?: string;
  my_role: string;
  member_count: number;
  last_message_at: string;
};

type WireConvAddedEnv = {
  kind: 'conversation_added';
  conversation: WireConvAdded;
};

type WireConvRemovedEnv = {
  kind: 'conversation_removed';
  conversation_id: string;
};

// Minimal user snapshot attached to messages for group attribution rendering
// (avatar + display name above peer bubbles in groups/channels).
export type SenderUser = {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
};

type ChatsState = {
  conversationsOrder: string[]; // conv ids, sorted by lastMessageAt desc
  byId: Record<string, Conversation>;
  messages: Record<string, Message[]>; // newest-last
  // senderUserByMsgId: per-message snapshot of the sender, used to render
  // group attribution (avatar + name above bubble) without a roundtrip.
  senderUserByMsgId: Record<string, SenderUser>;
  hasMore: Record<string, boolean>;
  typing: Record<string, Set<string>>; // convId -> userIds typing within last 3s
  // Peer's last-read watermark per conversation (ms epoch). When a `read`
  // envelope arrives from someone other than us, we update this so our
  // outgoing-message bubbles can flip from single to double tick.
  lastReadAtByPeer: Record<string, number>;
  loadingConvs: boolean;
  loadingMessages: Record<string, boolean>;
  activeConvId: string | null;
  currentUserId: string | null;

  // Per-conv unread anchor message id — first unread on initial load. Used
  // by ChatThread to render an UnreadDivider and to set the initial scroll
  // position when opening a conv with unread messages.
  unreadAnchorByConv: Record<string, string | undefined>;

  setActiveConv(convId: string | null): void;
  setCurrentUserId(id: string | null): void;
  loadConversations(): Promise<void>;
  loadMessages(
    convId: string,
    opts?: { before?: string; after?: string; limit?: number },
  ): Promise<{ inserted: number; hasMore: boolean } | void>;
  loadAroundUnread(convId: string): Promise<void>;
  send(convId: string, body: string): Promise<void>;
  markRead(convId: string, lastMsgId: string): Promise<void>;
  sendTyping(convId: string): void;

  // WS handlers
  applyMessage(env: WireMessageEnv): void;
  applyRead(env: WireReadEnv): void;
  applyTyping(env: WireTypingEnv): void;
  applyConversationAdded(env: WireConvAddedEnv): void;
  applyConversationRemoved(env: WireConvRemovedEnv): void;
};

// Convert a wire-format message (snake_case + ISO string) to the proto Message
// shape consumed by UI components. We materialize a minimal object that
// satisfies the type — proto Message<"quick.v1.Message"> is a structural type
// so a plain object with matching fields works.
function wireToMessage(w: WireMessage): Message {
  const date = new Date(w.created_at);
  const ms = date.getTime();
  return {
    $typeName: 'quick.v1.Message',
    id: w.id,
    conversationId: w.conversation_id,
    senderId: w.sender_id,
    body: w.body,
    createdAt: {
      $typeName: 'google.protobuf.Timestamp',
      seconds: BigInt(Math.floor(ms / 1000)),
      nanos: (ms % 1000) * 1_000_000,
    },
  } as unknown as Message;
}

function tsMs(ts: { seconds: bigint; nanos: number } | undefined): number {
  if (!ts) return 0;
  return Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
}

function reorderConvs(byId: Record<string, Conversation>): string[] {
  return Object.values(byId)
    .slice()
    .sort((a, b) => tsMs(b.lastMessageAt) - tsMs(a.lastMessageAt))
    .map((c) => c.id);
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastTypingSent = new Map<string, number>(); // convId -> ms

export const useChats = create<ChatsState>((set, get) => ({
  conversationsOrder: [],
  byId: {},
  messages: {},
  senderUserByMsgId: {},
  hasMore: {},
  typing: {},
  lastReadAtByPeer: {},
  unreadAnchorByConv: {},
  loadingConvs: false,
  loadingMessages: {},
  activeConvId: null,
  currentUserId: null,

  setActiveConv(convId) {
    set((s) => {
      // Closing a conv (or switching to a different one) clears the unread
      // anchor of the previously open thread so reopening recomputes it
      // against the fresh last_read_at.
      const prev = s.activeConvId;
      const next: Partial<ChatsState> = { activeConvId: convId };
      if (prev && prev !== convId) {
        const cleared = { ...s.unreadAnchorByConv };
        delete cleared[prev];
        next.unreadAnchorByConv = cleared;
      }
      return next;
    });
    // NB: the unread count is no longer cleared on conv open. The thread
    // computes its initial scroll anchor from this number, and the count is
    // decremented optimistically by markRead as the user scrolls past unread
    // messages (and via the WS read echo from our own MarkRead call).
  },

  setCurrentUserId(id) {
    set({ currentUserId: id });
  },

  async loadConversations() {
    set({ loadingConvs: true });
    try {
      const res = await messagingClient.listConversations({});
      const byId: Record<string, Conversation> = {};
      for (const c of res.conversations) byId[c.id] = c;
      set({
        byId,
        conversationsOrder: reorderConvs(byId),
      });
    } finally {
      set({ loadingConvs: false });
    }
  },

  async loadMessages(convId, opts) {
    const loading = get().loadingMessages[convId];
    if (loading) return;
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [convId]: true } }));
    try {
      const res = await messagingClient.listMessages({
        conversationId: convId,
        beforeId: opts?.before ?? '',
        afterId: opts?.after ?? '',
        limit: opts?.limit ?? 50,
      });
      // Server returns newest-first; we want oldest-first for display.
      const fresh = res.messages.slice().reverse();
      const isPrepend = !!opts?.before;
      const isAppend = !!opts?.after;
      let inserted = 0;
      set((s) => {
        const existing = s.messages[convId] ?? [];
        let merged: Message[];
        if (isPrepend) {
          // De-dupe against existing head (rare but defensive).
          const existingIds = new Set(existing.map((m) => m.id));
          const filtered = fresh.filter((m) => !existingIds.has(m.id));
          merged = [...filtered, ...existing];
          inserted = filtered.length;
        } else if (isAppend) {
          const existingIds = new Set(existing.map((m) => m.id));
          const filtered = fresh.filter((m) => !existingIds.has(m.id));
          merged = [...existing, ...filtered];
          inserted = filtered.length;
        } else {
          merged = fresh;
          inserted = fresh.length;
        }
        // `hasMore` tracks whether there are older messages available; only
        // mutate it on a base/before-fetch.
        const nextHasMore = isAppend
          ? s.hasMore
          : { ...s.hasMore, [convId]: res.hasMore };
        return {
          messages: { ...s.messages, [convId]: merged },
          hasMore: nextHasMore,
        };
      });
      return { inserted, hasMore: res.hasMore };
    } finally {
      set((s) => {
        const next = { ...s.loadingMessages };
        delete next[convId];
        return { loadingMessages: next };
      });
    }
  },

  async loadAroundUnread(convId) {
    const conv = get().byId[convId];
    const unread = conv?.unreadCount ?? 0;
    if (unread <= 0) {
      // Common case: nothing unread, just load the most recent page and
      // leave the anchor empty (no divider).
      await get().loadMessages(convId);
      set((s) => ({
        unreadAnchorByConv: { ...s.unreadAnchorByConv, [convId]: undefined },
      }));
      return;
    }
    // Load enough recent messages to cover all unread + a bit of context.
    // Backend currently caps the limit at 200.
    const limit = Math.min(200, Math.max(unread + 10, 50));
    await get().loadMessages(convId, { limit });
    // Anchor on the (unread)-th message from the end — the oldest message
    // the user has not yet read. The exact server-side `last_read_at_for_me`
    // isn't on the wire yet; this index-based heuristic matches server
    // ordering and is good enough for the divider position.
    set((s) => {
      const msgs = s.messages[convId] ?? [];
      if (msgs.length === 0) {
        return {
          unreadAnchorByConv: { ...s.unreadAnchorByConv, [convId]: undefined },
        };
      }
      const idx = Math.max(0, msgs.length - unread);
      const anchorId = msgs[idx]?.id;
      return {
        unreadAnchorByConv: { ...s.unreadAnchorByConv, [convId]: anchorId },
      };
    });
  },

  async send(convId, body) {
    const trimmed = body.trim();
    if (!trimmed) return;
    const res = await messagingClient.sendMessage({
      conversationId: convId,
      body: trimmed,
    });
    if (res.message) {
      // The server will also fan this back to us via WS; applyMessage is
      // dedupe-safe so it's fine to land twice.
      const msg = res.message;
      set((s) => {
        const existing = s.messages[convId] ?? [];
        if (existing.some((m) => m.id === msg.id)) return {};
        const conv = s.byId[convId];
        const nextConv = conv
          ? ({
              ...conv,
              lastMessageAt: msg.createdAt,
              preview: msg,
            } as Conversation)
          : conv;
        const nextById = nextConv ? { ...s.byId, [convId]: nextConv } : s.byId;
        return {
          messages: { ...s.messages, [convId]: [...existing, msg] },
          byId: nextById,
          conversationsOrder: nextConv ? reorderConvs(nextById) : s.conversationsOrder,
        };
      });
    }
  },

  async markRead(convId, lastMsgId) {
    await messagingClient.markRead({
      conversationId: convId,
      lastMessageId: lastMsgId,
    });
    set((s) => {
      const conv = s.byId[convId];
      if (!conv || conv.unreadCount === 0) return {};
      return {
        byId: {
          ...s.byId,
          [convId]: { ...conv, unreadCount: 0 } as Conversation,
        },
      };
    });
  },

  sendTyping(convId) {
    const now = Date.now();
    const last = lastTypingSent.get(convId) ?? 0;
    if (now - last < 1500) return;
    lastTypingSent.set(convId, now);
    ws.send({ kind: 'typing', conversation_id: convId });
  },

  applyMessage(env) {
    // Diagnostic: every inbound message envelope, so a missing real-time update
    // is visible in DevTools without backend access.
    // eslint-disable-next-line no-console
    console.debug('[chats] applyMessage', env);
    if (!env?.message) {
      // eslint-disable-next-line no-console
      console.warn('[chats] applyMessage: missing message body', env);
      return;
    }
    const msg = wireToMessage(env.message);
    const convId = env.message.conversation_id ?? env.conversation_id ?? '';
    if (!convId) {
      // eslint-disable-next-line no-console
      console.warn('[chats] applyMessage: no conversation_id', env);
      return;
    }
    set((s) => {
      const existing = s.messages[convId] ?? [];
      if (existing.some((m) => m.id === msg.id)) return {};
      const isActive = s.activeConvId === convId;
      const isOwn = s.currentUserId != null && msg.senderId === s.currentUserId;
      const conv = s.byId[convId];
      const nextConv = conv
        ? ({
            ...conv,
            lastMessageAt: msg.createdAt,
            preview: msg,
            unreadCount:
              isActive || isOwn ? conv.unreadCount : conv.unreadCount + 1,
          } as Conversation)
        : conv;
      const nextById = nextConv ? { ...s.byId, [convId]: nextConv } : s.byId;
      const wireSender = env.message.sender_user;
      const senderUserByMsgId = wireSender
        ? {
            ...s.senderUserByMsgId,
            [msg.id]: {
              id: wireSender.id,
              handle: wireSender.handle,
              displayName: wireSender.display_name,
              avatarColor: wireSender.avatar_color,
            },
          }
        : s.senderUserByMsgId;
      return {
        messages: { ...s.messages, [convId]: [...existing, msg] },
        byId: nextById,
        senderUserByMsgId,
        conversationsOrder: nextConv ? reorderConvs(nextById) : s.conversationsOrder,
      };
    });
  },

  applyRead(env) {
    set((s) => {
      const updates: Partial<ChatsState> = {};

      // Own read receipt → clear local unread count for snappy UI.
      if (s.currentUserId != null && env.by_user_id === s.currentUserId) {
        const conv = s.byId[env.conversation_id];
        if (conv && conv.unreadCount > 0) {
          updates.byId = {
            ...s.byId,
            [env.conversation_id]: { ...conv, unreadCount: 0 } as Conversation,
          };
        }
      } else if (env.by_user_id) {
        // Peer's read receipt → bump the per-conv watermark so our outgoing
        // bubbles can flip from single to double tick.
        const ms = env.last_read_at ? Date.parse(env.last_read_at) : Date.now();
        const prev = s.lastReadAtByPeer[env.conversation_id] ?? 0;
        if (ms > prev) {
          updates.lastReadAtByPeer = {
            ...s.lastReadAtByPeer,
            [env.conversation_id]: ms,
          };
        }
      }

      return updates;
    });
  },

  applyConversationAdded(env) {
    const w = env.conversation;
    if (!w?.id) return;
    set((s) => {
      if (s.byId[w.id]) return {}; // already known; full refresh below will reconcile
      const lastMs = w.last_message_at ? Date.parse(w.last_message_at) : 0;
      const stub = {
        $typeName: 'quick.v1.Conversation',
        id: w.id,
        type: w.type,
        title: w.title ?? '',
        peer: undefined,
        lastMessageAt: lastMs
          ? {
              $typeName: 'google.protobuf.Timestamp',
              seconds: BigInt(Math.floor(lastMs / 1000)),
              nanos: (lastMs % 1000) * 1_000_000,
            }
          : undefined,
        preview: undefined,
        unreadCount: 0,
        memberCount: w.member_count ?? 0,
        avatarColor: w.avatar_color ?? '',
        myRole: w.my_role ?? '',
      } as unknown as Conversation;
      const nextById = { ...s.byId, [w.id]: stub };
      return {
        byId: nextById,
        conversationsOrder: reorderConvs(nextById),
      };
    });
    // Reconcile against server to get peer/preview if any.
    void get().loadConversations();
  },

  applyConversationRemoved(env) {
    const id = env.conversation_id;
    if (!id) return;
    set((s) => {
      if (!s.byId[id]) return {};
      const nextById = { ...s.byId };
      delete nextById[id];
      const nextMessages = { ...s.messages };
      delete nextMessages[id];
      const nextTyping = { ...s.typing };
      delete nextTyping[id];
      const nextHasMore = { ...s.hasMore };
      delete nextHasMore[id];
      const nextActive = s.activeConvId === id ? null : s.activeConvId;
      return {
        byId: nextById,
        messages: nextMessages,
        typing: nextTyping,
        hasMore: nextHasMore,
        activeConvId: nextActive,
        conversationsOrder: reorderConvs(nextById),
      };
    });
  },

  applyTyping(env) {
    const convId = env.conversation_id;
    const userId = env.by_user_id;
    if (!userId) return;
    set((s) => {
      const existing = s.typing[convId] ?? new Set<string>();
      const next = new Set(existing);
      next.add(userId);
      return { typing: { ...s.typing, [convId]: next } };
    });
    const key = `${convId}::${userId}`;
    const prev = typingTimers.get(key);
    if (prev) clearTimeout(prev);
    typingTimers.set(
      key,
      setTimeout(() => {
        typingTimers.delete(key);
        useChats.setState((s) => {
          const existing = s.typing[convId];
          if (!existing || !existing.has(userId)) return {};
          const next = new Set(existing);
          next.delete(userId);
          return { typing: { ...s.typing, [convId]: next } };
        });
      }, 3000),
    );
  },
}));

// Wire WS envelopes into the store once. Doing this at module load means any
// component that imports useChats also activates the bridge.
let bridged = false;
function bridgeWs() {
  if (bridged) return;
  bridged = true;
  ws.subscribe((env: WsEnvelope) => {
    // eslint-disable-next-line no-console
    console.debug('[chats] ws envelope', env);
    const store = useChats.getState();
    switch (env.kind) {
      case 'message':
        store.applyMessage(env as unknown as WireMessageEnv);
        break;
      case 'read':
        store.applyRead(env as unknown as WireReadEnv);
        break;
      case 'typing':
        store.applyTyping(env as unknown as WireTypingEnv);
        break;
      case 'conversation_added':
        store.applyConversationAdded(env as unknown as WireConvAddedEnv);
        break;
      case 'conversation_removed':
        store.applyConversationRemoved(env as unknown as WireConvRemovedEnv);
        break;
      default:
      // ignore unknown kinds; forward-compatible
    }
  });
  // On reconnect, refetch conversations + active thread so we don't miss
  // events that fired while disconnected.
  ws.onLifecycle((evt) => {
    if (evt !== 'open') return;
    const s = useChats.getState();
    void s.loadConversations();
    if (s.activeConvId) void s.loadMessages(s.activeConvId);
  });
}
bridgeWs();
