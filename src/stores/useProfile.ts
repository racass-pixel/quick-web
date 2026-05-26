// Profile modal store: exposed globally so any avatar in the app can open
// the same TG-style ProfileModal overlay without a prop drill.

import { create } from 'zustand';
import type { User } from '@racass-pixel/quick-protocol';

// Lite-shape used by callers that don't have a full User (e.g. messages
// arriving via WS only carry id/handle/displayName/avatarColor). The modal
// normalizes this to a User-like object for rendering.
export type ProfileUserLite = {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
};

type ProfileState = {
  user: ProfileUserLite | null;
  open(u: User): void;
  openLite(u: ProfileUserLite): void;
  close(): void;
};

export const useProfile = create<ProfileState>((set) => ({
  user: null,
  open(u) {
    set({
      user: {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        avatarColor: u.avatarColor,
      },
    });
  },
  openLite(u) {
    set({ user: u });
  },
  close() {
    set({ user: null });
  },
}));
