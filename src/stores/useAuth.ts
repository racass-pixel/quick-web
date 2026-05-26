import { useEffect, useSyncExternalStore, useState } from 'react';
import type { User } from '@racass-pixel/quick-protocol';
import { session } from '../api/session';
import { usersClient } from '../api/users';
import { LocalStore } from '../store';
import { ensureIdentityKey, resetConvKeyCache } from '../crypto/convKeys';

// Module-level cache so a remount after the first /me call avoids a flash.
// undefined = not yet resolved, null = confirmed anonymous, User = signed in.
let cachedUser: User | null | undefined = undefined;

export function setCachedUser(u: User | null | undefined) {
  cachedUser = u;
}

export function useAuth() {
  const token = useSyncExternalStore(
    session.subscribe,
    () => session.token,
    () => null,
  );
  const [user, setUser] = useState<User | null | undefined>(
    token ? cachedUser : null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      cachedUser = null;
      setUser(null);
      return;
    }
    // Open the tdata local store before we touch network. Best-effort —
    // failures (no SubtleCrypto, no IndexedDB) leave the store closed and
    // the rest of the app keeps working off network state.
    void LocalStore.boot(token).catch(() => {
      /* swallow */
    });
    if (cachedUser && (cachedUser as User).id) {
      setUser(cachedUser);
      return;
    }
    setUser(undefined);
    usersClient
      .me({})
      .then((r) => {
        if (cancelled) return;
        const u = r.user ?? null;
        cachedUser = u;
        setUser(u);
        // Generate the device's E2E identity keypair on first run and
        // upload the public half. Best-effort — failure just means the
        // session uses plaintext until it succeeds on a later boot.
        if (u && u.id) {
          void ensureIdentityKey(u.id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        session.setToken(null);
        cachedUser = null;
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    user,
    isLoading: user === undefined,
    signOut: () => {
      cachedUser = null;
      session.setToken(null);
      // Best-effort wipe of the on-disk cache on explicit sign-out.
      void LocalStore.wipe().catch(() => {
        /* swallow */
      });
      // Drop derived conv keys; keep the identity keypair on disk so anyone
      // who already cached the public half stays able to write to us.
      resetConvKeyCache(null);
    },
  };
}
