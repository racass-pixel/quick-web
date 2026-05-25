// Button rendered in the DM thread header. Dispatches a call to the peer.
// Two visual variants for the two modes; both share the same start flow which
// gates on the media-consent pre-prompt.

import { useState } from 'react';
import { useCall, type CallPeer } from '../../stores/useCall';
import {
  MediaConsentModal,
  hasMediaConsent,
  setMediaConsent,
} from './MediaConsentModal';

type Props = {
  peer: CallPeer;
  video: boolean;
  className?: string;
};

export function CallButton({ peer, video, className = '' }: Props) {
  const start = useCall((s) => s.start);
  const callState = useCall((s) => s.state);
  const [showConsent, setShowConsent] = useState(false);
  const [starting, setStarting] = useState(false);

  const disabled = callState.kind !== 'idle' || starting;

  async function fire() {
    if (disabled) return;
    setStarting(true);
    try {
      await start(peer, video);
    } catch {
      // The store has already reset itself on failure; surface nothing for
      // now (a toast system would go here later).
    } finally {
      setStarting(false);
    }
  }

  function handleClick() {
    if (!hasMediaConsent()) {
      setShowConsent(true);
      return;
    }
    void fire();
  }

  const label = video ? 'Video' : 'Call';
  const ariaLabel = video ? 'Start video call' : 'Start voice call';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={
          'inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed border ' +
          (video
            ? 'bg-ember text-bg border-ember hover:bg-ember-soft hover:border-ember-soft'
            : 'bg-transparent text-ink-2 border-line hover:text-ember hover:border-ember') +
          ' ' +
          className
        }
      >
        {video ? <VideoIcon /> : <PhoneIcon />}
        <span>{label}</span>
      </button>

      <MediaConsentModal
        open={showConsent}
        onContinue={() => {
          setMediaConsent();
          setShowConsent(false);
          void fire();
        }}
        onCancel={() => setShowConsent(false)}
      />
    </>
  );
}

function PhoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.7 12.7 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.7 12.7 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="14" height="12" rx="1.5" />
      <path d="M16 10l6-3v10l-6-3z" />
    </svg>
  );
}
