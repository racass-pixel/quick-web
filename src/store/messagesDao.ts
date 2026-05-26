// Messages DAO. Per-chat queries are served via the compound index
// `(chat_id, created_at)`. The body and any attachments (voice peaks etc) ride
// in two encrypted blob fields so plaintext never sits on disk.

import type { Message } from '@racass-pixel/quick-protocol';
import { decryptJson, decryptString, encryptJson, encryptString } from './crypto';
import { STORE_MESSAGES, reqToPromise, tx } from './db';

type AttachmentsBlob = {
  voice?: {
    fileId: string;
    url: string;
    durationMs: number;
    peaks: number[];
    played: boolean;
  };
};

type Row = {
  id: string;
  chat_id: string;
  sender_id: string;
  created_at: number; // ms epoch
  kind: string;
  status: number;
  enc_body: Uint8Array | null;
  enc_attachments: Uint8Array | null;
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

export class MessagesDao {
  private readonly key: CryptoKey;
  constructor(key: CryptoKey) {
    this.key = key;
  }

  async upsert(m: Message): Promise<void> {
    const row = await this.msgToRow(m);
    await tx(STORE_MESSAGES, 'readwrite', (t) => {
      t.objectStore(STORE_MESSAGES).put(row);
    });
  }

  async upsertMany(msgs: Message[]): Promise<void> {
    if (msgs.length === 0) return;
    const rows = await Promise.all(msgs.map((m) => this.msgToRow(m)));
    await tx(STORE_MESSAGES, 'readwrite', (t) => {
      const s = t.objectStore(STORE_MESSAGES);
      for (const r of rows) s.put(r);
    });
  }

  // Latest `limit` messages for a chat, oldest-first (display order).
  async listLatest(chatId: string, limit = 50): Promise<Message[]> {
    const rows = (await tx(STORE_MESSAGES, 'readonly', (t) => {
      const idx = t.objectStore(STORE_MESSAGES).index('byChatAndTime');
      // descending traversal across the compound range
      const range = IDBKeyRange.bound(
        [chatId, -Infinity],
        [chatId, Number.MAX_SAFE_INTEGER],
      );
      return new Promise<Row[]>((resolve, reject) => {
        const out: Row[] = [];
        const cur = idx.openCursor(range, 'prev');
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || out.length >= limit) {
            resolve(out);
            return;
          }
          out.push(c.value as Row);
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
    })) as Row[];
    const decoded = await Promise.all(rows.map((r) => this.rowToMessage(r)));
    return decoded.reverse(); // oldest-first
  }

  async latestForChat(chatId: string): Promise<Message | null> {
    const row = await tx(STORE_MESSAGES, 'readonly', (t) => {
      const idx = t.objectStore(STORE_MESSAGES).index('byChatAndTime');
      const range = IDBKeyRange.bound(
        [chatId, -Infinity],
        [chatId, Number.MAX_SAFE_INTEGER],
      );
      return new Promise<Row | null>((resolve, reject) => {
        const cur = idx.openCursor(range, 'prev');
        cur.onsuccess = () => {
          const c = cur.result;
          resolve(c ? (c.value as Row) : null);
        };
        cur.onerror = () => reject(cur.error);
      });
    });
    return row ? this.rowToMessage(row) : null;
  }

  async deleteOne(id: string): Promise<void> {
    await tx(STORE_MESSAGES, 'readwrite', (t) => {
      t.objectStore(STORE_MESSAGES).delete(id);
    });
  }

  async deleteAllForChat(chatId: string): Promise<void> {
    await tx(STORE_MESSAGES, 'readwrite', (t) => {
      const s = t.objectStore(STORE_MESSAGES);
      const idx = s.index('byChat');
      return new Promise<void>((resolve, reject) => {
        const cur = idx.openCursor(IDBKeyRange.only(chatId));
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) {
            resolve();
            return;
          }
          c.delete();
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
    });
  }

  async updateBody(id: string, body: string): Promise<void> {
    const enc = await encryptString(this.key, body);
    await tx(STORE_MESSAGES, 'readwrite', async (t) => {
      const s = t.objectStore(STORE_MESSAGES);
      const row = (await reqToPromise(s.get(id))) as Row | undefined;
      if (!row) return;
      row.enc_body = enc;
      s.put(row);
    });
  }

  private async msgToRow(m: Message): Promise<Row> {
    const ms = tsToMs(m.createdAt);
    const encBody = await encryptString(this.key, m.body);
    let encAttachments: Uint8Array | null = null;
    const voice = (m as unknown as { voice?: AttachmentsBlob['voice'] }).voice;
    if (voice) {
      encAttachments = await encryptJson(this.key, { voice } satisfies AttachmentsBlob);
    }
    return {
      id: m.id,
      chat_id: m.conversationId,
      sender_id: m.senderId,
      created_at: ms,
      kind: (m as unknown as { kind?: string }).kind ?? 'text',
      status: 1,
      enc_body: encBody,
      enc_attachments: encAttachments,
    };
  }

  private async rowToMessage(r: Row): Promise<Message> {
    let body = '';
    if (r.enc_body && r.enc_body.byteLength > 0) {
      try {
        body = await decryptString(this.key, r.enc_body);
      } catch {
        /* tolerate corrupt row */
      }
    }
    let voice: AttachmentsBlob['voice'] | undefined;
    if (r.enc_attachments && r.enc_attachments.byteLength > 0) {
      try {
        const blob = await decryptJson<AttachmentsBlob>(this.key, r.enc_attachments);
        voice = blob.voice;
      } catch {
        /* tolerate corrupt attachments */
      }
    }
    return {
      $typeName: 'quick.v1.Message',
      id: r.id,
      conversationId: r.chat_id,
      senderId: r.sender_id,
      body,
      createdAt: msToTs(r.created_at),
      kind: r.kind ?? 'text',
      voice,
    } as unknown as Message;
  }
}
