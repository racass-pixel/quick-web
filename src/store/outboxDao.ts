// Outbox DAO. Persists unsent messages so a tab reload doesn't drop the user's
// queued sends. The payload is encrypted before hitting disk because it may
// contain message bodies. The drainer in `useChats` reads from this store on
// boot, replays the queue, and dequeues on RPC success.

import { decryptJson, encryptJson } from './crypto';
import { STORE_OUTBOX, reqToPromise, tx } from './db';

export type OutboxEntry = {
  localId: string;
  chatId: string;
  payload: Record<string, unknown>;
  createdAt: number; // ms epoch
  attemptCount: number;
  lastError?: string;
};

type Row = {
  local_id: string;
  chat_id: string;
  enc_payload: Uint8Array; // encrypted JSON
  created_at: number;
  attempt_count: number;
  last_error: string | null;
};

export class OutboxDao {
  private readonly key: CryptoKey;
  constructor(key: CryptoKey) {
    this.key = key;
  }

  async enqueue(entry: OutboxEntry): Promise<void> {
    const enc = await encryptJson(this.key, entry.payload);
    const row: Row = {
      local_id: entry.localId,
      chat_id: entry.chatId,
      enc_payload: enc,
      created_at: entry.createdAt,
      attempt_count: entry.attemptCount,
      last_error: entry.lastError ?? null,
    };
    await tx(STORE_OUTBOX, 'readwrite', (t) => {
      t.objectStore(STORE_OUTBOX).put(row);
    });
  }

  async dequeue(localId: string): Promise<void> {
    await tx(STORE_OUTBOX, 'readwrite', (t) => {
      t.objectStore(STORE_OUTBOX).delete(localId);
    });
  }

  async bumpAttempt(localId: string, error?: string): Promise<void> {
    await tx(STORE_OUTBOX, 'readwrite', async (t) => {
      const s = t.objectStore(STORE_OUTBOX);
      const row = (await reqToPromise(s.get(localId))) as Row | undefined;
      if (!row) return;
      row.attempt_count += 1;
      row.last_error = error ?? null;
      s.put(row);
    });
  }

  async listAll(): Promise<OutboxEntry[]> {
    const rows = (await tx(STORE_OUTBOX, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_OUTBOX).getAll()),
    )) as Row[];
    rows.sort((a, b) => a.created_at - b.created_at);
    return Promise.all(rows.map((r) => this.rowToEntry(r)));
  }

  async listForChat(chatId: string): Promise<OutboxEntry[]> {
    const rows = (await tx(STORE_OUTBOX, 'readonly', (t) => {
      const idx = t.objectStore(STORE_OUTBOX).index('byChatAndTime');
      const range = IDBKeyRange.bound(
        [chatId, -Infinity],
        [chatId, Number.MAX_SAFE_INTEGER],
      );
      return reqToPromise(idx.getAll(range));
    })) as Row[];
    return Promise.all(rows.map((r) => this.rowToEntry(r)));
  }

  private async rowToEntry(r: Row): Promise<OutboxEntry> {
    let payload: Record<string, unknown> = {};
    try {
      if (r.enc_payload && r.enc_payload.byteLength > 0) {
        payload = await decryptJson<Record<string, unknown>>(this.key, r.enc_payload);
      }
    } catch {
      /* tolerate corrupt row */
    }
    return {
      localId: r.local_id,
      chatId: r.chat_id,
      payload,
      createdAt: r.created_at,
      attemptCount: r.attempt_count,
      lastError: r.last_error ?? undefined,
    };
  }
}
