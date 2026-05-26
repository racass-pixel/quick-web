// tdata local store backed by IndexedDB.
//
// Mirrors the Flutter schema (users / chats / chat_members / messages /
// media_cache / outbox) so the two clients share a mental model. Scalar fields
// we want to index live as top-level columns; the rest is bundled into an
// encrypted blob field (see `crypto.ts`).
//
// Single connection per origin held in the `dbPromise` singleton — opened
// lazily on first DAO call. Bump `DB_VERSION` and add an `if (oldVersion < N)`
// branch in `onupgradeneeded` to evolve the schema.

export const DB_NAME = 'quick-tdata';
export const DB_VERSION = 1;

export const STORE_USERS = 'users';
export const STORE_CHATS = 'chats';
export const STORE_CHAT_MEMBERS = 'chat_members';
export const STORE_MESSAGES = 'messages';
export const STORE_MEDIA = 'media_cache';
export const STORE_OUTBOX = 'outbox';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  dbPromise = new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion;
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_USERS)) {
          // Keyed by id; we surface handle/display_name in the enc_blob.
          db.createObjectStore(STORE_USERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHATS)) {
          const s = db.createObjectStore(STORE_CHATS, { keyPath: 'id' });
          s.createIndex('byLastMessageAt', 'last_message_at');
        }
        if (!db.objectStoreNames.contains(STORE_CHAT_MEMBERS)) {
          const s = db.createObjectStore(STORE_CHAT_MEMBERS, {
            keyPath: ['chat_id', 'user_id'],
          });
          s.createIndex('byChat', 'chat_id');
        }
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const s = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
          // Compound index supports `IDBKeyRange.bound([chatId, 0], [chatId, +Inf])`
          // lookups ordered by created_at — the same query the Flutter side
          // does via `ORDER BY created_at DESC`.
          s.createIndex('byChatAndTime', ['chat_id', 'created_at']);
          s.createIndex('byChat', 'chat_id');
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA, { keyPath: 'file_id' });
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const s = db.createObjectStore(STORE_OUTBOX, { keyPath: 'local_id' });
          s.createIndex('byChatAndTime', ['chat_id', 'created_at']);
        }
      }
      // Future bumps go here.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      // VersionError → most likely a stale, mismatched DB. Treat as corrupt:
      // wipe and retry once. (`onblocked` may also fire if another tab holds
      // the old DB; we accept the failure rather than racing.)
      const err = req.error;
      const name = err?.name ?? '';
      if (name === 'VersionError') {
        deleteDb()
          .then(() => {
            dbPromise = null;
            openDb().then(resolve, reject);
          })
          .catch(reject);
        return;
      }
      reject(err ?? new Error('IndexedDB open failed'));
    };
    req.onblocked = () => {
      // Another tab is holding an older version open. Surface to the caller
      // and let them decide whether to nag the user.
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return dbPromise;
}

export function deleteDb(): Promise<void> {
  // Drop the in-flight handle so subsequent openDb() calls get a fresh one.
  dbPromise = null;
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    req.onblocked = () => {
      // Other tabs hold the DB open. Resolve anyway — the delete is queued.
      resolve();
    };
  });
}

// --- transaction helpers ---------------------------------------------------

export async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores as string | string[], mode);
    let result: T | undefined;
    let err: unknown = null;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(err ?? t.error ?? new Error('tx aborted'));
    t.oncomplete = () => resolve(result as T);
    Promise.resolve(fn(t))
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        err = e;
        try {
          t.abort();
        } catch {
          /* ignore */
        }
      });
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
