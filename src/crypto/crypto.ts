// End-to-end crypto primitives for the web client. Mirrors the Flutter
// scheme in lib/crypto/crypto.dart so the two clients interop bit-for-bit.
//
// Scheme:
//   * X25519 identity keypair stored in IndexedDB (the matching private
//     key never leaves the browser).
//   * DM key:   HKDF-SHA256(ECDH(my_priv, peer_pub)) -> 32-byte key.
//   * Group:    random 32-byte group key, wrapped to each member's
//               identity pubkey using the same DM derivation.
//   * Envelope: AES-256-GCM, 12-byte random nonce, AAD = sender|conv|ts.
//
// X25519 + HKDF come from @noble (no SubtleCrypto equivalent for X25519 in
// browsers without using ECDH-P256 which we don't want). AES-GCM uses the
// native SubtleCrypto for hardware acceleration.

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

export type IdentityKeyPair = {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array;  // 32 bytes
};

export type EncryptedBlob = {
  ciphertext: Uint8Array; // includes 16-byte GCM tag at tail
  nonce: Uint8Array;      // 12 bytes
};

export type GroupBundleSealed = {
  perMember: Record<string, Uint8Array>;
  nonce: Uint8Array;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function buildAad(senderId: string, conversationId: string, createdAtMs: number): Uint8Array {
  return enc.encode(`${senderId}|${conversationId}|${createdAtMs}`);
}

// SubtleCrypto's BufferSource type signature in TS 6 excludes Uint8Array
// over SharedArrayBuffer. We never see SharedArrayBuffer in practice — all
// our bytes come from regular Uint8Array — but the type system can't prove
// it. Round-trip through a fresh ArrayBuffer slice so the call sites stay
// readable.
function ab(u: Uint8Array): ArrayBuffer {
  // .slice() guarantees an ArrayBuffer (not SharedArrayBuffer).
  return u.byteOffset === 0 && u.byteLength === u.buffer.byteLength && u.buffer instanceof ArrayBuffer
    ? (u.buffer as ArrayBuffer)
    : (u.slice().buffer as ArrayBuffer);
}

// Identity keypair generation. The private key never leaves the device —
// it lives in IndexedDB (see keyStore.ts).
export function generateIdentityKey(): IdentityKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

// Re-derive the public half from a stored private key.
export function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

// ECDH + HKDF-SHA256 -> 32-byte symmetric key. Both parties compute the
// SAME key from their respective (priv, peerPub) pairs.
async function deriveSharedKey(
  myPriv: Uint8Array,
  peerPub: Uint8Array,
  context: string,
): Promise<CryptoKey> {
  const shared = x25519.getSharedSecret(myPriv, peerPub);
  // Salt = 'quick.e2e' (8 bytes) — mirrors the Flutter implementation.
  const salt = new Uint8Array([0x71, 0x69, 0x63, 0x6b, 0x2e, 0x65, 0x32, 0x65]);
  const raw = hkdf(sha256, shared, salt, enc.encode(context), 32);
  return crypto.subtle.importKey('raw', ab(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function deriveDmKey(myPriv: Uint8Array, peerPub: Uint8Array): Promise<CryptoKey> {
  return deriveSharedKey(myPriv, peerPub, 'quick.dm.aes256gcm');
}

export function deriveBundleKey(myPriv: Uint8Array, peerPub: Uint8Array): Promise<CryptoKey> {
  return deriveSharedKey(myPriv, peerPub, 'quick.group.wrap.aes256gcm');
}

export function generateGroupKey(): Uint8Array {
  return randomBytes(32);
}

export function newNonce(): Uint8Array {
  return randomBytes(12);
}

// AAD-bound AES-GCM seal of UTF-8 plaintext.
export async function encryptText(
  key: CryptoKey,
  plaintext: string,
  opts: { senderId: string; conversationId: string; createdAtMs: number },
): Promise<EncryptedBlob> {
  const nonce = newNonce();
  const aad = buildAad(opts.senderId, opts.conversationId, opts.createdAtMs);
  const bytes = enc.encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad) }, key, ab(bytes)),
  );
  return { ciphertext: ct, nonce };
}

export async function decryptText(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  opts: { senderId: string; conversationId: string; createdAtMs: number },
): Promise<string> {
  const aad = buildAad(opts.senderId, opts.conversationId, opts.createdAtMs);
  const out = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad) }, key, ab(ciphertext)),
  );
  return dec.decode(out);
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  opts: { senderId: string; conversationId: string; createdAtMs: number },
): Promise<EncryptedBlob> {
  const nonce = newNonce();
  const aad = buildAad(opts.senderId, opts.conversationId, opts.createdAtMs);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad) }, key, ab(plaintext)),
  );
  return { ciphertext: ct, nonce };
}

export async function decryptBytes(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  opts: { senderId: string; conversationId: string; createdAtMs: number },
): Promise<Uint8Array> {
  const aad = buildAad(opts.senderId, opts.conversationId, opts.createdAtMs);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad) }, key, ab(ciphertext)),
  );
}

// Wrap a 32-byte group key for each recipient. Nonce is shared across all
// slots — safe because each slot uses a FRESH derived key (no nonce reuse
// within a single key).
export async function wrapGroupKey(opts: {
  myPriv: Uint8Array;
  groupKey: Uint8Array;
  memberPubKeys: Record<string, Uint8Array>;
}): Promise<GroupBundleSealed> {
  const nonce = newNonce();
  const perMember: Record<string, Uint8Array> = {};
  for (const [userId, peerPub] of Object.entries(opts.memberPubKeys)) {
    const k = await deriveBundleKey(opts.myPriv, peerPub);
    const aad = enc.encode(`bundle:${userId}`);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad) },
        k,
        ab(opts.groupKey),
      ),
    );
    perMember[userId] = ct;
  }
  return { perMember, nonce };
}

// Recipient-side: recover the group key from our slot.
export async function unwrapGroupKey(opts: {
  myPriv: Uint8Array;
  senderPub: Uint8Array;
  myUserId: string;
  wrappedCiphertext: Uint8Array;
  nonce: Uint8Array;
}): Promise<Uint8Array> {
  const k = await deriveBundleKey(opts.myPriv, opts.senderPub);
  const aad = enc.encode(`bundle:${opts.myUserId}`);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ab(opts.nonce), additionalData: ab(aad) },
      k,
      ab(opts.wrappedCiphertext),
    ),
  );
}

// Import a raw 32-byte symmetric key into a CryptoKey usable by AES-GCM.
// Used by ConvKeyCache after unwrapping a group bundle.
export function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ab(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// --- base64 helpers ---

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
