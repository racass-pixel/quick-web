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
import { ConnectError, Code } from '@connectrpc/connect';
import { messagingClient } from '../api/messaging';
import { ws, type WsEnvelope } from '../api/ws';

// Local-only wrapper around a proto Message adding TG-style queue metadata.
// All UI now passes the local shape through, since proto Message is a
// structural type — extra fields don't break the wire side and existing
// consumers ignore them.
export type MessageStatus = 'pending' | 'sent' | 'read' | 'failed';
// Extra wire fields not present on the proto Message yet — they're carried as
// snake_case JSON on WS envelopes. We add them as optional camelCase props so
// UI code can read them without casting.
export type LocalMessage = Message & {
  status?: MessageStatus;
  tempId?: string;
  queuedAt?: number;
  // Set by the backend when a message has been edited; in ms epoch on the
  // client side.
  editedAt?: number;
  // Monotonic edit counter from the backend; used to ignore out-of-order
  // edit envelopes if any.
  bodyRevision?: number;
  // Pinned-state timestamp (ms epoch). Falsy means not pinned.
  pinnedAt?: number;
  // Message kind: 'text' (default) or 'service' (centered pill rendered by
  // ServiceMessage). 'voice' lands in S11.
  kind?: 'text' | 'service' | 'voice';
  // Tombstone flag — server-side delete-for-everyone. ChatThread filters
  // these out of the rendered list.
  deleted?: boolean;
};

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
  edited_at?: string;
  body_revision?: number;
  pinned_at?: string;
  kind?: 'text' | 'service' | 'voice';
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

// New S10 envelopes — message-level mutation events fanned out by the server
// after Edit/Delete/Pin/Unpin RPCs land.
type WireMessageEditedEnv = {
  kind: 'message_edited';
  conversation_id?: string;
  message_id: string;
  body: string;
  edited_at: string;
  body_revision?: number;
};

type WireMessageDeletedEnv = {
  kind: 'message_deleted';
  conversation_id?: string;
  message_id: string;
  // true → hard-deleted server-side; false → only the recipient soft-hides it
  for_everyone: boolean;
  // Set on for_everyone=false envelopes so we know whose set to update.
  by_user_id?: string;
};

type WireMessagePinnedEnv = {
  kind: 'message_pinned';
  conversation_id?: string;
  message_id: string;
  pinned_at: string;
};

type WireMessageUnpinnedEnv = {
  kind: 'message_unpinned';
  conversation_id?: string;
  message_id: string;
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
  messages: Record<string, LocalMessage[]>; // newest-last
  // Per-conv FIFO queue of pending outbound messages awaiting send. Drained
  // by `drainQueue`. Persisted to `localStorage` on every mutation under
  // `quick.pending.<convId>` so a reload picks up where we left off.
  queueByConv: Record<string, LocalMessage[]>;
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
  // Resume sending a failed message by flipping it back to `pending` and
  // kicking the drainer. No-op if the tempId is no longer in the queue.
  retrySend(convId: string, tempId: string): void;
  // Drain a single conv's queue head-first. Idempotent — running instances
  // are tracked via an in-memory set so calling repeatedly is safe.
  drainQueue(convId: string): Promise<void>;
  markRead(convId: string, lastMsgId: string): Promise<void>;
  sendTyping(convId: string): void;

  // Per-user "deleted-for-me" message ids. Populated by message_deleted
  // envelopes with for_everyone=false. ChatThread filters these out.
  deletedForMeMsgIds: Set<string>;

  // WS handlers
  applyMessage(env: WireMessageEnv): void;
  applyRead(env: WireReadEnv): void;
  applyTyping(env: WireTypingEnv): void;
  applyConversationAdded(env: WireConvAddedEnv): void;
  applyConversationRemoved(env: WireConvRemovedEnv): void;
  applyMessageEdited(env: WireMessageEditedEnv): void;
  applyMessageDeleted(env: WireMessageDeletedEnv): void;
  applyMessagePinned(env: WireMessagePinnedEnv): void;
  applyMessageUnpinned(env: WireMessageUnpinnedEnv): void;
};

// Convert a wire-format message (snake_case + ISO string) to the proto Message
// shape consumed by UI components. We materialize a minimal object that
// satisfies the type — proto Message<"quick.v1.Message"> is a structural type
// so a plain object with matching fields works.
function wireToMessage(w: WireMessage): LocalMessage {
  const date = new Date(w.created_at);
  const ms = date.getTime();
  const editedMs = w.edited_at ? Date.parse(w.edited_at) : undefined;
  const pinnedMs = w.pinned_at ? Date.parse(w.pinned_at) : undefined;
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
    editedAt: editedMs && !Number.isNaN(editedMs) ? editedMs : undefined,
    bodyRevision: w.body_revision,
    pinnedAt: pinnedMs && !Number.isNaN(pinnedMs) ? pinnedMs : undefined,
    kind: w.kind ?? 'text',
  } as unknown as LocalMessage;
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

// In-flight drainer guard. Keeps `drainQueue` idempotent across rapid
// successive sends from the composer or UI retries.
const draining = new Set<string>();

const PENDING_KEY_PREFIX = 'quick.pending.';

function persistQueue(convId: string, queue: LocalMessage[]) {
  try {
    const key = PENDING_KEY_PREFIX + convId;
    if (queue.length === 0) {
      localStorage.removeItem(key);
    } else {
      // Strip non-serialisable bigint fields by writing a stable subset that
      // we know how to rehydrate. We carry only the wire-shaped data plus
      // queue metadata — the proto Message structural fields (id, etc) are
      // re-created from the wire response on success.
      const slim = queue.map((m) => ({
        tempId: m.tempId,
        body: m.body,
        queuedAt: m.queuedAt,
        status: m.status,
      }));
      localStorage.setItem(key, JSON.stringify(slim));
    }
  } catch {
    // localStorage can throw on quota/private-mode — non-fatal, the queue
    // still works in-memory for the current session.
  }
}

function loadPersistedQueues(): Record<string, LocalMessage[]> {
  const out: Record<string, LocalMessage[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PENDING_KEY_PREFIX)) continue;
      const convId = key.slice(PENDING_KEY_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const slim = JSON.parse(raw) as Array<{
          tempId: string;
          body: string;
          queuedAt: number;
          status?: MessageStatus;
        }>;
        out[convId] = slim.map((s) => buildPendingMessage({
          convId,
          body: s.body,
          tempId: s.tempId,
          queuedAt: s.queuedAt,
          senderId: useChats.getState().currentUserId ?? '',
          status: s.status === 'failed' ? 'failed' : 'pending',
        }));
      } catch {
        // ignore a corrupt entry; keep going
      }
    }
  } catch {
    // localStorage unavailable
  }
  return out;
}

// Build a local-only Message stub for a freshly-queued send. The structural
// proto type accepts the extra `status`/`tempId`/`queuedAt` fields.
function buildPendingMessage(opts: {
  convId: string;
  body: string;
  tempId: string;
  queuedAt: number;
  senderId: string;
  status?: MessageStatus;
}): LocalMessage {
  const ms = opts.queuedAt;
  const stub = {
    $typeName: 'quick.v1.Message',
    id: opts.tempId, // temporary id — replaced once the server responds
    conversationId: opts.convId,
    senderId: opts.senderId,
    body: opts.body,
    createdAt: {
      $typeName: 'google.protobuf.Timestamp',
      seconds: BigInt(Math.floor(ms / 1000)),
      nanos: (ms % 1000) * 1_000_000,
    },
    status: opts.status ?? 'pending',
    tempId: opts.tempId,
    queuedAt: ms,
  } as unknown as LocalMessage;
  return stub;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

// Replace a pending stub (matched by tempId) in the conv's messages with the
// real server-issued Message, mark it `sent`, drop it from the queue, persist.
// Also bumps the conversation preview/lastMessageAt for sidebar ordering.
function replacePendingWithReal(convId: string, tempId: string, real: Message) {
  useChats.setState((s) => {
    const queue = s.queueByConv[convId] ?? [];
    const nextQueue = queue.filter((m) => m.tempId !== tempId);
    persistQueue(convId, nextQueue);
    const msgs = s.messages[convId] ?? [];
    const idx = msgs.findIndex((m) => m.tempId === tempId);
    let nextMsgs: LocalMessage[];
    if (idx >= 0) {
      // Dedupe: if the WS already landed this real id while we were awaiting,
      // drop the pending stub instead of duplicating.
      const alreadyHasReal = msgs.some((m) => m.id === real.id && m.tempId !== tempId);
      if (alreadyHasReal) {
        nextMsgs = msgs.filter((m) => m.tempId !== tempId);
      } else {
        nextMsgs = msgs.slice();
        nextMsgs[idx] = {
          ...(real as LocalMessage),
          status: 'sent',
        };
      }
    } else {
      // Pending was already swapped (e.g. by WS path). Nothing to do.
      nextMsgs = msgs;
    }
    const conv = s.byId[convId];
    const nextConv = conv
      ? ({
          ...conv,
          lastMessageAt: real.createdAt,
          preview: real,
        } as Conversation)
      : conv;
    const nextById = nextConv ? { ...s.byId, [convId]: nextConv } : s.byId;
    return {
      messages: { ...s.messages, [convId]: nextMsgs },
      queueByConv: { ...s.queueByConv, [convId]: nextQueue },
      byId: nextById,
      conversationsOrder: nextConv ? reorderConvs(nextById) : s.conversationsOrder,
    };
  });
}

// Mark the queue head (and its rendered bubble) as failed. Leaves the entry
// in the queue so user-initiated retry can re-attempt it.
function markHeadFailed(convId: string, tempId: string) {
  useChats.setState((s) => {
    const queue = s.queueByConv[convId] ?? [];
    const idx = queue.findIndex((m) => m.tempId === tempId);
    if (idx < 0) return {};
    const nextQueue = queue.slice();
    nextQueue[idx] = { ...nextQueue[idx], status: 'failed' };
    const msgs = s.messages[convId] ?? [];
    const mIdx = msgs.findIndex((m) => m.tempId === tempId);
    const nextMsgs = msgs.slice();
    if (mIdx >= 0) nextMsgs[mIdx] = { ...nextMsgs[mIdx], status: 'failed' };
    persistQueue(convId, nextQueue);
    return {
      queueByConv: { ...s.queueByConv, [convId]: nextQueue },
      messages: { ...s.messages, [convId]: nextMsgs },
    };
  });
}

export const useChats = create<ChatsState>((set, get) => ({
  conversationsOrder: [],
  byId: {},
  messages: {},
  queueByConv: {},
  senderUserByMsgId: {},
  hasMore: {},
  typing: {},
  lastReadAtByPeer: {},
  unreadAnchorByConv: {},
  loadingConvs: false,
  loadingMessages: {},
  activeConvId: null,
  currentUserId: null,
  deletedForMeMsgIds: new Set<string>(),

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
    const prev = get().currentUserId;
    set({ currentUserId: id });
    // First time we learn who we are — hydrate any persisted pending queues
    // so the user sees their unsent messages immediately, and kick the
    // drainer on each so they finish what they started.
    if (id && !prev) {
      hydrateQueues();
    }
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
    const tempId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const queuedAt = Date.now();
    const senderId = get().currentUserId ?? '';
    const pending = buildPendingMessage({
      convId,
      body: trimmed,
      tempId,
      queuedAt,
      senderId,
      status: 'pending',
    });
    set((s) => {
      const existing = s.messages[convId] ?? [];
      const queue = s.queueByConv[convId] ?? [];
      const nextQueue = [...queue, pending];
      persistQueue(convId, nextQueue);
      return {
        messages: { ...s.messages, [convId]: [...existing, pending] },
        queueByConv: { ...s.queueByConv, [convId]: nextQueue },
      };
    });
    void get().drainQueue(convId);
  },

  retrySend(convId, tempId) {
    set((s) => {
      const queue = s.queueByConv[convId] ?? [];
      const idx = queue.findIndex((m) => m.tempId === tempId);
      if (idx < 0) return {};
      const updatedQueue = queue.slice();
      updatedQueue[idx] = { ...updatedQueue[idx], status: 'pending' };
      const msgs = s.messages[convId] ?? [];
      const mIdx = msgs.findIndex((m) => m.tempId === tempId);
      const updatedMsgs =
        mIdx >= 0
          ? (() => {
              const copy = msgs.slice();
              copy[mIdx] = { ...copy[mIdx], status: 'pending' };
              return copy;
            })()
          : msgs;
      persistQueue(convId, updatedQueue);
      return {
        queueByConv: { ...s.queueByConv, [convId]: updatedQueue },
        messages: { ...s.messages, [convId]: updatedMsgs },
      };
    });
    void get().drainQueue(convId);
  },

  async drainQueue(convId) {
    if (draining.has(convId)) return;
    draining.add(convId);
    try {
      // Loop the head of the queue. We re-read state every iteration since
      // new sends or WS-driven completions may have mutated it.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const queue = get().queueByConv[convId] ?? [];
        const head = queue[0];
        if (!head) return;
        if (head.status === 'failed') {
          // Stop at a failed head — user must retry explicitly. We
          // intentionally don't drain past it to preserve ordering.
          return;
        }
        try {
          const res = await messagingClient.sendMessage({
            conversationId: convId,
            body: head.body,
          });
          const real = res.message;
          if (!real) {
            // Shouldn't happen in practice; treat as failed so the user can
            // retry rather than silently dropping the message.
            markHeadFailed(convId, head.tempId!);
            return;
          }
          replacePendingWithReal(convId, head.tempId!, real);
        } catch (err) {
          const ce = ConnectError.from(err);
          if (ce.code === Code.ResourceExhausted) {
            // Server has rate-limited us. Read the unix-second retry hint
            // from the trailer metadata (Connect-Web exposes both header
            // and trailer values via the `metadata` Headers object).
            const raw =
              ce.metadata.get('retry-after-unix') ??
              ce.metadata.get('Retry-After-Unix');
            const retryUnix = raw ? Number(raw) : 0;
            const delayMs = retryUnix > 0
              ? Math.max(0, retryUnix * 1000 - Date.now())
              : 1000;
            // eslint-disable-next-line no-console
            console.debug('[chats] drainQueue: rate-limited, sleeping', delayMs);
            await sleep(delayMs);
            // continue: same head will be retried
            continue;
          }
          // Other error → mark failed, stop draining.
          // eslint-disable-next-line no-console
          console.warn('[chats] drainQueue: send failed', ce);
          markHeadFailed(convId, head.tempId!);
          return;
        }
      }
    } finally {
      draining.delete(convId);
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

      // Self-send dedupe: a WS echo of our own send may arrive BEFORE the
      // unary sendMessage response. The pending stub uses a tempId, so a
      // straight id check misses it. Heuristic: if isOwn and there's a
      // pending message with identical body queued within the last 60s,
      // treat the WS arrival as the canonical send completion — swap the
      // pending stub for the real message and drop the queue entry.
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

      if (isOwn) {
        const queue = s.queueByConv[convId] ?? [];
        const now = Date.now();
        const pendingIdx = existing.findIndex(
          (m) =>
            m.tempId &&
            m.status !== 'failed' &&
            m.body === msg.body &&
            m.queuedAt != null &&
            now - m.queuedAt < 60_000,
        );
        if (pendingIdx >= 0) {
          const pending = existing[pendingIdx];
          const nextMsgs = existing.slice();
          nextMsgs[pendingIdx] = {
            ...(msg as LocalMessage),
            status: 'sent',
          };
          const nextQueue = queue.filter((m) => m.tempId !== pending.tempId);
          persistQueue(convId, nextQueue);
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
            messages: { ...s.messages, [convId]: nextMsgs },
            queueByConv: { ...s.queueByConv, [convId]: nextQueue },
            byId: nextById,
            senderUserByMsgId,
            conversationsOrder: nextConv ? reorderConvs(nextById) : s.conversationsOrder,
          };
        }
      }

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
      return {
        messages: { ...s.messages, [convId]: [...existing, msg as LocalMessage] },
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

  applyMessageEdited(env) {
    const editedMs = env.edited_at ? Date.parse(env.edited_at) : Date.now();
    set((s) => {
      // We don't know which conv it belongs to a priori — try the hint first,
      // then fall back to scanning. Threads with thousands of messages aren't
      // a concern here since edits are rare.
      const targetConvId = env.conversation_id;
      const next: Record<string, LocalMessage[]> = { ...s.messages };
      let changed = false;
      const convIds = targetConvId ? [targetConvId] : Object.keys(next);
      for (const cid of convIds) {
        const list = next[cid];
        if (!list) continue;
        const idx = list.findIndex((m) => m.id === env.message_id);
        if (idx < 0) continue;
        const existing = list[idx];
        // Ignore stale revisions (out-of-order delivery).
        if (
          env.body_revision != null &&
          existing.bodyRevision != null &&
          env.body_revision < existing.bodyRevision
        ) {
          continue;
        }
        const updated: LocalMessage = {
          ...existing,
          body: env.body,
          editedAt: editedMs,
          bodyRevision: env.body_revision ?? existing.bodyRevision,
        };
        const copy = list.slice();
        copy[idx] = updated;
        next[cid] = copy;
        changed = true;
        // Also update the conversation preview if this was the last message.
        const conv = s.byId[cid];
        if (conv && conv.preview?.id === env.message_id) {
          const nextConv = {
            ...conv,
            preview: { ...conv.preview, body: env.body },
          } as Conversation;
          s = { ...s, byId: { ...s.byId, [cid]: nextConv } };
        }
        break;
      }
      if (!changed) return {};
      return { messages: next, byId: s.byId };
    });
  },

  applyMessageDeleted(env) {
    set((s) => {
      const myId = s.currentUserId;
      if (!env.for_everyone) {
        // Soft-hide for me only. We rely on `by_user_id` matching our own id;
        // if absent, assume it's targeted at the receiver (us) regardless.
        if (env.by_user_id && myId && env.by_user_id !== myId) return {};
        const nextSet = new Set(s.deletedForMeMsgIds);
        nextSet.add(env.message_id);
        return { deletedForMeMsgIds: nextSet };
      }
      // Hard delete for everyone — drop the message from its conv list.
      const targetConvId = env.conversation_id;
      const next: Record<string, LocalMessage[]> = { ...s.messages };
      let changed = false;
      const convIds = targetConvId ? [targetConvId] : Object.keys(next);
      let touchedConvId: string | null = null;
      for (const cid of convIds) {
        const list = next[cid];
        if (!list) continue;
        const idx = list.findIndex((m) => m.id === env.message_id);
        if (idx < 0) continue;
        const copy = list.slice();
        copy.splice(idx, 1);
        next[cid] = copy;
        changed = true;
        touchedConvId = cid;
        break;
      }
      if (!changed) return {};
      // If the deleted message was the conv preview, fall back to the new
      // last message (if any). The sidebar order doesn't change since
      // lastMessageAt stays.
      let nextById = s.byId;
      if (touchedConvId) {
        const conv = s.byId[touchedConvId];
        if (conv && conv.preview?.id === env.message_id) {
          const list = next[touchedConvId];
          const newPreview = list.length > 0 ? list[list.length - 1] : undefined;
          nextById = {
            ...s.byId,
            [touchedConvId]: {
              ...conv,
              preview: newPreview as Message | undefined,
            } as Conversation,
          };
        }
      }
      return { messages: next, byId: nextById };
    });
  },

  applyMessagePinned(env) {
    const pinnedMs = env.pinned_at ? Date.parse(env.pinned_at) : Date.now();
    set((s) => {
      const targetConvId = env.conversation_id;
      const next: Record<string, LocalMessage[]> = { ...s.messages };
      let changed = false;
      const convIds = targetConvId ? [targetConvId] : Object.keys(next);
      for (const cid of convIds) {
        const list = next[cid];
        if (!list) continue;
        const idx = list.findIndex((m) => m.id === env.message_id);
        if (idx < 0) continue;
        const copy = list.slice();
        copy[idx] = { ...copy[idx], pinnedAt: pinnedMs };
        next[cid] = copy;
        changed = true;
        break;
      }
      if (!changed) return {};
      return { messages: next };
    });
  },

  applyMessageUnpinned(env) {
    set((s) => {
      const targetConvId = env.conversation_id;
      const next: Record<string, LocalMessage[]> = { ...s.messages };
      let changed = false;
      const convIds = targetConvId ? [targetConvId] : Object.keys(next);
      for (const cid of convIds) {
        const list = next[cid];
        if (!list) continue;
        const idx = list.findIndex((m) => m.id === env.message_id);
        if (idx < 0) continue;
        const copy = list.slice();
        copy[idx] = { ...copy[idx], pinnedAt: undefined };
        next[cid] = copy;
        changed = true;
        break;
      }
      if (!changed) return {};
      return { messages: next };
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

// Load any persisted `quick.pending.*` queues into the store and render the
// entries as pending messages in their respective conversations so the user
// sees them immediately. Idempotent — replays are safely deduped on conv id.
let hydrated = false;
function hydrateQueues() {
  if (hydrated) return;
  hydrated = true;
  const queues = loadPersistedQueues();
  const convIds = Object.keys(queues);
  if (convIds.length === 0) return;
  useChats.setState((s) => {
    const nextMessages = { ...s.messages };
    const nextQueue = { ...s.queueByConv };
    for (const convId of convIds) {
      const pending = queues[convId];
      if (!pending || pending.length === 0) continue;
      const existing = nextMessages[convId] ?? [];
      // Drop any entries whose tempId is already in the rendered list.
      const haveTemp = new Set(existing.map((m) => m.tempId).filter(Boolean));
      const fresh = pending.filter((m) => !haveTemp.has(m.tempId));
      nextMessages[convId] = [...existing, ...fresh];
      nextQueue[convId] = [...(nextQueue[convId] ?? []), ...fresh];
    }
    return { messages: nextMessages, queueByConv: nextQueue };
  });
  for (const convId of convIds) {
    void useChats.getState().drainQueue(convId);
  }
}

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
      case 'message_edited':
        store.applyMessageEdited(env as unknown as WireMessageEditedEnv);
        break;
      case 'message_deleted':
        store.applyMessageDeleted(env as unknown as WireMessageDeletedEnv);
        break;
      case 'message_pinned':
        store.applyMessagePinned(env as unknown as WireMessagePinnedEnv);
        break;
      case 'message_unpinned':
        store.applyMessageUnpinned(env as unknown as WireMessageUnpinnedEnv);
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
