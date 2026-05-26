// Media cache DAO. Two pieces of state:
//   1. an IndexedDB row keyed by fileId pointing at a Blob in the same store
//   2. an in-memory `URL.createObjectURL` map so playback gets a stable URL
//      across re-renders.
// Audio/image blobs themselves are NOT encrypted at rest — they are opaque,
// re-downloadable, and storing 16-byte tags around every chunk only burns
// space.

import { STORE_MEDIA, reqToPromise, tx } from './db';

export type CachedMedia = {
  fileId: string;
  blob: Blob;
  mime: string;
  sizeBytes: number;
  cachedAt: number; // ms epoch
};

type Row = {
  file_id: string;
  blob: Blob;
  mime: string;
  size_bytes: number;
  cached_at: number;
};

const objectUrls = new Map<string, string>(); // fileId → URL.createObjectURL

export class MediaDao {
  async get(fileId: string): Promise<CachedMedia | null> {
    const row = (await tx(STORE_MEDIA, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_MEDIA).get(fileId)),
    )) as Row | undefined;
    if (!row) return null;
    return {
      fileId: row.file_id,
      blob: row.blob,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      cachedAt: row.cached_at,
    };
  }

  // Returns an object-URL ready to drop into `<audio src="...">` /
  // `<img src="...">`. The URL is cached for the lifetime of the page; call
  // `revokeUrl(fileId)` if you want to force a re-fetch from disk.
  async getObjectUrl(fileId: string): Promise<string | null> {
    const existing = objectUrls.get(fileId);
    if (existing) return existing;
    const r = await this.get(fileId);
    if (!r) return null;
    const url = URL.createObjectURL(r.blob);
    objectUrls.set(fileId, url);
    return url;
  }

  revokeUrl(fileId: string): void {
    const u = objectUrls.get(fileId);
    if (u) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
      objectUrls.delete(fileId);
    }
  }

  async put(media: {
    fileId: string;
    blob: Blob;
    mime: string;
  }): Promise<void> {
    const row: Row = {
      file_id: media.fileId,
      blob: media.blob,
      mime: media.mime,
      size_bytes: media.blob.size,
      cached_at: Date.now(),
    };
    await tx(STORE_MEDIA, 'readwrite', (t) => {
      t.objectStore(STORE_MEDIA).put(row);
    });
    // If a URL was already minted for this id, evict it so the next read
    // picks up the new blob.
    this.revokeUrl(media.fileId);
  }

  async delete(fileId: string): Promise<void> {
    await tx(STORE_MEDIA, 'readwrite', (t) => {
      t.objectStore(STORE_MEDIA).delete(fileId);
    });
    this.revokeUrl(fileId);
  }

  // Best-effort LRU. Walks oldest-first and evicts until total cached bytes
  // are under `maxBytes`. Callers can invoke this from an idle hook.
  async evictUntil(maxBytes: number): Promise<void> {
    const rows = (await tx(STORE_MEDIA, 'readonly', (t) =>
      reqToPromise(t.objectStore(STORE_MEDIA).getAll()),
    )) as Row[];
    rows.sort((a, b) => a.cached_at - b.cached_at);
    let total = rows.reduce((a, r) => a + r.size_bytes, 0);
    if (total <= maxBytes) return;
    for (const r of rows) {
      if (total <= maxBytes) break;
      await this.delete(r.file_id);
      total -= r.size_bytes;
    }
  }
}
