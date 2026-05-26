# quick-web integration notes

## tdata local store

A Telegram-style on-disk encrypted cache backs the in-memory Zustand stores
(`useChats`, `useAuth`) so the sidebar and the active thread paint instantly
on tab open and stay usable when the network drops.

### DB location

IndexedDB database named `quick-tdata`, version 1. Lives in the browser's
per-origin storage area — no opt-in needed. Object stores:

- `users` (keyPath `id`) — handle, display name, avatar color, presence
  timestamp, `enc_blob` (JSON of bio + future fields)
- `chats` (keyPath `id`, index `byLastMessageAt`) — type, last_message_at
  (ms epoch), last_message_id, unread_count, pinned_at, `enc_blob` (title,
  peer, preview, member count, role)
- `chat_members` (keyPath `[chat_id, user_id]`, index `byChat`)
- `messages` (keyPath `id`, compound index `byChatAndTime` on
  `[chat_id, created_at]`, secondary `byChat`) — sender_id, created_at,
  kind, status, `enc_body`, `enc_attachments`
- `media_cache` (keyPath `file_id`) — Blob + mime + size + cached_at
- `outbox` (keyPath `local_id`, compound index `byChatAndTime`) —
  encrypted JSON payload + retry bookkeeping

### Schema version

`DB_VERSION = 1` (see `src/store/db.ts`). Future versions bump the constant
and add an `if (oldVersion < N)` branch to `onupgradeneeded`. Open-failures
with `VersionError` quarantine the DB automatically by deleting it and
retrying once — the next sync rebuilds from the server.

### How to wipe (debugging)

In DevTools console:

```js
import('/src/store/index.ts').then(m => m.LocalStore.wipe());
// or just:
indexedDB.deleteDatabase('quick-tdata');
```

`LocalStore.wipe()` closes the cached connection, drops the derived key from
memory, and calls `indexedDB.deleteDatabase('quick-tdata')`. Equivalent to
the on-disk effect of signing out.

### How the encryption key is derived

`src/store/crypto.ts#deriveKey(sessionToken)`:

1. Take the session token bytes (UTF-8) as HKDF input key material.
2. Run HKDF-SHA256 with the constant 32-byte pepper
   `quick.tdata.v1.pepper.do-not-change-without-bumping-schema` as salt and
   `quick.tdata.aes-gcm` as info to derive a 32-byte AES-256 key
   (`crypto.subtle.deriveKey`).
3. Each row's `enc_*` field is `nonce(12) || ciphertext+tag` from
   AES-GCM. Fresh random nonce per row.

Switching accounts produces a different token → different key, and the old
rows fail to decrypt. The `useAuth` boot path defensively calls
`LocalStore.wipe()` on sign-out so a future sign-in opens against a clean DB.

The E2E crypto agent's `src/crypto/` does not exist at the time of writing.
When it lands, swap `deriveKey` to use the shared primitives — the on-disk
blob format is stable and won't need a schema bump as long as
nonce+ciphertext+tag stays at 12+N+16 bytes.

### Sync algorithm (local-first + delta from server)

Boot (per tab):
1. `useAuth` watches the localStorage session token.
2. On a non-null token, `LocalStore.boot(token)` opens the IndexedDB
   connection and derives the AES-GCM key.
3. `useChats.loadConversations()` (called from the chats route mount):
   first reads from `store.chats.listAll()` and seeds `byId` so the sidebar
   paints from disk, then calls `ListConversations` and writes through.

Per-thread:
1. `useChats.loadMessages(convId)` reads `store.messages.listLatest(convId, limit)`
   and surfaces them via `state.messages[convId]` immediately.
2. It then calls `ListMessages` with `afterId = <newest cached message id>`
   (when available) so the server only sends the gap since last sync.
3. Returned rows are merged, deduped on id, and persisted via
   `store.messages.upsertMany(fresh)`.
4. WS `message` envelopes are persisted in `applyMessage` before being
   merged into in-memory state — a tab reload immediately after receipt
   does not lose the message.

On sign-out (`useAuth.signOut()`):
1. `session.setToken(null)` clears the localStorage token.
2. `LocalStore.wipe()` closes the connection, clears the cached key, and
   deletes the IndexedDB database.
