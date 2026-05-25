// Full-screen overlay rendered when a call is active. Owns the <video> /
// <audio> elements onto which we attach LiveKit tracks. Track attachment is
// idempotent — LiveKit's Track.attach is no-op if the element already has the
// underlying media stream.

import { useEffect, useRef, useState } from 'react';
import type { Track as TrackType } from 'livekit-client';
import { AppWindow, Monitor } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { useCall } from '../../stores/useCall';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// Hook: attach a LiveKit track to a media element and detach on unmount or
// when the track identity changes. Returns the ref to bind to <video>/<audio>.
function useAttached<E extends HTMLMediaElement>(
  track: TrackType | null,
) {
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
  const state = useCall((s) => s.state);
  const toggles = useCall((s) => s.toggles);
  const toggleMic = useCall((s) => s.toggleMic);
  const toggleCamera = useCall((s) => s.toggleCamera);
  const startScreenShare = useCall((s) => s.startScreenShare);
  const stopScreenShare = useCall((s) => s.stopScreenShare);
  const end = useCall((s) => s.end);

  const localCameraTrack = useCall((s) => s.localCameraTrack);
  const localScreenTrack = useCall((s) => s.localScreenTrack);
  const remoteCameraTrack = useCall((s) => s.remoteCameraTrack);
  const remoteScreenTrack = useCall((s) => s.remoteScreenTrack);
  const remoteAudioTrack = useCall((s) => s.remoteAudioTrack);

  const localVideoRef = useAttached<HTMLVideoElement>(localCameraTrack);
  const localScreenRef = useAttached<HTMLVideoElement>(localScreenTrack);
  const remoteVideoRef = useAttached<HTMLVideoElement>(remoteCameraTrack);
  const remoteScreenRef = useAttached<HTMLVideoElement>(remoteScreenTrack);
  const remoteAudioRef = useAttached<HTMLAudioElement>(remoteAudioTrack);

  // Tick once a second to drive the timer; isolated to its own state so the
  // rest of the view doesn't re-render on every tick.
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

  // Screen-share is the main view whenever either party is sharing. Otherwise
  // the remote camera (or the peer avatar for audio-only) is centered.
  const screenTrack = remoteScreenTrack ?? localScreenTrack;
  const showScreen = !!screenTrack;
  const showRemoteVideo = !!remoteCameraTrack;

  return (
    <div className="fixed inset-0 z-40 bg-black text-ink-1 flex flex-col">
      {/* Hidden audio sink for the remote mic. Without an element to attach
          to, the WebRTC track is received but not rendered to the user. */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top status bar — caller name + mm:ss timer. */}
      <header className="px-6 py-4 flex items-center justify-between">
        <div>
          <Kicker className="mb-1">
            {isActive ? 'IN CALL' : 'CALLING'} · {state.video ? 'VIDEO' : 'AUDIO'}
          </Kicker>
          <div className="text-ink-1 text-base">{peer.displayName}</div>
        </div>
        <div className="font-mono text-ink-2 text-sm tabular-nums">{elapsed}</div>
      </header>

      {/* Stage — fills remaining vertical space. */}
      <div className="flex-1 relative min-h-0 flex items-center justify-center">
        {showScreen ? (
          <video
            ref={
              remoteScreenTrack ? remoteScreenRef : localScreenRef
            }
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
          />
        ) : showRemoteVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          // Audio-only or peer hasn't published video yet — show their avatar.
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
        )}

        {/* Local camera PIP. Renders both when screen is showing (so peer can
            still see us as a tile) and otherwise. */}
        {localCameraTrack && toggles.cameraOn && (
          <div className="absolute top-4 right-4 w-32 h-24 rounded-lg overflow-hidden border border-line bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Remote camera secondary PIP when screen share is the main view. */}
        {showScreen && remoteCameraTrack && (
          <div className="absolute top-4 right-40 w-32 h-24 rounded-lg overflow-hidden border border-line bg-black">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>

      {/* Control bar. */}
      <div className="px-6 py-6 flex items-center justify-center gap-4">
        <CallControl
          label={toggles.micOn ? 'Mute' : 'Unmute'}
          icon={toggles.micOn ? <MicOnIcon /> : <MicOffIcon />}
          active={toggles.micOn}
          onClick={() => void toggleMic()}
        />
        <CallControl
          label={toggles.cameraOn ? 'Camera off' : 'Camera on'}
          icon={toggles.cameraOn ? <CamOnIcon /> : <CamOffIcon />}
          active={toggles.cameraOn}
          onClick={() => void toggleCamera()}
        />
        <CallControl
          label={toggles.screenShareOn ? 'Stop sharing screen' : 'Share screen'}
          icon={<Monitor size={20} strokeWidth={1.75} />}
          active={toggles.screenShareOn}
          onClick={() => {
            if (toggles.screenShareOn) {
              void stopScreenShare();
            } else {
              void startScreenShare('monitor');
            }
          }}
        />
        <CallControl
          label={toggles.screenShareOn ? 'Stop sharing window' : 'Share window'}
          icon={<AppWindow size={20} strokeWidth={1.75} />}
          active={toggles.screenShareOn}
          onClick={() => {
            if (toggles.screenShareOn) {
              void stopScreenShare();
            } else {
              void startScreenShare('window');
            }
          }}
        />
        <button
          type="button"
          onClick={() => void end()}
          aria-label="Hang up"
          className="w-14 h-14 rounded-full bg-err text-bg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <HangupIcon />
        </button>
      </div>
    </div>
  );
}

type ControlProps = {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick(): void;
};

function CallControl({ label, icon, active, onClick }: ControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        'w-14 h-14 rounded-full flex items-center justify-center border transition-colors ' +
        (active
          ? 'bg-raised border-line text-ink-1 hover:border-ember'
          : 'bg-transparent border-line text-ink-3 hover:text-ink-1 hover:border-line-strong')
      }
    >
      {icon}
    </button>
  );
}

// --- Inline SVG icons. Keeps the bundle free of an icon library and matches
// the editorial minimalism (hairline strokes, no fill). ---

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
