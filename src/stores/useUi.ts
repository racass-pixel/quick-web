// UI shell store: tracks transient sidebar drawer + settings panel state.
// Kept separate from chat/auth stores so any descendant of the sidebar can
// toggle the drawer without prop-drilling.

import { create } from 'zustand';

type UiState = {
  sidebarMenuOpen: boolean;
  settingsPanelOpen: boolean;
  openSidebarMenu(): void;
  closeSidebarMenu(): void;
  openSettings(): void;
  closeSettings(): void;
};

export const useUi = create<UiState>((set) => ({
  sidebarMenuOpen: false,
  settingsPanelOpen: false,
  openSidebarMenu: () => set({ sidebarMenuOpen: true }),
  closeSidebarMenu: () => set({ sidebarMenuOpen: false }),
  openSettings: () => set({ settingsPanelOpen: true, sidebarMenuOpen: false }),
  closeSettings: () => set({ settingsPanelOpen: false }),
}));
