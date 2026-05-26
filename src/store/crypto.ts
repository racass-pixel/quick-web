// AES-GCM blob encryption with SubtleCrypto. Mirrors `lib/store/crypto.dart`:
// HKDF-SHA256 over the session-token bytes (key material) + constant pepper
// (salt) + domain-separation info → 32-byte AES-256 key. The on-disk format
// is `nonce(12) || ciphertext || tag(16)`, stored verbatim as a Uint8Array.
//
// If/when `src/crypto/` ships from the E2E agent, swap `deriveKey` to use
// the shared primitives. The blob layout is stable — anything that produces a
// 12-byte nonce + AES-GCM ciphertext+tag will decrypt existing rows.

const PEPPER = new TextEncoder().encode(
  'quick.tdata.v1.pepper.do-not-change-without-bumping-schema',
);
const INFO = new TextEncoder().encode('quick.tdata.aes-gcm');

let cachedKey: { token: string; key: CryptoKey } | null = null;

export async function deriveKey(sessionToken: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.token === sessionToken) return cachedKey.key;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SubtleCrypto unavailable');

  const ikm = new TextEncoder().encode(sessionToken);
  const hkdfKey = await subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveKey',
  ]);
  const key = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: PEPPER,
      info: INFO,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKey = { token: sessionToken, key };
  return key;
}

export function clearCachedKey() {
  cachedKey = null;
}

// Encrypt arbitrary bytes. Returns `nonce(12) || ciphertext+tag`.
// SubtleCrypto's lib.dom types reject Uint8Array views over `SharedArrayBuffer`,
// so we copy each buffer into a fresh ArrayBuffer-backed view before handing
// it to the API. This is a no-op on the hot path (we already own these bytes).
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

export async function decryptBytes(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<Uint8Array> {
  if (blob.length < 12 + 16) throw new Error('blob too short');
  const nonce = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(ct),
  );
  return new Uint8Array(pt);
}

// JSON convenience — used by every DAO.
export async function encryptJson(
  key: CryptoKey,
  obj: unknown,
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return encryptBytes(key, bytes);
}

export async function decryptJson<T = unknown>(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<T> {
  const bytes = await decryptBytes(key, blob);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

// String convenience.
export async function encryptString(
  key: CryptoKey,
  s: string,
): Promise<Uint8Array> {
  return encryptBytes(key, new TextEncoder().encode(s));
}

export async function decryptString(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, blob));
}
