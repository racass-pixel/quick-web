// Public facade for the tdata local store. The `LocalStore` singleton holds
// the derived AES-GCM key and exposes typed DAOs so callers don't have to
// thread the CryptoKey through every read.

import { deleteDb, openDb } from './db';
import { clearCachedKey, deriveKey } from './crypto';
import { UsersDao } from './usersDao';
import { ChatsDao } from './chatsDao';
import { MessagesDao } from './messagesDao';
import { MediaDao } from './mediaDao';
import { OutboxDao } from './outboxDao';

export class LocalStore {
  readonly users: UsersDao;
  readonly chats: ChatsDao;
  readonly messages: MessagesDao;
  readonly media: MediaDao;
  readonly outbox: OutboxDao;

  readonly key: CryptoKey;
  private constructor(key: CryptoKey) {
    this.key = key;
    this.users = new UsersDao(key);
    this.chats = new ChatsDao(key);
    this.messages = new MessagesDao(key);
    this.media = new MediaDao();
    this.outbox = new OutboxDao(key);
  }

  static _instance: LocalStore | null = null;
  static _booting: Promise<LocalStore> | null = null;

  static get instance(): LocalStore | null {
    return LocalStore._instance;
  }

  // Opens the IDB connection + derives the key. Safe to call repeatedly.
  static async boot(sessionToken: string): Promise<LocalStore> {
    if (LocalStore._instance) return LocalStore._instance;
    if (LocalStore._booting) return LocalStore._booting;
    LocalStore._booting = (async () => {
      try {
        await openDb();
        const key = await deriveKey(sessionToken);
        const inst = new LocalStore(key);
        LocalStore._instance = inst;
        return inst;
      } finally {
        LocalStore._booting = null;
      }
    })();
    return LocalStore._booting;
  }

  // Wipe the on-disk DB. Used on sign-out / account switch so the next
  // session opens against a fresh store with a fresh key.
  static async wipe(): Promise<void> {
    LocalStore._instance = null;
    clearCachedKey();
    await deleteDb();
  }
}

export { deleteDb, openDb } from './db';
