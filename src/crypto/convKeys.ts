// Per-conversation key cache.
//
// DMs: key derived on the fly from ECDH(my_priv, peer_pub).
// Groups: bundle fetched once; we decrypt our slot to recover the
// symmetric key. Both flavours are memoised for the session.

import { createClient } from '@connectrpc/connect';
import { Messaging, Users } from '@racass-pixel/quick-protocol';
import { transport } from '../api/transport';
import {
  b64decode,
  deriveDmKey,
  importAesKey,
  unwrapGroupKey,
  type IdentityKeyPair,
} from './crypto';
import { identityKeyStore } from './keyStore';

const usersClient = createClient(Users, transport);
const messagingClient = createClient(Messaging, transport);

type Cache = {
  // Identity key cache: user_id -> 32-byte public key.
  identityPubByUser: Map<string, Uint8Array>;
  // Conversation key cache.
  keyByConv: Map<string, CryptoKey>;
  // My identity keypair (lazy-loaded from IndexedDB).
  myPair: IdentityKeyPair | null;
  // Current logged-in user id; used as the key in the per-member bundle map.
  currentUserId: string;
};

const cache: Cache = {
  identityPubByUser: new Map(),
  keyByConv: new Map(),
  myPair: null,
  currentUserId: '',
};

export function resetConvKeyCache(newUserId: string | null) {
  cache.identityPubByUser.clear();
  cache.keyByConv.clear();
  cache.myPair = null;
  cache.currentUserId = newUserId ?? '';
}

async function loadMyPair(): Promise<IdentityKeyPair> {
  if (cache.myPair) return cache.myPair;
  const p = await identityKeyStore.loadOrCreate();
  cache.myPair = p;
  return p;
}

export async function peerIdentityPub(userId: string): Promise<Uint8Array | null> {
  const hit = cache.identityPubByUser.get(userId);
  if (hit) return hit;
  try {
    const res = await usersClient.getIdentityKey({ userId });
    const pk = res.identityKey?.publicKey;
    if (!pk || pk.length !== 32) return null;
    const bytes = new Uint8Array(pk);
    cache.identityPubByUser.set(userId, bytes);
    return bytes;
  } catch {
    return null;
  }
}

export type ConvKeyContext = {
  convId: string;
  convType: string; // 'dm' | 'group' | 'channel'
  peerId?: string;  // populated for DMs
};

// Returns the per-conversation symmetric key, deriving + caching it on first
// use. Returns null when the peer / group hasn't published an identity key
// yet — caller falls back to plaintext.
export async function keyForConv(ctx: ConvKeyContext): Promise<CryptoKey | null> {
  const cached = cache.keyByConv.get(ctx.convId);
  if (cached) return cached;
  const me = await loadMyPair();

  if (ctx.convType === 'dm') {
    if (!ctx.peerId) return null;
    const peerPub = await peerIdentityPub(ctx.peerId);
    if (!peerPub) return null;
    const key = await deriveDmKey(me.privateKey, peerPub);
    cache.keyByConv.set(ctx.convId, key);
    return key;
  }

  // Group / channel: fetch bundle, decrypt our slot.
  let bundle;
  try {
    const res = await messagingClient.getGroupKeyBundle({ conversationId: ctx.convId });
    bundle = res.bundle;
  } catch {
    return null;
  }
  if (!bundle) return null;
  const wrapped = bundle.ciphertextPerMember?.[cache.currentUserId];
  if (!wrapped || wrapped.length === 0) return null;
  if (!bundle.nonce || bundle.nonce.length !== 12) return null;

  // The bundle doesn't carry the uploader's user id explicitly; pick any
  // other member as a candidate sender. The wrap construction is symmetric
  // — ECDH(my_priv, sender_pub) == ECDH(sender_priv, my_pub). As long as we
  // try every other slot key, one will succeed. TODO(s14): include
  // uploader_user_id in the bundle and stop probing.
  for (const otherUid of Object.keys(bundle.ciphertextPerMember ?? {})) {
    if (otherUid === cache.currentUserId) continue;
    const senderPub = await peerIdentityPub(otherUid);
    if (!senderPub) continue;
    try {
      const raw = await unwrapGroupKey({
        myPriv: me.privateKey,
        senderPub,
        myUserId: cache.currentUserId,
        wrappedCiphertext: new Uint8Array(wrapped),
        nonce: new Uint8Array(bundle.nonce),
      });
      const key = await importAesKey(raw);
      cache.keyByConv.set(ctx.convId, key);
      return key;
    } catch {
      // wrong sender candidate — try the next member.
    }
  }
  return null;
}

// Stash a freshly-generated group key so the next encrypt/decrypt for
// `convId` doesn't have to fetch the bundle again.
export async function setGroupKeyRaw(convId: string, raw: Uint8Array): Promise<void> {
  const key = await importAesKey(raw);
  cache.keyByConv.set(convId, key);
}

// Bootstrap helper called by the auth store on sign-in: ensures the
// keypair exists and uploads the public key. Best-effort; errors are
// swallowed so a network blip doesn't block sign-in.
export async function ensureIdentityKey(userId: string): Promise<void> {
  cache.currentUserId = userId;
  try {
    const pair = await loadMyPair();
    await usersClient.uploadIdentityKey({ publicKey: pair.publicKey });
  } catch {
    // best-effort
  }
}

// Helper that decodes the base64 payload some Connect-Web responses serve.
export function rawFromB64(s: string | null | undefined): Uint8Array | null {
  if (!s) return null;
  try {
    return b64decode(s);
  } catch {
    return null;
  }
}
