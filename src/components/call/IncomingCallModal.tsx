// Full-screen overlay shown while the local user has an incoming call.
//
// The store transitions into 'incoming' on receipt of an `incoming_call`
// realtime envelope, and the same state triggers a soft beep loop. The modal
// stays mounted until the user clicks Accept/Decline or 60s passes (the store
// auto-declines on its own timer; we just render).

import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';
import { useCall } from '../../stores/useCall';
import { MediaConsentModal, hasMediaConsent, setMediaConsent } from './MediaConsentModal';

// A 0.2s, ~440Hz, ~16kHz mono PCM WAV beep encoded as base64. Tiny enough to
// inline and avoids a network round-trip / CORS concerns. Hand-rolled PCM;
// keep it short and quiet — looped, anything longer feels like a smoke alarm.
const BEEP_DATA_URL =
  'data:audio/wav;base64,UklGRiQEAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAEAACAh4+Wnaaur7m9w8nN0NXX2t3e3+Df3t3a2NXSzcrFwLu2sa2ondiVjoiCfXh0cG5ramlmaWxrcHN3fIGFio6Sl5ufpKissLW6vsLFx8nMzc7Pz87NzMrIxsTBvru4ta+rpqOdnZqUkY2KhoOAfHl3dHJwbm5tbW5wcXR4e3+ChYqOk5ebnaCkqKmsr7Czt7m7vsDBwsTFxcXFxcTDwb+9u7m2tLGuq6inopySi4F0YlxYV1ZXWVtfYmlxd4CIkJedp6+3vsfO1d3i5+vu8/X4+vz9/v///v79/Pr39PHt6OPe2NDLwru0qaCXjISBeXJsZGBcWFRRT01MTU1OUFNVWVxgZGhsb3N3en6BhIeKjpCSlJaWmJiZmZmZmZmYmZmYmJiZmJmZmpqcnZ+goaOmqayur7Cytri5u72/wMHCxMTFxcbFxcXExMPCwcDAv76+vb27u7q6ubm5uLi3t7e3tre3t7i4uLi5uru7vL2+v8DBw8TGyMnLzM3O0NHS09TV1tfY2drb293d3t/g4ODh4eHi4uLi4uPj4+Tk5OTk5OTk5OTk5OTk5OTk4+Pj4+Li4uLh4eHg4ODf397e3d3c3Nva2tnY2NfX1tbV1NPS0dHQz87NzczLysnIyMfGxsXExMPDwsLCwsHBwcHBwsLDw8TExcXFxsbHx8jIyMnJycnKysrKysrKysrKycnJycnJycjIyMjIx8fHx8fHx8fHx8fHx8fIyMjIycnKysrLy8zMzc3Ozs/P0NDQ0dHS0tLT09PT09TU1NTU1NTU1NTU1NTU09PT09PT09LS0tLR0dHQ0M/Pzs7Nzc3MzMvLysrJycjIyMfHx8bGxsXFxcXFxcTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMXFxcXFxcXFxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbG';

export function IncomingCallModal() {
  const state = useCall((s) => s.state);
  const accept = useCall((s) => s.accept);
  const decline = useCall((s) => s.decline);

  const [showConsent, setShowConsent] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play the ring tone whenever a call is incoming. Autoplay is gated by the
  // browser; we wrap the play() call in a try/catch so failure is silent.
  useEffect(() => {
    if (state.kind !== 'incoming') return;
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {
      /* autoplay blocked — silent ring is acceptable */
    });
    return () => {
      el.pause();
      el.currentTime = 0;
    };
  }, [state.kind]);

  if (state.kind !== 'incoming') return null;

  const { peer, video } = state;

  async function handleAccept() {
    if (!hasMediaConsent()) {
      setShowConsent(true);
      return;
    }
    if (accepting) return;
    setAccepting(true);
    try {
      await accept();
    } finally {
      setAccepting(false);
    }
  }

  function handleDecline() {
    void decline();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-6">
      <audio ref={audioRef} src={BEEP_DATA_URL} loop preload="auto" />

      <Kicker className="mb-8">
        INCOMING · {video ? 'VIDEO' : 'AUDIO'}
      </Kicker>

      <div className="mb-6">
        <Avatar
          displayName={peer.displayName}
          color={peer.avatarColor ?? ''}
          size={120}
        />
      </div>

      <div className="text-ink-1 text-2xl tracking-tight mb-1">
        {peer.displayName}
      </div>
      {peer.handle && (
        <div className="text-ink-3 text-sm font-mono mb-12">
          @{peer.handle}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 w-full max-w-md">
        <button
          type="button"
          onClick={handleDecline}
          className="flex-1 px-6 py-4 text-sm font-medium tracking-tight border border-line text-ink-1 hover:border-err hover:text-err transition-colors"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={accepting}
          className="flex-1 px-6 py-4 text-sm font-medium tracking-tight bg-ember text-bg hover:bg-ember-soft disabled:opacity-60 transition-colors"
        >
          {accepting ? 'Connecting…' : 'Accept'}
        </button>
      </div>

      <MediaConsentModal
        open={showConsent}
        onContinue={() => {
          setMediaConsent();
          setShowConsent(false);
          void handleAccept();
        }}
        onCancel={() => {
          setShowConsent(false);
          handleDecline();
        }}
      />
    </div>
  );
}
