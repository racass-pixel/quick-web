// Full-screen overlay rendered when any call is active. Drives both 1:1
// (useCall) and group (useGroupCall) sessions through a shared gallery + 4
// layout modes:
//
//   single       — one big tile (active speaker or focused). Default for 1-2
//                  participants when no screen share is active.
//   grid         — equal NxM tiles. Default for 3+ participants.
//   focused      — one big tile + a vertical strip of the others. Triggered
//                  by clicking a tile.
//   screen-only  — full-bleed screen-share track + a bottom strip of camera
//                  tiles. Default whenever any participant is sharing.
//
// The view never sets video src directly — it attaches the underlying LiveKit
// Track to a <video>/<audio> element via the imperative track.attach() API.

import { useEffect, useRef, useState } from 'react';
import type { Track as TrackType } from 'livekit-client';
import {
  AppWindow,
  LayoutDashboard,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Monitor,
  Phone,
  User,
  Users,
} from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { useCall } from '../../stores/useCall';
import {
  pickDefaultLayout,
  useGroupCall,
  type CallLayout,
  type CallParticipantTile,
} from '../../stores/useGroupCall';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// Hook: attach a LiveKit track to a media element and detach on unmount or
// when the track identity changes.
function useAttached<E extends HTMLMediaElement>(track: TrackType | null) {
  const ref = useRef<E | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      try {
        track.detach(el);
      } catch {
        /* ignore */
      }
    };
  }, [track]);
  return ref;
}

export function CallView() {
  // Pull the current state of both stores. One of them is non-idle at a time
  // (the call buttons enforce this) — we route the render accordingly.
  const oneToOneState = useCall((s) => s.state);
  const groupState = useGroupCall((s) => s.state);
  // Discord-style minimize: when true we render the floating pip alongside
  // the (hidden) full overlay, so the underlying LiveKit Room stays
  // connected and audio keeps flowing while the user navigates chats.
  const oneMinimized = useCall((s) => s.minimized);
  const groupMinimized = useGroupCall((s) => s.minimized);

  const groupActive = groupState.kind === 'active';
  const oneActive =
    oneToOneState.kind === 'active' || oneToOneState.kind === 'ringing-out';

  if (groupActive) return <GroupCallStage minimized={groupMinimized} />;
  if (oneActive) return <OneToOneCallStage minimized={oneMinimized} />;
  return null;
}

// --- 1:1 call view: collapses the gallery to two tiles (local + peer) and
// drives the same layout state as the group case so the control bar feels
// identical. The 1:1 case has no list of participants — we synthesise two
// tiles from the per-track refs already exposed by useCall.

function OneToOneCallStage({ minimized }: { minimized: boolean }) {
  const state = useCall((s) => s.state);
  const toggles = useCall((s) => s.toggles);
  const layout = useCall((s) => s.layout);
  const setLayout = useCall((s) => s.setLayout);

  const toggleMic = useCall((s) => s.toggleMic);
  const toggleCamera = useCall((s) => s.toggleCamera);
  const startScreenShare = useCall((s) => s.startScreenShare);
  const stopScreenShare = useCall((s) => s.stopScreenShare);
  const minimize = useCall((s) => s.minimize);
  const expand = useCall((s) => s.expand);
  const end = useCall((s) => s.end);

  const localCameraTrack = useCall((s) => s.localCameraTrack);
  const localScreenTrack = useCall((s) => s.localScreenTrack);
  const remoteCameraTrack = useCall((s) => s.remoteCameraTrack);
  const remoteScreenTrack = useCall((s) => s.remoteScreenTrack);
  const remoteAudioTrack = useCall((s) => s.remoteAudioTrack);
  const remoteScreenAudioTrack = useCall((s) => s.remoteScreenAudioTrack);

  const remoteAudioRef = useAttached<HTMLAudioElement>(remoteAudioTrack);
  const remoteScreenAudioRef = useAttached<HTMLAudioElement>(
    remoteScreenAudioTrack,
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.kind !== 'active' && state.kind !== 'ringing-out') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  if (state.kind !== 'active' && state.kind !== 'ringing-out') return null;

  const peer = state.peer;
  const isActive = state.kind === 'active';
  const startedAt = isActive ? state.startedAt : now;
  const elapsed = isActive ? formatElapsed(now - startedAt) : '00:00';

  // Synthesise two tiles for the unified gallery.
  // The 1:1 store doesn't track LiveKit identities directly, so the local
  // tile gets the empty key (the active-speaker hook short-circuits on empty)
  // and the remote tile reuses the peer id, which the backend mints LiveKit
  // identities from on join. If identities ever drift from user ids the
  // speaker ring will simply not light up — never a runtime error.
  const tiles: CallParticipantTile[] = [
    {
      participantId: 'local',
      speakerIdentity: '',
      displayName: 'You',
      isLocal: true,
      cameraTrack: toggles.cameraOn ? localCameraTrack : null,
      screenTrack: localScreenTrack,
      audioTrack: null, // we don't play our own mic back
      screenAudioTrack: null, // local screen-share audio bypasses the mixer
      micActive: toggles.micOn,
    },
    {
      participantId: 'remote',
      speakerIdentity: peer.id,
      displayName: peer.displayName,
      isLocal: false,
      cameraTrack: remoteCameraTrack,
      screenTrack: remoteScreenTrack,
      // 1:1 still uses the dedicated <audio> outside the tile (below) so
      // we set null here to avoid double-attaching the same track. Group
      // calls populate this field from the participant publication.
      audioTrack: null,
      screenAudioTrack: null,
      micActive: !!remoteAudioTrack,
    },
  ];

  const hasScreen = !!(localScreenTrack || remoteScreenTrack);
  const resolvedLayout: CallLayout = layout ?? pickDefaultLayout(2, hasScreen);

  return (
    <>
      <CallShell
        headerKicker={`${isActive ? 'IN CALL' : 'CALLING'} · ${state.video ? 'VIDEO' : 'AUDIO'}`}
        headerTitle={peer.displayName}
        elapsed={elapsed}
        tiles={tiles}
        avatarFallback={
          <div className="flex flex-col items-center">
            <Avatar
              displayName={peer.displayName}
              color={peer.avatarColor ?? ''}
              size={160}
            />
            <div className="mt-6 text-ink-2 text-sm">
              {isActive ? 'Connected' : 'Ringing…'}
            </div>
          </div>
        }
        layout={resolvedLayout}
        onLayoutChange={setLayout}
        hasScreen={hasScreen}
        micOn={toggles.micOn}
        cameraOn={toggles.cameraOn}
        screenShareOn={toggles.screenShareOn}
        onToggleMic={() => void toggleMic()}
        onToggleCamera={() => void toggleCamera()}
        onStartScreenShare={(src) => void startScreenShare(src)}
        onStopScreenShare={() => void stopScreenShare()}
        onMinimize={minimize}
        onHangup={() => void end()}
        hangupLabel="Hang up"
        minimized={minimized}
      >
        {/* Remote mic + screen-share audio attached to hidden <audio>s. Both
            live INSIDE the (possibly hidden) shell so audio keeps flowing
            while the user is browsing other chats and so the peer's shared-
            screen system audio is audible alongside their voice. */}
        <audio ref={remoteAudioRef} autoPlay playsInline />
        <audio ref={remoteScreenAudioRef} autoPlay playsInline />
      </CallShell>
      {minimized && (
        <CallPip
          title={peer.displayName}
          elapsed={elapsed}
          group={false}
          avatarNode={
            <Avatar
              displayName={peer.displayName}
              color={peer.avatarColor ?? ''}
              size={40}
            />
          }
          onExpand={expand}
          onEnd={() => void end()}
        />
      )}
    </>
  );
}

// --- Group call view: pulls the full participant list from useGroupCall and
// renders the gallery according to the chosen / default layout.

function GroupCallStage({ minimized }: { minimized: boolean }) {
  const state = useGroupCall((s) => s.state);
  const toggles = useGroupCall((s) => s.toggles);
  const layoutOverride = useGroupCall((s) => s.layout);
  const setLayout = useGroupCall((s) => s.setLayout);
  const participants = useGroupCall((s) => s.participants);

  const toggleMic = useGroupCall((s) => s.toggleMic);
  const toggleCamera = useGroupCall((s) => s.toggleCamera);
  const startScreenShare = useGroupCall((s) => s.startScreenShare);
  const stopScreenShare = useGroupCall((s) => s.stopScreenShare);
  const leave = useGroupCall((s) => s.leaveGroupCall);
  const minimize = useGroupCall((s) => s.minimize);
  const expand = useGroupCall((s) => s.expand);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.kind !== 'active') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  if (state.kind !== 'active') return null;

  const startedAt = state.startedAt;
  const elapsed = formatElapsed(now - startedAt);
  const count = participants.length;
  const hasScreen = participants.some((p) => !!p.screenTrack);
  const resolvedLayout: CallLayout =
    layoutOverride ?? pickDefaultLayout(count, hasScreen);

  return (
    <>
      <CallShell
        headerKicker={`VOICE CHAT · ${count} ${count === 1 ? 'PARTICIPANT' : 'PARTICIPANTS'}`}
        headerTitle="Group call"
        elapsed={elapsed}
        tiles={participants}
        avatarFallback={
          <div className="flex flex-col items-center">
            <div className="w-40 h-40 rounded-full bg-raised border border-line flex items-center justify-center text-ink-3">
              <User size={64} strokeWidth={1.25} />
            </div>
            <div className="mt-6 text-ink-2 text-sm">Voice chat</div>
          </div>
        }
        layout={resolvedLayout}
        onLayoutChange={setLayout}
        hasScreen={hasScreen}
        micOn={toggles.micOn}
        cameraOn={toggles.cameraOn}
        screenShareOn={toggles.screenShareOn}
        onToggleMic={() => void toggleMic()}
        onToggleCamera={() => void toggleCamera()}
        onStartScreenShare={(src) => void startScreenShare(src)}
        onStopScreenShare={() => void stopScreenShare()}
        onMinimize={minimize}
        onHangup={() => void leave()}
        hangupLabel="Leave call"
        minimized={minimized}
      />
      {minimized && (
        <CallPip
          title="Group call"
          elapsed={elapsed}
          group
          avatarNode={
            <div className="w-10 h-10 rounded-full bg-raised border border-line flex items-center justify-center text-ink-2">
              <Users size={18} strokeWidth={1.75} />
            </div>
          }
          onExpand={expand}
          onEnd={() => void leave()}
        />
      )}
    </>
  );
}

// --- Shared shell: header + stage + control bar. Stage routing happens inside
// CallStage based on the chosen layout.

type CallShellProps = {
  headerKicker: string;
  headerTitle: string;
  elapsed: string;
  tiles: CallParticipantTile[];
  // Fallback rendered in single/focused layouts when the focused tile has no
  // camera or screen track (audio-only or hasn't published video yet).
  avatarFallback: React.ReactNode;
  layout: CallLayout;
  onLayoutChange(layout: CallLayout | null): void;
  hasScreen: boolean;
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
  onToggleMic(): void;
  onToggleCamera(): void;
  onStartScreenShare(source: 'monitor' | 'window'): void;
  onStopScreenShare(): void;
  onMinimize(): void;
  onHangup(): void;
  hangupLabel: string;
  // When true the shell is hidden via CSS (not unmounted) so the LiveKit
  // Room and the hidden audio elements stay alive while the user works in
  // the rest of the app. Unmounting would tear down media tracks.
  minimized: boolean;
  children?: React.ReactNode;
};

function CallShell(p: CallShellProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Decide which tile is "focused" in single / focused / screen-only layouts.
  // Picking is deterministic: user choice wins, otherwise the first non-local
  // tile (or local as the fallback when the user is alone).
  const focused =
    p.tiles.find((t) => t.participantId === focusedId) ??
    p.tiles.find((t) => !t.isLocal) ??
    p.tiles[0];

  function focus(id: string) {
    setFocusedId(id);
    p.onLayoutChange('focused');
  }

  // Hide-via-CSS so the Room stays connected behind the floating pip. We
  // also drop pointer events / aria visibility so screen readers and focus
  // don't reach the offscreen control bar.
  const hiddenCls = p.minimized
    ? 'opacity-0 pointer-events-none invisible'
    : '';

  return (
    <div
      className={
        'fixed inset-0 z-40 bg-black text-ink-1 flex flex-col ' + hiddenCls
      }
      aria-hidden={p.minimized || undefined}
    >
      {p.children}

      {/* Audio mixer — one hidden <audio> per participant with a remote mic
          track. Lives at the shell level so it stays mounted across layout
          changes; otherwise switching to single/screen-only would unmount
          off-screen tiles and silence them. */}
      <AudioMixer tiles={p.tiles} />

      <header className="px-6 py-4 flex items-center justify-between">
        <div>
          <Kicker className="mb-1">{p.headerKicker}</Kicker>
          <div className="text-ink-1 text-base">{p.headerTitle}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-ink-2 text-sm tabular-nums">
            {p.elapsed}
          </div>
          <button
            type="button"
            onClick={p.onMinimize}
            aria-label="Minimize call"
            title="Minimize call"
            className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors"
          >
            <Minimize2 size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex-1 relative min-h-0">
        <CallStage
          layout={p.layout}
          tiles={p.tiles}
          focused={focused}
          fallback={p.avatarFallback}
          onTileClick={focus}
        />
      </div>

      <div className="px-6 py-6 flex items-center justify-center gap-4">
        <CallControl
          label={p.micOn ? 'Mute' : 'Unmute'}
          icon={p.micOn ? <MicOnIcon /> : <MicOffIcon />}
          active={p.micOn}
          onClick={p.onToggleMic}
        />
        <CallControl
          label={p.cameraOn ? 'Camera off' : 'Camera on'}
          icon={p.cameraOn ? <CamOnIcon /> : <CamOffIcon />}
          active={p.cameraOn}
          onClick={p.onToggleCamera}
        />
        <CallControl
          label={p.screenShareOn ? 'Stop sharing screen' : 'Share screen with sound'}
          icon={<Monitor size={20} strokeWidth={1.75} />}
          active={p.screenShareOn}
          onClick={() => {
            if (p.screenShareOn) p.onStopScreenShare();
            else p.onStartScreenShare('monitor');
          }}
        />
        <CallControl
          label={p.screenShareOn ? 'Stop sharing window' : 'Share window with sound'}
          icon={<AppWindow size={20} strokeWidth={1.75} />}
          active={p.screenShareOn}
          onClick={() => {
            if (p.screenShareOn) p.onStopScreenShare();
            else p.onStartScreenShare('window');
          }}
        />

        {/* Layout toggles. Auto-pick when nothing else is selected. */}
        <span className="mx-1 h-8 w-px bg-line" aria-hidden />
        <CallControl
          label="Grid layout"
          icon={<LayoutGrid size={20} strokeWidth={1.75} />}
          active={p.layout === 'grid'}
          onClick={() => p.onLayoutChange(p.layout === 'grid' ? null : 'grid')}
        />
        <CallControl
          label="Focused layout"
          icon={<LayoutDashboard size={20} strokeWidth={1.75} />}
          active={p.layout === 'focused'}
          onClick={() =>
            p.onLayoutChange(p.layout === 'focused' ? null : 'focused')
          }
        />
        <CallControl
          label="Expand screen share"
          icon={<Maximize2 size={20} strokeWidth={1.75} />}
          active={p.layout === 'screen-only'}
          tint={p.hasScreen ? 'ember' : undefined}
          disabled={!p.hasScreen}
          onClick={() =>
            p.onLayoutChange(p.layout === 'screen-only' ? null : 'screen-only')
          }
        />

        <button
          type="button"
          onClick={p.onHangup}
          aria-label={p.hangupLabel}
          title={p.hangupLabel}
          className="w-14 h-14 rounded-full bg-err text-bg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <HangupIcon />
        </button>
      </div>
    </div>
  );
}

// --- Stage renderer: per-layout composition over the same set of tiles.

type StageProps = {
  layout: CallLayout;
  tiles: CallParticipantTile[];
  focused: CallParticipantTile | undefined;
  fallback: React.ReactNode;
  onTileClick(id: string): void;
};

function CallStage({ layout, tiles, focused, fallback, onTileClick }: StageProps) {
  // Find any screen-share track for screen-only layout. Prefer remote over
  // local so the sharer's own preview stays in the strip rather than dominating.
  const screenTile = tiles.find((t) => !t.isLocal && t.screenTrack)
    ?? tiles.find((t) => t.screenTrack);

  if (layout === 'screen-only' && screenTile?.screenTrack) {
    const stripTiles = tiles;
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black">
          <TrackVideo track={screenTile.screenTrack} fit="contain" />
        </div>
        <div className="shrink-0 border-t border-line bg-bg overflow-x-auto">
          <div className="flex gap-2 p-2">
            {stripTiles.map((t) => (
              <button
                type="button"
                key={t.participantId}
                onClick={() => onTileClick(t.participantId)}
                className="w-32 h-20 shrink-0 rounded-lg overflow-hidden border border-line bg-raised relative focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <ParticipantTileInner tile={t} compact />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (layout === 'grid') {
    const n = tiles.length;
    // Pick a column count that keeps tiles roughly square as N grows.
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    return (
      <div className="absolute inset-0 p-3">
        <div
          className="w-full h-full grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: '1fr',
          }}
        >
          {tiles.map((t) => (
            <button
              type="button"
              key={t.participantId}
              onClick={() => onTileClick(t.participantId)}
              className="relative overflow-hidden rounded-lg border border-line bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <ParticipantTileInner tile={t} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (layout === 'focused' && focused) {
    const others = tiles.filter((t) => t.participantId !== focused.participantId);
    return (
      <div className="absolute inset-0 flex">
        <div className="flex-1 min-w-0 flex items-center justify-center bg-black relative">
          <FocusedBody tile={focused} fallback={fallback} />
        </div>
        {others.length > 0 && (
          <div className="w-[200px] shrink-0 border-l border-line bg-bg overflow-y-auto">
            <div className="flex flex-col gap-2 p-2">
              {others.map((t) => (
                <button
                  type="button"
                  key={t.participantId}
                  onClick={() => onTileClick(t.participantId)}
                  className="w-full aspect-video rounded-lg overflow-hidden border border-line bg-raised relative focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  <ParticipantTileInner tile={t} compact />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Single (default) — one big tile (active speaker / focused) full-bleed,
  // with the local participant tucked into a PIP if they aren't the focus.
  if (focused) {
    const localTile = tiles.find((t) => t.isLocal);
    const showLocalPip = !!localTile && !focused.isLocal && !!localTile.cameraTrack;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <FocusedBody tile={focused} fallback={fallback} />
        {showLocalPip && localTile && (
          <div className="absolute top-4 right-4 w-32 h-24 rounded-lg overflow-hidden border border-line bg-black">
            <ParticipantTileInner tile={localTile} compact muteOverlay />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {fallback}
    </div>
  );
}

function FocusedBody({
  tile,
  fallback,
}: {
  tile: CallParticipantTile;
  fallback: React.ReactNode;
}) {
  // Screen share wins over camera for the focused tile.
  if (tile.screenTrack) {
    return <TrackVideo track={tile.screenTrack} fit="contain" />;
  }
  if (tile.cameraTrack) {
    return <TrackVideo track={tile.cameraTrack} fit="contain" muted={tile.isLocal} />;
  }
  return <>{fallback}</>;
}

// --- Per-tile body. Compact mode strips the name overlay so the strip stays
// information-dense.

// Subscribe to active-speaker sets from both stores. At any moment only one
// of them holds a non-empty set (the user is in either a 1:1 or a group
// call, never both), so a union is safe and avoids threading the result
// down through every layout branch.
function useIsSpeaking(identity: string): boolean {
  const fromOne = useCall((s) =>
    identity ? s.activeSpeakerIds.has(identity) : false,
  );
  const fromGroup = useGroupCall((s) =>
    identity ? s.activeSpeakerIds.has(identity) : false,
  );
  return fromOne || fromGroup;
}

function ParticipantTileInner({
  tile,
  compact = false,
  muteOverlay = false,
}: {
  tile: CallParticipantTile;
  compact?: boolean;
  muteOverlay?: boolean;
}) {
  const track = tile.cameraTrack ?? tile.screenTrack;
  const speaking = useIsSpeaking(tile.speakerIdentity);
  return (
    <div className="absolute inset-0">
      {track ? (
        <TrackVideo track={track} fit="cover" muted={tile.isLocal} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-raised">
          <div className="text-ink-3">
            <Avatar
              displayName={tile.displayName}
              color=""
              size={compact ? 36 : 72}
            />
          </div>
        </div>
      )}
      {/* Audio is rendered at the CallShell level (AudioMixer) so participants
          stay audible across layout changes. Per-tile audio would unmount
          when the layout hides the tile. */}
      {!compact && !muteOverlay && (
        <div className="absolute left-2 bottom-2 right-2 flex items-center gap-1 text-[11px] text-ink-1 bg-black/55 px-2 py-1 rounded">
          <span className="truncate">{tile.displayName}</span>
          {!tile.micActive && (
            <span className="ml-auto text-err font-mono text-[10px]">
              MUTED
            </span>
          )}
        </div>
      )}
      {/* Active-speaker indicator. Painted as an inset overlay so it sits on
          top of the tile's own border and works inside whatever wrapper the
          layout uses. We set the radius explicitly because the wrappers all
          use rounded-lg and `inherit` of border-radius is unreliable. */}
      {speaking && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-emerald-400 animate-speaker-pulse"
        />
      )}
    </div>
  );
}

// Hidden audio element wired to a LiveKit track.attach(). Used per remote
// participant so every voice is audible regardless of which tile is visible.
function TrackAudio({ track }: { track: TrackType }) {
  const ref = useAttached<HTMLAudioElement>(track);
  return <audio ref={ref} autoPlay playsInline />;
}

// AudioMixer renders one hidden <audio> per remote participant per audio
// track they're publishing — both microphone and screen-share (system /
// tab) audio. Lives outside the layout switcher so participants stay
// audible regardless of which tiles are currently rendered, and stays
// mounted while the shell is minimized so the call doesn't go silent.
function AudioMixer({ tiles }: { tiles: CallParticipantTile[] }) {
  return (
    <div className="sr-only" aria-hidden>
      {tiles.map((t) => (
        <span key={`audio-row-${t.participantId}`}>
          {t.audioTrack ? (
            <TrackAudio key={`mic-${t.participantId}`} track={t.audioTrack} />
          ) : null}
          {t.screenAudioTrack ? (
            <TrackAudio
              key={`scrn-${t.participantId}`}
              track={t.screenAudioTrack}
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}

// Stable wrapper around <video> that wires up track.attach() / detach().
function TrackVideo({
  track,
  fit,
  muted = false,
}: {
  track: TrackType;
  fit: 'cover' | 'contain';
  muted?: boolean;
}) {
  const ref = useAttached<HTMLVideoElement>(track);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={
        fit === 'cover'
          ? 'w-full h-full object-cover'
          : 'max-h-full max-w-full object-contain'
      }
    />
  );
}

// --- Floating pip rendered while the call is minimized. Clicking anywhere
// (except the explicit hang-up button) expands the shell back to full screen.
// The pip is purely a control surface — actual media stays attached inside
// the (hidden but still mounted) CallShell.

function CallPip({
  title,
  elapsed,
  group,
  avatarNode,
  onExpand,
  onEnd,
}: {
  title: string;
  elapsed: string;
  group: boolean;
  avatarNode: React.ReactNode;
  onExpand(): void;
  onEnd(): void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Return to call"
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
      className="fixed bottom-4 right-4 z-50 w-[280px] bg-panel/95 backdrop-blur-md border border-line rounded-2xl shadow-2xl p-3 flex items-center gap-3 cursor-pointer hover:border-ember/60 transition-colors"
    >
      <div className="shrink-0">{avatarNode}</div>
      <div className="min-w-0 flex-1">
        <div className="text-ink-1 text-sm truncate flex items-center gap-1">
          {title}
        </div>
        <div className="font-mono text-ink-3 text-[11px] tabular-nums">
          {group ? 'Voice chat · ' : ''}
          {elapsed}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          // The whole pip already expands on click; the green button is a
          // discoverable affordance for the action.
          e.stopPropagation();
          onExpand();
        }}
        aria-label="Return to call"
        title="Return to call"
        className="shrink-0 w-9 h-9 rounded-full bg-emerald-500 text-bg flex items-center justify-center hover:bg-emerald-400 transition-colors"
      >
        <Phone size={16} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEnd();
        }}
        aria-label="End call"
        title="End call"
        className="shrink-0 w-9 h-9 rounded-full bg-err text-bg flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        <HangupIcon />
      </button>
    </div>
  );
}

// --- Control bar pieces. Mirrors the original visual language; the only new
// affordance is the `tint` prop for the screen-only toggle.

type ControlProps = {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick(): void;
  disabled?: boolean;
  tint?: 'ember';
};

function CallControl({
  label,
  icon,
  active,
  onClick,
  disabled = false,
  tint,
}: ControlProps) {
  const tone =
    tint === 'ember' && active
      ? 'bg-ember text-bg border-ember hover:bg-ember-soft'
      : tint === 'ember' && !active
        ? 'bg-transparent border-line text-ember hover:bg-raised'
        : active
          ? 'bg-raised border-line text-ink-1 hover:border-ember'
          : 'bg-transparent border-line text-ink-3 hover:text-ink-1 hover:border-line-strong';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        'w-14 h-14 rounded-full flex items-center justify-center border transition-colors ' +
        tone +
        (disabled ? ' opacity-30 cursor-not-allowed' : '')
      }
    >
      {icon}
    </button>
  );
}

function MicOnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <path d="M15 9.34V6a3 3 0 0 0-5.94-.66" />
      <path d="M5 11a7 7 0 0 0 .9 3.45" />
      <path d="M19 11a7 7 0 0 1-9.71 6.45" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}
function CamOnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="13" height="10" rx="1.5" />
      <path d="M16 11l5-3v8l-5-3z" />
    </svg>
  );
}
function CamOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M16 11l5-3v8l-5-3z" />
      <path d="M3 7h7l6 6v3a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 16V7z" />
    </svg>
  );
}
function HangupIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 14.5c4.5-5 12.5-5 17 0a2 2 0 0 1-.4 3l-2 1.3a1.5 1.5 0 0 1-1.8-.2l-1.8-1.6a1.5 1.5 0 0 0-1.9-.2 8.5 8.5 0 0 1-3.2 0 1.5 1.5 0 0 0-1.9.2l-1.8 1.6a1.5 1.5 0 0 1-1.8.2l-2-1.3a2 2 0 0 1-.4-3z" transform="rotate(135 12 14)" />
    </svg>
  );
}
