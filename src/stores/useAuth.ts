import { useEffect, useSyncExternalStore, useState } from 'react';
import type { User } from '@racass-pixel/quick-protocol';
import { session } from '../api/session';
import { usersClient } from '../api/users';

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
    },
  };
}
