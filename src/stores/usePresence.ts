// usePresence — subscribe a single peer's presence (online + last-seen).
//
// Behaviour:
//   - On mount, immediately fetches presence for `userId` and sets state.
//   - Polls every 30s thereafter, refreshing the cache.
//   - Reference-counts active subscribers: when the last component unmounts
//     for a given userId, its interval is cleared so we don't keep polling
//     stale peers forever.
//
// State is shared across components for the same userId via a module-level
// cache, so opening two views of the same peer doesn't double the RPCs.

import { useEffect, useState } from 'react';
import { usersClient } from '../api/users';

export type Presence = {
  userId: string;
  online: boolean;
  lastSeenAt: number; // ms since epoch; 0 if unknown
};

const cache = new Map<string, Presence>();
const refs = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
// One Set per userId to notify subscribers of cache updates.
const listeners = new Map<string, Set<(p: Presence) => void>>();

const POLL_MS = 30_000;

async function fetchOne(userId: string): Promise<Presence> {
  try {
    const res = await usersClient.getPresence({ userIds: [userId] });
    const hit = res.presence.find((p) => p.userId === userId);
    if (!hit) {
      return { userId, online: false, lastSeenAt: 0 };
    }
    const ts = hit.lastSeenAt;
    const ms = ts ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000) : 0;
    return { userId, online: hit.online, lastSeenAt: ms };
  } catch {
    // Network errors are silent — we just return a "no data" record so the
    // UI can fall back to "last seen recently".
    return { userId, online: false, lastSeenAt: 0 };
  }
}

function emit(p: Presence) {
  cache.set(p.userId, p);
  const subs = listeners.get(p.userId);
  if (subs) for (const fn of subs) fn(p);
}

function startPolling(userId: string) {
  if (timers.has(userId)) return;
  // Fire once immediately so the first paint has data.
  void fetchOne(userId).then(emit);
  const id = setInterval(() => {
    void fetchOne(userId).then(emit);
  }, POLL_MS);
  timers.set(userId, id);
}

function stopPolling(userId: string) {
  const id = timers.get(userId);
  if (id) {
    clearInterval(id);
    timers.delete(userId);
  }
}

export function usePresence(userId: string | undefined): Presence | undefined {
  const [state, setState] = useState<Presence | undefined>(() =>
    userId ? cache.get(userId) : undefined,
  );

  useEffect(() => {
    if (!userId) return;
    refs.set(userId, (refs.get(userId) ?? 0) + 1);

    let subs = listeners.get(userId);
    if (!subs) {
      subs = new Set();
      listeners.set(userId, subs);
    }
    const onUpdate = (p: Presence) => setState(p);
    subs.add(onUpdate);

    if ((refs.get(userId) ?? 0) === 1) {
      startPolling(userId);
    } else {
      // Already polling — push the latest cached value if present.
      const cached = cache.get(userId);
      if (cached) setState(cached);
    }

    return () => {
      const next = (refs.get(userId) ?? 1) - 1;
      if (next <= 0) {
        refs.delete(userId);
        stopPolling(userId);
      } else {
        refs.set(userId, next);
      }
      const set = listeners.get(userId);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) listeners.delete(userId);
      }
    };
  }, [userId]);

  return state;
}

// Format a presence as the short status line used under the peer name.
export function formatPresence(p: Presence | undefined): string {
  if (!p) return 'last seen recently';
  if (p.online) return 'online';
  if (!p.lastSeenAt) return 'last seen recently';
  const diff = Date.now() - p.lastSeenAt;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'last seen just now';
  if (min < 60) return `last seen ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `last seen ${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `last seen ${d}d ago`;
  return `last seen ${new Date(p.lastSeenAt).toLocaleDateString()}`;
}
