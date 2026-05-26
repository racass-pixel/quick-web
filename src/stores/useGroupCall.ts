// Group call store: Telegram-style voice/video chat for a group or channel.
//
// Compared to 1:1 calls (useCall):
//   - No ring / accept / decline. The conv has an active GroupCall while at
//     least one member is in the room; everyone else sees a banner and joins
//     freely.
//   - State machine collapses to two leaves: `none` (we're not in any group
//     call) and `active` (we're in one). The room can be active on the server
//     even when we're not in it — that lives in `activeByConv` for banner data.
//
// WS envelopes consumed via onWsEnvelope:
//   group_call_started   — { call: GroupCall }                — banner appears
//   group_call_joined    — { call_id, conversation_id,
//                            participant_count }              — bump count
//   group_call_left      — same shape                          — drop count
//   group_call_ended     — { call_id, conversation_id }        — banner gone
//
// Media room config inherits the 1:1 defaults (4K screen share, simulcast,
// dynacast) so screen sharing behaves identically.

import { create } from 'zustand';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import type {
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
} from 'livekit-client';
import type { CallJoin, GroupCall } from '@racass-pixel/quick-protocol';
import { callsClient } from '../api/calls';
import type { WsEnvelope } from '../api/ws';
import type { ScreenShareSource } from './useCall';

// Layouts available in the multi-participant CallView. The default is
// auto-picked from participant count + screen-share presence; the user can
// override via the control bar.
export type CallLayout = 'grid' | 'focused' | 'screen-only' | 'single';

// One published track from one participant, normalised so the gallery can
// render uniformly without poking at LiveKit internals.
export type CallParticipantTile = {
  // Unique key for React. For local: 'local'. For remote: RemoteParticipant.identity.
  participantId: string;
  // Human-readable display name. Falls back to identity for the local case.
  displayName: string;
  isLocal: boolean;
  cameraTrack: Track | RemoteTrack | null;
  screenTrack: Track | RemoteTrack | null;
  // Remote microphone track. Must be attached to a hidden <audio> element by
  // the renderer or the participant is silent — the most common reason a
  // group call "has no sound" is forgetting to plumb this through.
  audioTrack: RemoteTrack | null;
  micActive: boolean;
};

export type GroupCallToggles = {
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
};

export type GroupCallState =
  | { kind: 'none' }
  | {
      kind: 'active';
      callId: string;
      conversationId: string;
      join: CallJoin;
      startedAt: number;
    };

type GroupCallStore = {
  state: GroupCallState;
  toggles: GroupCallToggles;
  // Banner cache keyed by conversation id. Populated by refreshActive() and
  // mutated incrementally by WS envelopes.
  activeByConv: Record<string, GroupCall>;
  // Participants visible to the gallery. Includes the local participant as
  // the first tile.
  participants: CallParticipantTile[];
  // Layout choice. `null` means auto-pick from participant count.
  layout: CallLayout | null;
  focusedParticipantId: string | null;
  // Discord-style minimize: hides the full call UI behind a floating pip
  // while keeping the room connected.
  minimized: boolean;

  minimize(): void;
  expand(): void;

  startGroupCall(convId: string): Promise<void>;
  joinGroupCall(callId: string, convId: string): Promise<void>;
  leaveGroupCall(): Promise<void>;
  endGroupCall(): Promise<void>;
  refreshActive(convIds: string[]): Promise<void>;
  onWsEnvelope(env: WsEnvelope): void;

  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  startScreenShare(source?: ScreenShareSource): Promise<void>;
  stopScreenShare(): Promise<void>;

  setLayout(layout: CallLayout | null): void;
  setFocusedParticipant(id: string | null): void;

  _reset(): void;
};

const livekitUrlFromEnv =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ??
  'ws://localhost:7880';

// Non-serializable Room is held outside of the store to avoid devtools warnings
// and useless React re-renders on internal mutations.
let activeRoom: Room | null = null;

async function disposeRoom() {
  if (!activeRoom) return;
  const r = activeRoom;
  activeRoom = null;
  try {
    await r.disconnect();
  } catch {
    /* ignore */
  }
}

// Pick a sensible default layout from current participant count + presence of
// any screen-share track. Called whenever participants change.
export function pickDefaultLayout(
  participantCount: number,
  hasScreen: boolean,
): CallLayout {
  if (hasScreen) return 'screen-only';
  if (participantCount <= 2) return 'single';
  return 'grid';
}

export const useGroupCall = create<GroupCallStore>((set, get) => {
  // Rebuild the participants array from the live Room and write it to state.
  // Always puts the local participant first so the gallery is stable.
  function refreshParticipants() {
    if (!activeRoom) {
      set({ participants: [] });
      return;
    }

    const tiles: CallParticipantTile[] = [];

    // Local participant.
    const lp = activeRoom.localParticipant;
    let localCamera: Track | null = null;
    let localScreen: Track | null = null;
    lp.trackPublications.forEach((pub: LocalTrackPublication) => {
      const t = pub.track;
      if (!t) return;
      if (pub.source === Track.Source.Camera) localCamera = t;
      if (pub.source === Track.Source.ScreenShare) localScreen = t;
    });
    tiles.push({
      participantId: 'local',
      displayName: lp.name || lp.identity || 'You',
      isLocal: true,
      cameraTrack: localCamera,
      screenTrack: localScreen,
      audioTrack: null,                       // we don't play our own mic back
      micActive: lp.isMicrophoneEnabled,
    });

    // Remote participants — pull audioTrack too so the renderer can attach it
    // to a hidden <audio> element. Without this every group call is silent.
    activeRoom.remoteParticipants.forEach((rp: RemoteParticipant) => {
      let cam: RemoteTrack | null = null;
      let scr: RemoteTrack | null = null;
      let aud: RemoteTrack | null = null;
      let micPub: RemoteTrackPublication | null = null;
      rp.trackPublications.forEach((pub: RemoteTrackPublication) => {
        if (pub.source === Track.Source.Camera) cam = pub.track ?? cam;
        if (pub.source === Track.Source.ScreenShare) scr = pub.track ?? scr;
        if (pub.source === Track.Source.Microphone) {
          micPub = pub;
          aud = pub.track ?? aud;
        }
      });
      tiles.push({
        participantId: rp.identity,
        displayName: rp.name || rp.identity || 'Participant',
        isLocal: false,
        cameraTrack: cam,
        screenTrack: scr,
        audioTrack: aud,
        micActive: !!micPub && !(micPub as RemoteTrackPublication).isMuted,
      });
    });

    set({ participants: tiles });
  }

  async function connectRoom(join: CallJoin) {
    await disposeRoom();
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        screenShareEncoding: {
          maxBitrate: 12_000_000,
          maxFramerate: 60,
        },
        videoSimulcastLayers: [
          VideoPresets.h720,
          VideoPresets.h1080,
          VideoPresets.h2160,
        ],
      },
    });
    activeRoom = room;

    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.TrackMuted, refreshParticipants);
    room.on(RoomEvent.TrackUnmuted, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.Disconnected, () => {
      refreshParticipants();
    });

    const url = join.livekitUrl || livekitUrlFromEnv;
    await room.connect(url, join.token);
    // Voice-chat default: mic on, camera off. Users can toggle either via the
    // control bar; matches the TG model where you "join voice" first and may
    // turn the camera on later.
    await room.localParticipant.setMicrophoneEnabled(true);
    set({
      toggles: { micOn: true, cameraOn: false, screenShareOn: false },
    });
    refreshParticipants();
  }

  return {
    state: { kind: 'none' },
    toggles: { micOn: false, cameraOn: false, screenShareOn: false },
    activeByConv: {},
    participants: [],
    layout: null,
    focusedParticipantId: null,
    minimized: false,

    minimize() {
      set({ minimized: true });
    },
    expand() {
      set({ minimized: false });
    },

    async startGroupCall(convId) {
      if (get().state.kind !== 'none') return;
      const res = await callsClient.startGroupCall({ conversationId: convId });
      const call = res.call;
      const join = res.join;
      if (!call || !join) throw new Error('startGroupCall: missing payload');
      set((s) => ({
        activeByConv: { ...s.activeByConv, [convId]: call },
      }));
      set({
        state: {
          kind: 'active',
          callId: call.id,
          conversationId: convId,
          join,
          startedAt: Date.now(),
        },
      });
      try {
        await connectRoom(join);
      } catch (err) {
        await disposeRoom();
        // Best-effort cleanup so we don't strand an empty room.
        try {
          await callsClient.endGroupCall({ callId: call.id });
        } catch {
          /* ignore */
        }
        set({
          state: { kind: 'none' },
          participants: [],
          toggles: { micOn: false, cameraOn: false, screenShareOn: false },
          minimized: false,
        });
        throw err;
      }
    },

    async joinGroupCall(callId, convId) {
      if (get().state.kind !== 'none') return;
      const res = await callsClient.joinGroupCall({ callId });
      const join = res.join;
      if (!join) throw new Error('joinGroupCall: missing join payload');
      set({
        state: {
          kind: 'active',
          callId,
          conversationId: convId,
          join,
          startedAt: Date.now(),
        },
      });
      try {
        await connectRoom(join);
      } catch (err) {
        await disposeRoom();
        set({
          state: { kind: 'none' },
          participants: [],
          toggles: { micOn: false, cameraOn: false, screenShareOn: false },
          minimized: false,
        });
        throw err;
      }
    },

    async leaveGroupCall() {
      const cur = get().state;
      if (cur.kind !== 'active') return;
      const callId = cur.callId;
      await disposeRoom();
      set({
        state: { kind: 'none' },
        participants: [],
        toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        layout: null,
        focusedParticipantId: null,
        minimized: false,
      });
      try {
        await callsClient.leaveGroupCall({ callId });
      } catch {
        /* best effort */
      }
    },

    async endGroupCall() {
      // Owner/admin-only force-end. We still call leave locally first.
      const cur = get().state;
      if (cur.kind !== 'active') return;
      const callId = cur.callId;
      await disposeRoom();
      set({
        state: { kind: 'none' },
        participants: [],
        toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        layout: null,
        focusedParticipantId: null,
        minimized: false,
      });
      try {
        await callsClient.endGroupCall({ callId });
      } catch {
        /* best effort */
      }
    },

    async refreshActive(convIds) {
      if (convIds.length === 0) return;
      try {
        const r = await callsClient.listActiveGroupCalls({
          conversationIds: convIds,
        });
        set((s) => {
          const next = { ...s.activeByConv };
          // Drop any stale entries for the queried convs, then merge in fresh.
          for (const id of convIds) delete next[id];
          for (const c of r.calls ?? []) {
            if (c.conversationId) next[c.conversationId] = c;
          }
          return { activeByConv: next };
        });
      } catch {
        /* swallow — banner will retry on next conv open */
      }
    },

    onWsEnvelope(env) {
      switch (env.kind) {
        case 'group_call_started': {
          // Backend may send the call object snake-cased; pull both shapes.
          const callRaw =
            (typeof env.call === 'object' && env.call !== null
              ? (env.call as Record<string, unknown>)
              : null) ?? null;
          if (!callRaw) return;
          const convId =
            (typeof callRaw.conversation_id === 'string' && callRaw.conversation_id) ||
            (typeof callRaw.conversationId === 'string' && callRaw.conversationId) ||
            '';
          const id =
            (typeof callRaw.id === 'string' && callRaw.id) || '';
          if (!convId || !id) return;
          const startedBy =
            (typeof callRaw.started_by === 'string' && callRaw.started_by) ||
            (typeof callRaw.startedBy === 'string' && callRaw.startedBy) ||
            '';
          const roomName =
            (typeof callRaw.room_name === 'string' && callRaw.room_name) ||
            (typeof callRaw.roomName === 'string' && callRaw.roomName) ||
            '';
          const participantCount =
            (typeof callRaw.participant_count === 'number' && callRaw.participant_count) ||
            (typeof callRaw.participantCount === 'number' && callRaw.participantCount) ||
            0;
          const call = {
            $typeName: 'quick.v1.GroupCall',
            id,
            conversationId: convId,
            startedBy,
            roomName,
            participantCount,
            startedAt: undefined,
          } as unknown as GroupCall;
          set((s) => ({
            activeByConv: { ...s.activeByConv, [convId]: call },
          }));
          break;
        }
        case 'group_call_joined':
        case 'group_call_left': {
          const callId =
            (typeof env.call_id === 'string' && env.call_id) ||
            (typeof env.callId === 'string' && env.callId) ||
            '';
          const convId =
            (typeof env.conversation_id === 'string' && env.conversation_id) ||
            (typeof env.conversationId === 'string' && env.conversationId) ||
            '';
          const count =
            (typeof env.participant_count === 'number' && env.participant_count) ||
            (typeof env.participantCount === 'number' && env.participantCount) ||
            null;
          if (!convId) return;
          set((s) => {
            const existing = s.activeByConv[convId];
            if (!existing) return {};
            // Sanity: if server tells us about a different call id, prefer the
            // server-current one — drop the old.
            if (callId && existing.id !== callId) return {};
            const next = {
              ...existing,
              participantCount:
                count != null
                  ? count
                  : env.kind === 'group_call_joined'
                    ? existing.participantCount + 1
                    : Math.max(0, existing.participantCount - 1),
            };
            return { activeByConv: { ...s.activeByConv, [convId]: next } };
          });
          break;
        }
        case 'group_call_ended': {
          const convId =
            (typeof env.conversation_id === 'string' && env.conversation_id) ||
            (typeof env.conversationId === 'string' && env.conversationId) ||
            '';
          const callId =
            (typeof env.call_id === 'string' && env.call_id) ||
            (typeof env.callId === 'string' && env.callId) ||
            '';
          if (!convId) return;
          set((s) => {
            const existing = s.activeByConv[convId];
            const next = { ...s.activeByConv };
            if (existing && (!callId || existing.id === callId)) {
              delete next[convId];
            }
            return { activeByConv: next };
          });
          // If we're in this call, tear our local session down too.
          const cur = get().state;
          if (
            cur.kind === 'active' &&
            cur.conversationId === convId &&
            (!callId || cur.callId === callId)
          ) {
            void disposeRoom().then(() => {
              set({
                state: { kind: 'none' },
                participants: [],
                toggles: { micOn: false, cameraOn: false, screenShareOn: false },
                layout: null,
                focusedParticipantId: null,
                minimized: false,
              });
            });
          }
          break;
        }
        default:
          break;
      }
    },

    async toggleMic() {
      if (!activeRoom) return;
      const next = !get().toggles.micOn;
      await activeRoom.localParticipant.setMicrophoneEnabled(next);
      set((s) => ({ toggles: { ...s.toggles, micOn: next } }));
      refreshParticipants();
    },

    async toggleCamera() {
      if (!activeRoom) return;
      const next = !get().toggles.cameraOn;
      await activeRoom.localParticipant.setCameraEnabled(next);
      set((s) => ({ toggles: { ...s.toggles, cameraOn: next } }));
      refreshParticipants();
    },

    async startScreenShare(source: ScreenShareSource = 'monitor') {
      if (!activeRoom) return;
      if (get().toggles.screenShareOn) return;
      const baseOpts: Record<string, unknown> = {
        resolution: { width: 3840, height: 2160 },
        contentHint: 'detail',
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        preferCurrentTab: false,
        displaySurface: source,
      };
      try {
        await activeRoom.localParticipant.setScreenShareEnabled(
          true,
          baseOpts as Parameters<
            typeof activeRoom.localParticipant.setScreenShareEnabled
          >[1],
        );
        set((s) => ({ toggles: { ...s.toggles, screenShareOn: true } }));
      } catch {
        set((s) => ({ toggles: { ...s.toggles, screenShareOn: false } }));
      }
      refreshParticipants();
    },

    async stopScreenShare() {
      if (!activeRoom) return;
      try {
        await activeRoom.localParticipant.setScreenShareEnabled(false);
      } catch {
        /* ignore */
      }
      set((s) => ({ toggles: { ...s.toggles, screenShareOn: false } }));
      refreshParticipants();
    },

    setLayout(layout) {
      set({ layout });
    },

    setFocusedParticipant(id) {
      set({ focusedParticipantId: id, layout: id ? 'focused' : get().layout });
    },

    _reset() {
      void disposeRoom();
      set({
        state: { kind: 'none' },
        participants: [],
        toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        activeByConv: {},
        layout: null,
        focusedParticipantId: null,
        minimized: false,
      });
    },
  };
});
