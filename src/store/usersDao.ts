// Users DAO. Object-store row shape:
//   { id, handle, display_name, avatar_color, presence_seen_at, enc_blob }
// `enc_blob` is an `AES-GCM(JSON({ bio }))` Uint8Array.

import { decryptJson, encryptJson } from './crypto';
import { STORE_USERS, reqToPromise, tx } from './db';

export type StoredUser = {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  lastSeenAt?: number; // ms epoch
  bio?: string;
};

type Row = {
  id: string;
  handle: string;
  display_name: string;
  avatar_color: string;
  presence_seen_at: number | null;
  enc_blob: Uint8Array | null;
};

export class UsersDao {
  private readonly key: CryptoKey;
  constructor(key: CryptoKey) {
    this.key = key;
  }

  async upsert(u: StoredUser): Promise<void> {
    const enc = await encryptJson(this.key, { bio: u.bio ?? '' });
    await tx(STORE_USERS, 'readwrite', (t) => {
      t.objectStore(STORE_USERS).put({
        id: u.id,
        handle: u.handle,
        display_name: u.displayName,
        avatar_color: u.avatarColor,
        presence_seen_at: u.lastSeenAt ?? null,
        enc_blob: enc,
      } satisfies Row);
    });
  }

  async upsertMany(users: StoredUser[]): Promise<void> {
    if (users.length === 0) return;
    const rows = await Promise.all(
      users.map(async (u) => ({
        id: u.id,
        handle: u.handle,
        display_name: u.displayName,
        avatar_color: u.avatarColor,
        presence_seen_at: u.lastSeenAt ?? null,
        enc_blob: await encryptJson(this.key, { bio: u.bio ?? '' }),
      })),
    );
    await tx(STORE_USERS, 'readwrite', (t) => {
      const s = t.objectStore(STORE_USERS);
      for (const r of rows) s.put(r);
    });
  }

  async get(id: string): Promise<StoredUser | null> {
    const row = (await tx(STORE_USERS, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_USERS).get(id)),
    )) as Row | undefined;
    if (!row) return null;
    return this.rowToUser(row);
  }

  async getMany(ids: string[]): Promise<StoredUser[]> {
    if (ids.length === 0) return [];
    const rows = await tx(STORE_USERS, 'readonly', async (t) => {
      const s = t.objectStore(STORE_USERS);
      return Promise.all(ids.map((id) => reqToPromise(s.get(id))));
    });
    const out: StoredUser[] = [];
    for (const r of rows as Array<Row | undefined>) {
      if (r) out.push(await this.rowToUser(r));
    }
    return out;
  }

  private async rowToUser(r: Row): Promise<StoredUser> {
    let bio = '';
    if (r.enc_blob && r.enc_blob.byteLength > 0) {
      try {
        const blob = await decryptJson<{ bio?: string }>(this.key, r.enc_blob);
        bio = blob.bio ?? '';
      } catch {
        /* tolerate corrupt row */
      }
    }
    return {
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      lastSeenAt: r.presence_seen_at ?? undefined,
      bio,
    };
  }
}
