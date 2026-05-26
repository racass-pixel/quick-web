// TG-style voice message bubble. Lays out a 48px play/pause circle, a row
// of 64 waveform bars sized off the per-bucket peaks, an MM:SS counter and
// a small 1x/1.5x/2x speed pill in the bottom-right.
//
// Read state: the colour of the bars depends on `voice.played` and on
// whether we're the sender or the receiver.
//   - Receiver, unplayed   → all bars ember + small dot beside the size
//   - Receiver, played     → all bars grey (read)
//   - Sender, peer unplayed→ all bars ember (TG matches sender's bubble to
//                            the receiver's state; we keep it ember until
//                            the WS voice_played echo flips `played` to true)
//   - Sender, peer played  → all bars grey
// During playback, bars BEFORE the current playhead are ember-tinted and
// AFTER are ink-3. The progress overlay is computed each `timeupdate` tick.
//
// First-play tracking: the receiver fires `onFirstPlay` exactly once per
// message id when they hit Play. The parent debounces server-side via a
// per-id Set in MessageBubble, so a re-render mid-play doesn't double-fire.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { session } from '../../api/session';

// Build the playback URL by appending the session token as a query string.
// The <audio> element can't set Authorization headers; the backend's voice
// download proxy accepts the same token via `?token=` for this reason.
function buildPlaybackURL(url: string): string {
  if (!url) return url;
  const tok = session.token;
  if (!tok) return url;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}token=${encodeURIComponent(tok)}`;
}

export type VoicePayload = {
  fileId: string;
  url: string;
  durationMs: number;
  peaks: number[];
  played: boolean;
};

type Props = {
  voice: VoicePayload;
  isOwn: boolean;
  // Fires the first time playback starts on the receiver side. Sender side
  // can pass undefined or a noop.
  onFirstPlay?: () => void;
};

const BAR_COUNT = 64;
const SPEEDS: ReadonlyArray<number> = [1, 1.5, 2];

function fmtMmss(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceBubble({ voice, isOwn, onFirstPlay }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const firedFirstPlayRef = useRef<boolean>(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [sizeLabel, setSizeLabel] = useState<string>('—KB');
  // Audio src points at our backend's streaming proxy with the session token
  // in the query string (browsers can't put Authorization on <audio>).
  const playbackURL = useMemo(() => buildPlaybackURL(voice.url), [voice.url]);

  // Peaks are 0-255 ints; normalise to 0-1 for height calc. Pad/truncate
  // to BAR_COUNT to be defensive against malformed inputs.
  const peaks: number[] = (() => {
    const src = voice.peaks ?? [];
    if (src.length === BAR_COUNT) return src;
    const out = new Array<number>(BAR_COUNT).fill(0);
    for (let i = 0; i < Math.min(src.length, BAR_COUNT); i++) out[i] = src[i];
    return out;
  })();

  const totalMs = Math.max(0, voice.durationMs | 0);
  const progress = totalMs > 0 ? Math.max(0, Math.min(1, currentMs / totalMs)) : 0;

  // Receiver-unplayed gets the "all-ember + unread dot" treatment. After the
  // server (or local optimistic flip) marks played=true, we switch to the
  // standard played styling so the user can still scrub if they replay.
  const unread = !voice.played && !isOwn;

  // Try a HEAD request to learn the blob size for the small KB label. Best
  // effort — if the endpoint doesn't expose CORS or content-length we just
  // leave the placeholder.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(buildPlaybackURL(voice.url), { method: 'HEAD', signal: ctrl.signal });
        if (cancelled) return;
        const len = res.headers.get('content-length');
        const n = len ? Number(len) : NaN;
        if (Number.isFinite(n) && n > 0) {
          const kb = n / 1024;
          setSizeLabel(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`);
        }
      } catch {
        // ignore — keep placeholder
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [voice.url]);

  // Keep playbackRate in sync with the chosen speed pill — `audio` resets
  // playbackRate when src changes, so we set it on each speed flip AND on
  // every play start.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = SPEEDS[speedIdx];
  }, [speedIdx]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      // First time receiver hits play → notify server we've played it. We
      // gate on the receiver side AND on a ref so a brief pause-then-play
      // doesn't double-fire within the same component instance.
      if (!isOwn && !voice.played && !firedFirstPlayRef.current) {
        firedFirstPlayRef.current = true;
        try {
          onFirstPlay?.();
        } catch {
          // ignore — caller-supplied; we don't want to block playback
        }
      }
      el.playbackRate = SPEEDS[speedIdx];
      void el.play();
    } else {
      el.pause();
    }
  }

  function cycleSpeed() {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }

  function onTimeUpdate() {
    const el = audioRef.current;
    if (!el) return;
    setCurrentMs(Math.floor(el.currentTime * 1000));
  }

  function onPlay() {
    setPlaying(true);
  }
  function onPause() {
    setPlaying(false);
  }
  function onEnded() {
    setPlaying(false);
    // Reset the playhead so a subsequent Play starts from the beginning,
    // mirroring TG behaviour.
    const el = audioRef.current;
    if (el) {
      el.currentTime = 0;
      setCurrentMs(0);
    }
  }

  // Bar height range — keep a visible floor so silent buckets still render
  // as a tiny dot rather than vanishing.
  const MAX_BAR_HEIGHT = 28;
  const MIN_BAR_HEIGHT = 3;

  return (
    <div className="flex items-center gap-3 min-w-[260px] max-w-full select-none">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        className="shrink-0 w-12 h-12 rounded-full bg-ember text-bg hover:bg-ember-soft flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/60 transition-colors"
      >
        {playing ? (
          <Pause size={22} strokeWidth={2.25} fill="currentColor" />
        ) : (
          <Play size={22} strokeWidth={2.25} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-end gap-[2px] h-[28px]">
          {peaks.map((p, i) => {
            const norm = Math.max(0, Math.min(1, p / 255));
            const h = Math.max(MIN_BAR_HEIGHT, Math.round(norm * MAX_BAR_HEIGHT));
            // Decide colour: ember if unread OR before playback head; grey
            // otherwise. Played receiver / played sender → fully grey.
            const beforeHead = (i + 0.5) / BAR_COUNT <= progress;
            let cls: string;
            if (unread) {
              cls = 'bg-ember';
            } else if (playing || currentMs > 0) {
              cls = beforeHead ? 'bg-ember' : 'bg-ink-3/60';
            } else {
              // Idle: own-unplayed-by-peer keeps the ember tone; otherwise grey.
              const ownUnplayed = isOwn && !voice.played;
              cls = ownUnplayed ? 'bg-ember/80' : 'bg-ink-3/60';
            }
            return (
              <span
                key={i}
                className={`w-[2px] rounded-full ${cls}`}
                style={{ height: `${h}px` }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-ink-3">
          <span>
            {fmtMmss(playing || currentMs > 0 ? currentMs : totalMs)}
            {(playing || currentMs > 0) && (
              <span className="opacity-60"> / {fmtMmss(totalMs)}</span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span>{sizeLabel}</span>
            {unread && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-ember"
                aria-label="Unread"
              />
            )}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${SPEEDS[speedIdx]}x`}
        title={`Playback speed ${SPEEDS[speedIdx]}x`}
        className="shrink-0 self-start text-[11px] font-mono px-1.5 py-0.5 rounded-md bg-ink-3/15 text-ink-2 hover:bg-ink-3/25 transition-colors"
      >
        {SPEEDS[speedIdx]}x
      </button>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={playbackURL}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        className="hidden"
      />
    </div>
  );
}
