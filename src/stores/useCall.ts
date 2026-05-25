// Call store: drives the lifecycle of a single 1:1 voice/video call.
//
// State machine:
//   idle           — no call.
//   ringing-out    — we initiated; waiting for the peer to accept. We hold a
//                    LiveKit join token already and the Room is connecting in
//                    the background so audio/video flow as soon as the peer
//                    joins.
//   incoming       — the peer is calling us. We have not yet accepted; the
//                    IncomingCallModal is shown and a ring tone plays.
//   active         — both parties are connected to the LiveKit room and media
//                    is flowing.
//
// Signaling envelopes flow over the existing realtime WS hub from S4:
//   incoming_call   — fans out to the callee when the caller hits Start.
//   call_accepted   — fans out to the caller when the callee accepts.
//   call_declined   — fans out to the caller when the callee declines.
//   call_ended      — fans out to the other party when either hangs up.

import { create } from 'zustand';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import type {
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
} from 'livekit-client';

// Discord-Nitro-tier screen share source. Either entry pre-selects a
// different surface in the browser's getDisplayMedia picker.
export type ScreenShareSource = 'monitor' | 'window';
import type { CallJoin } from '@racass-pixel/quick-protocol';
import { callsClient } from '../api/calls';
import type { WsEnvelope } from '../api/ws';

export type CallPeer = {
  id: string;
  displayName: string;
  handle?: string;
  avatarColor?: string;
};

export type CallState =
  | { kind: 'idle' }
  | {
      kind: 'ringing-out';
      callId: string;
      peer: CallPeer;
      join: CallJoin;
      video: boolean;
    }
  | {
      kind: 'incoming';
      callId: string;
      peer: CallPeer;
      video: boolean;
    }
  | {
      kind: 'active';
      callId: string;
      peer: CallPeer;
      join: CallJoin;
      video: boolean;
      startedAt: number;
    };

// Toggle flags live alongside the call state — they only matter when we have a
// Room, but keeping them in the store lets the CallView render their UI
// without poking at the Room directly.
export type CallToggles = {
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
};

type CallStore = {
  state: CallState;
  toggles: CallToggles;
  // Tracks visible to the CallView. Local tracks come from our LocalParticipant
  // publications; remote tracks come from RemoteParticipant subscriptions.
  // The CallView attaches the underlying MediaStreamTracks to <video>/<audio>.
  localCameraTrack: Track | null;
  localScreenTrack: Track | null;
  remoteCameraTrack: RemoteTrack | null;
  remoteScreenTrack: RemoteTrack | null;
  remoteAudioTrack: RemoteTrack | null;

  start(peer: CallPeer, video: boolean): Promise<void>;
  accept(): Promise<void>;
  decline(): Promise<void>;
  end(): Promise<void>;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  startScreenShare(source?: ScreenShareSource): Promise<void>;
  stopScreenShare(): Promise<void>;
  onIncomingCallEnvelope(env: WsEnvelope): void;

  // Test/internal helpers — exposed so the modal can be force-dismissed when
  // the auto-decline timer fires.
  _reset(): void;
};

// Vite-injected URL of the LiveKit signaling server. Falls back to localhost
// so dev works without a custom env file.
const livekitUrlFromEnv =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ??
  'ws://localhost:7880';

// We keep the active Room outside of Zustand state. zustand's shallow compare
// would not catch internal Room mutations anyway, and storing a non-serializable
// object in the store invites devtools serialization warnings.
let activeRoom: Room | null = null;
let incomingTimer: ReturnType<typeof setTimeout> | null = null;
const INCOMING_TTL_MS = 60_000;

function clearIncomingTimer() {
  if (incomingTimer) {
    clearTimeout(incomingTimer);
    incomingTimer = null;
  }
}

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

export const useCall = create<CallStore>((set, get) => {
  // The track-state update helpers below are extracted so the Room event
  // listeners stay readable.
  function attachLocalTracks() {
    if (!activeRoom) return;
    const lp = activeRoom.localParticipant;
    let camera: Track | null = null;
    let screen: Track | null = null;
    lp.trackPublications.forEach((pub: LocalTrackPublication) => {
      const t = pub.track;
      if (!t) return;
      if (pub.source === Track.Source.Camera) camera = t;
      if (pub.source === Track.Source.ScreenShare) screen = t;
    });
    set({ localCameraTrack: camera, localScreenTrack: screen });
  }

  function attachRemoteTracks() {
    if (!activeRoom) return;
    let camera: RemoteTrack | null = null;
    let screen: RemoteTrack | null = null;
    let audio: RemoteTrack | null = null;
    activeRoom.remoteParticipants.forEach((rp: RemoteParticipant) => {
      rp.trackPublications.forEach((pub: RemoteTrackPublication) => {
        const t = pub.track;
        if (!t) return;
        if (pub.source === Track.Source.Camera) camera = t;
        if (pub.source === Track.Source.ScreenShare) screen = t;
        if (pub.source === Track.Source.Microphone) audio = t;
      });
    });
    set({
      remoteCameraTrack: camera,
      remoteScreenTrack: screen,
      remoteAudioTrack: audio,
    });
  }

  async function connectRoom(join: CallJoin, video: boolean) {
    await disposeRoom();
    // Discord-Nitro-class screen share defaults: 12 Mbps / 60 fps ceiling
    // with simulcast layers at 720p (fallback), 1080p, and 2160p (4K). LiveKit
    // adaptively chooses per peer based on bandwidth; the ceiling is what
    // matters for crisp text on a high-DPI monitor.
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

    room.on(RoomEvent.TrackSubscribed, () => attachRemoteTracks());
    room.on(RoomEvent.TrackUnsubscribed, () => attachRemoteTracks());
    room.on(RoomEvent.LocalTrackPublished, () => attachLocalTracks());
    room.on(RoomEvent.LocalTrackUnpublished, () => attachLocalTracks());
    room.on(RoomEvent.ParticipantDisconnected, () => {
      // Peer left for any reason — end the call locally.
      const s = get().state;
      if (s.kind === 'active' || s.kind === 'ringing-out') {
        void get().end();
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      attachRemoteTracks();
      attachLocalTracks();
    });

    // The URL the backend returns wins over the bundled env fallback. Old
    // backends that return an empty string fall back to the env value.
    const url = join.livekitUrl || livekitUrlFromEnv;
    await room.connect(url, join.token);

    // Publish microphone immediately; camera only if this is a video call.
    await room.localParticipant.setMicrophoneEnabled(true);
    if (video) {
      await room.localParticipant.setCameraEnabled(true);
    }
    set({
      toggles: { micOn: true, cameraOn: video, screenShareOn: false },
    });
    attachLocalTracks();
    attachRemoteTracks();
  }

  return {
    state: { kind: 'idle' },
    toggles: { micOn: false, cameraOn: false, screenShareOn: false },
    localCameraTrack: null,
    localScreenTrack: null,
    remoteCameraTrack: null,
    remoteScreenTrack: null,
    remoteAudioTrack: null,

    async start(peer, video) {
      const cur = get().state;
      if (cur.kind !== 'idle') return;
      const res = await callsClient.startCall({ userId: peer.id, video });
      const join = res.join;
      if (!join) throw new Error('startCall: missing join payload');
      set({
        state: {
          kind: 'ringing-out',
          callId: res.callId,
          peer,
          join,
          video,
        },
      });
      // The caller joins the room immediately so the callee hears/sees us as
      // soon as they accept (LiveKit starts negotiating the moment we connect).
      try {
        await connectRoom(join, video);
      } catch (err) {
        // Connection failed — tear down so we don't leak the placeholder call.
        await disposeRoom();
        try {
          await callsClient.endCall({ callId: res.callId });
        } catch {
          /* best effort */
        }
        set({
          state: { kind: 'idle' },
          toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        });
        throw err;
      }
    },

    async accept() {
      const cur = get().state;
      if (cur.kind !== 'incoming') return;
      clearIncomingTimer();
      const res = await callsClient.acceptCall({ callId: cur.callId });
      const join = res.join;
      if (!join) throw new Error('acceptCall: missing join payload');
      set({
        state: {
          kind: 'active',
          callId: cur.callId,
          peer: cur.peer,
          join,
          video: cur.video,
          startedAt: Date.now(),
        },
      });
      try {
        await connectRoom(join, cur.video);
      } catch (err) {
        await disposeRoom();
        try {
          await callsClient.endCall({ callId: cur.callId });
        } catch {
          /* best effort */
        }
        set({
          state: { kind: 'idle' },
          toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        });
        throw err;
      }
    },

    async decline() {
      const cur = get().state;
      if (cur.kind !== 'incoming') return;
      clearIncomingTimer();
      const callId = cur.callId;
      set({ state: { kind: 'idle' } });
      try {
        await callsClient.declineCall({ callId });
      } catch {
        /* best effort */
      }
    },

    async end() {
      const cur = get().state;
      if (cur.kind === 'idle' || cur.kind === 'incoming') {
        // Nothing to end on the wire; just reset local state for safety.
        clearIncomingTimer();
        await disposeRoom();
        set({
          state: { kind: 'idle' },
          toggles: { micOn: false, cameraOn: false, screenShareOn: false },
          localCameraTrack: null,
          localScreenTrack: null,
          remoteCameraTrack: null,
          remoteScreenTrack: null,
          remoteAudioTrack: null,
        });
        return;
      }
      const callId = cur.callId;
      await disposeRoom();
      set({
        state: { kind: 'idle' },
        toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        localCameraTrack: null,
        localScreenTrack: null,
        remoteCameraTrack: null,
        remoteScreenTrack: null,
        remoteAudioTrack: null,
      });
      try {
        await callsClient.endCall({ callId });
      } catch {
        /* best effort */
      }
    },

    async toggleMic() {
      if (!activeRoom) return;
      const next = !get().toggles.micOn;
      await activeRoom.localParticipant.setMicrophoneEnabled(next);
      set((s) => ({ toggles: { ...s.toggles, micOn: next } }));
    },

    async toggleCamera() {
      if (!activeRoom) return;
      const next = !get().toggles.cameraOn;
      await activeRoom.localParticipant.setCameraEnabled(next);
      set((s) => ({ toggles: { ...s.toggles, cameraOn: next } }));
      attachLocalTracks();
    },

    async startScreenShare(source: ScreenShareSource = 'monitor') {
      if (!activeRoom) return;
      if (get().toggles.screenShareOn) return;
      // Base capture options: 4K target resolution, content-hint 'detail' for
      // crisp text, system audio enabled (Chrome screen+tab captures get a
      // mixed audio track), and surfaceSwitching so the user can change source
      // mid-share without renegotiating.
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
        // displaySurface is honored by browsers even when not present in
        // every livekit-client version's ScreenShareCaptureOptions type, so
        // we widen the type via the Record cast above.
        await activeRoom.localParticipant.setScreenShareEnabled(
          true,
          baseOpts as Parameters<
            typeof activeRoom.localParticipant.setScreenShareEnabled
          >[1],
        );
        set((s) => ({ toggles: { ...s.toggles, screenShareOn: true } }));
      } catch {
        // User cancelled the browser picker, or capture failed — stay off.
        set((s) => ({ toggles: { ...s.toggles, screenShareOn: false } }));
      }
      attachLocalTracks();
    },

    async stopScreenShare() {
      if (!activeRoom) return;
      try {
        await activeRoom.localParticipant.setScreenShareEnabled(false);
      } catch {
        /* ignore */
      }
      set((s) => ({ toggles: { ...s.toggles, screenShareOn: false } }));
      attachLocalTracks();
    },

    onIncomingCallEnvelope(env) {
      switch (env.kind) {
        case 'incoming_call': {
          // If we're already in any call state, refuse silently. The backend
          // would normally not fan out a second invite to a user who's mid-call
          // but be defensive.
          if (get().state.kind !== 'idle') return;
          const callId = typeof env.call_id === 'string' ? env.call_id : '';
          const video = env.video === true;
          const caller =
            typeof env.caller_user === 'object' && env.caller_user !== null
              ? (env.caller_user as Record<string, unknown>)
              : {};
          const peer: CallPeer = {
            id:
              (typeof caller.id === 'string' && caller.id) ||
              (typeof env.caller_id === 'string' ? env.caller_id : ''),
            displayName:
              (typeof caller.display_name === 'string' && caller.display_name) ||
              (typeof caller.displayName === 'string' && caller.displayName) ||
              (typeof caller.handle === 'string' ? caller.handle : 'Caller'),
            handle:
              (typeof caller.handle === 'string' && caller.handle) || undefined,
            avatarColor:
              (typeof caller.avatar_color === 'string' && caller.avatar_color) ||
              (typeof caller.avatarColor === 'string' && caller.avatarColor) ||
              undefined,
          };
          if (!callId || !peer.id) return;
          set({
            state: { kind: 'incoming', callId, peer, video },
          });
          clearIncomingTimer();
          incomingTimer = setTimeout(() => {
            const s = get().state;
            if (s.kind === 'incoming' && s.callId === callId) {
              void get().decline();
            }
          }, INCOMING_TTL_MS);
          break;
        }
        case 'call_accepted': {
          // Peer accepted — promote ringing-out to active.
          const cur = get().state;
          if (cur.kind !== 'ringing-out') return;
          const callId = typeof env.call_id === 'string' ? env.call_id : '';
          if (callId !== cur.callId) return;
          set({
            state: {
              kind: 'active',
              callId: cur.callId,
              peer: cur.peer,
              join: cur.join,
              video: cur.video,
              startedAt: Date.now(),
            },
          });
          break;
        }
        case 'call_declined':
        case 'call_ended': {
          const cur = get().state;
          if (cur.kind === 'idle') return;
          const callId = typeof env.call_id === 'string' ? env.call_id : '';
          if (callId && cur.callId !== callId) return;
          clearIncomingTimer();
          void disposeRoom().then(() => {
            set({
              state: { kind: 'idle' },
              toggles: { micOn: false, cameraOn: false, screenShareOn: false },
              localCameraTrack: null,
              localScreenTrack: null,
              remoteCameraTrack: null,
              remoteScreenTrack: null,
              remoteAudioTrack: null,
            });
          });
          break;
        }
        default:
          break;
      }
    },

    _reset() {
      clearIncomingTimer();
      void disposeRoom();
      set({
        state: { kind: 'idle' },
        toggles: { micOn: false, cameraOn: false, screenShareOn: false },
        localCameraTrack: null,
        localScreenTrack: null,
        remoteCameraTrack: null,
        remoteScreenTrack: null,
        remoteAudioTrack: null,
      });
    },
  };
});
