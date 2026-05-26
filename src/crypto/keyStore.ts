// Persistent storage for the E2E identity keypair, backed by IndexedDB.
//
// We store the raw 32-byte private key. On modern browsers IndexedDB is
// origin-scoped; a separate origin can't read these bytes. Future work:
// wrap the private key under a SubtleCrypto-derived KEK so cross-tab key
// reads aren't trivially observable from devtools.

import { b64decode, b64encode, derivePublicKey, generateIdentityKey, type IdentityKeyPair } from './crypto';

const DB_NAME = 'quick.crypto';
const STORE = 'identity';
const KEY = 'singleton';

type StoredRecord = {
  privateKey: string; // base64
  publicKey: string;  // base64
};

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    fn(store).then(resolve, reject);
    t.onerror = () => reject(t.error);
  });
}

function getValue<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function putValue(store: IDBObjectStore, key: IDBValidKey, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteValue(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export const identityKeyStore = {
  // Returns the cached keypair, generating + persisting one if this is the
  // first call. Caller is responsible for uploading the public key via
  // Users.UploadIdentityKey.
  async loadOrCreate(): Promise<IdentityKeyPair> {
    const existing = await tx<StoredRecord | undefined>('readonly', (s) => getValue<StoredRecord>(s, KEY));
    if (existing) {
      return {
        privateKey: b64decode(existing.privateKey),
        publicKey: b64decode(existing.publicKey),
      };
    }
    const fresh = generateIdentityKey();
    // Double-check that the derived public matches (defensive).
    const computedPub = derivePublicKey(fresh.privateKey);
    if (b64encode(computedPub) !== b64encode(fresh.publicKey)) {
      // Should never happen; treat as a hard error so callers don't ship a
      // mismatched key.
      throw new Error('identity keypair invariant broken');
    }
    const record: StoredRecord = {
      privateKey: b64encode(fresh.privateKey),
      publicKey: b64encode(fresh.publicKey),
    };
    await tx('readwrite', (s) => putValue(s, KEY, record));
    return fresh;
  },

  async clear(): Promise<void> {
    await tx('readwrite', (s) => deleteValue(s, KEY));
  },
};
