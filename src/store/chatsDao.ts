// Chats DAO. Stores the proto Conversation shape (with BigInt-timestamps
// flattened to ms epoch in scalar columns) so the sidebar can hydrate
// instantly. The full conversation (title, peer, preview, member count, etc)
// rides in the encrypted blob.

import type { Conversation, Message } from '@racass-pixel/quick-protocol';
import { decryptJson, encryptJson } from './crypto';
import { STORE_CHATS, reqToPromise, tx } from './db';

type ChatBlob = {
  title: string;
  peer?: {
    id: string;
    handle: string;
    displayName: string;
    avatarColor: string;
    lastSeenAtMs?: number;
    bio?: string;
  };
  avatarColor: string;
  memberCount: number;
  myRole: string;
  preview?: {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    createdAtMs: number;
    kind?: string;
  };
};

type Row = {
  id: string;
  kind: string;
  last_message_at: number; // ms epoch, 0 = none (indexed)
  last_message_id: string | null;
  unread_count: number;
  pinned_at: number | null;
  enc_blob: Uint8Array;
};

function tsToMs(ts: { seconds: bigint; nanos: number } | undefined): number {
  if (!ts) return 0;
  return Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
}

function msToTs(ms: number): { $typeName: string; seconds: bigint; nanos: number } {
  return {
    $typeName: 'google.protobuf.Timestamp',
    seconds: BigInt(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

export class ChatsDao {
  private readonly key: CryptoKey;
  constructor(key: CryptoKey) {
    this.key = key;
  }

  async upsert(c: Conversation): Promise<void> {
    const row = await this.convToRow(c);
    await tx(STORE_CHATS, 'readwrite', (t) => {
      t.objectStore(STORE_CHATS).put(row);
    });
  }

  async upsertMany(chats: Conversation[]): Promise<void> {
    if (chats.length === 0) return;
    const rows = await Promise.all(chats.map((c) => this.convToRow(c)));
    await tx(STORE_CHATS, 'readwrite', (t) => {
      const s = t.objectStore(STORE_CHATS);
      for (const r of rows) s.put(r);
    });
  }

  // Most-recent first.
  async listAll(): Promise<Conversation[]> {
    const rows = (await tx(STORE_CHATS, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_CHATS).getAll()),
    )) as Row[];
    const out = await Promise.all(rows.map((r) => this.rowToConv(r)));
    out.sort((a, b) => tsToMs(b.lastMessageAt) - tsToMs(a.lastMessageAt));
    return out;
  }

  async get(id: string): Promise<Conversation | null> {
    const row = (await tx(STORE_CHATS, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_CHATS).get(id)),
    )) as Row | undefined;
    if (!row) return null;
    return this.rowToConv(row);
  }

  async delete(id: string): Promise<void> {
    await tx(STORE_CHATS, 'readwrite', (t) => {
      t.objectStore(STORE_CHATS).delete(id);
    });
  }

  async setUnread(id: string, unreadCount: number): Promise<void> {
    await tx(STORE_CHATS, 'readwrite', async (t) => {
      const s = t.objectStore(STORE_CHATS);
      const row = (await reqToPromise(s.get(id))) as Row | undefined;
      if (!row) return;
      row.unread_count = unreadCount;
      s.put(row);
    });
  }

  async setPinnedAt(id: string, pinnedAtMs: number | null): Promise<void> {
    await tx(STORE_CHATS, 'readwrite', async (t) => {
      const s = t.objectStore(STORE_CHATS);
      const row = (await reqToPromise(s.get(id))) as Row | undefined;
      if (!row) return;
      row.pinned_at = pinnedAtMs;
      s.put(row);
    });
  }

  private async convToRow(c: Conversation): Promise<Row> {
    const blob: ChatBlob = {
      title: c.title,
      peer: c.peer
        ? {
            id: c.peer.id,
            handle: c.peer.handle,
            displayName: c.peer.displayName,
            avatarColor: c.peer.avatarColor,
            lastSeenAtMs: tsToMs(
              (c.peer as unknown as { lastSeenAt?: { seconds: bigint; nanos: number } })
                .lastSeenAt,
            ),
            bio: (c.peer as unknown as { bio?: string }).bio ?? '',
          }
        : undefined,
      avatarColor: c.avatarColor,
      memberCount: c.memberCount,
      myRole: c.myRole,
      preview: c.preview
        ? {
            id: c.preview.id,
            conversationId: c.preview.conversationId,
            senderId: c.preview.senderId,
            body: c.preview.body,
            createdAtMs: tsToMs(c.preview.createdAt),
            kind: (c.preview as unknown as { kind?: string }).kind ?? 'text',
          }
        : undefined,
    };
    return {
      id: c.id,
      kind: c.type,
      last_message_at: tsToMs(c.lastMessageAt),
      last_message_id: c.preview?.id ?? null,
      unread_count: c.unreadCount ?? 0,
      pinned_at: null,
      enc_blob: await encryptJson(this.key, blob),
    };
  }

  private async rowToConv(r: Row): Promise<Conversation> {
    let blob: ChatBlob | null = null;
    try {
      if (r.enc_blob && r.enc_blob.byteLength > 0) {
        blob = await decryptJson<ChatBlob>(this.key, r.enc_blob);
      }
    } catch {
      /* tolerate corrupt row */
    }
    const lastMessageAt = r.last_message_at > 0 ? msToTs(r.last_message_at) : undefined;
    const preview: Message | undefined = blob?.preview
      ? ({
          $typeName: 'quick.v1.Message',
          id: blob.preview.id,
          conversationId: blob.preview.conversationId,
          senderId: blob.preview.senderId,
          body: blob.preview.body,
          createdAt: msToTs(blob.preview.createdAtMs),
          kind: blob.preview.kind ?? 'text',
        } as unknown as Message)
      : undefined;
    return {
      $typeName: 'quick.v1.Conversation',
      id: r.id,
      type: r.kind,
      title: blob?.title ?? '',
      peer: blob?.peer
        ? ({
            $typeName: 'quick.v1.User',
            id: blob.peer.id,
            handle: blob.peer.handle,
            displayName: blob.peer.displayName,
            avatarColor: blob.peer.avatarColor,
            lastSeenAt: blob.peer.lastSeenAtMs
              ? msToTs(blob.peer.lastSeenAtMs)
              : undefined,
            bio: blob.peer.bio ?? '',
          } as unknown as Conversation['peer'])
        : undefined,
      lastMessageAt,
      preview,
      unreadCount: r.unread_count,
      memberCount: blob?.memberCount ?? 0,
      avatarColor: blob?.avatarColor ?? '',
      myRole: blob?.myRole ?? '',
    } as unknown as Conversation;
  }
}
