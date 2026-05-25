// Button rendered in the DM thread header. Dispatches a call to the peer.
// Two visual variants for the two modes; both share the same start flow which
// gates on the media-consent pre-prompt.
//
// `iconOnly` collapses the button to a 40x40 round icon shape, used by the
// TG-style thread header where labels would clutter the row.

import { useState } from 'react';
import { Phone, Video } from 'lucide-react';
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
  iconOnly?: boolean;
};

export function CallButton({ peer, video, className = '', iconOnly = false }: Props) {
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

  if (iconOnly) {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          aria-label={ariaLabel}
          title={ariaLabel}
          className={
            'w-10 h-10 rounded-full inline-flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
            className
          }
        >
          {video ? <Video size={20} strokeWidth={2} /> : <Phone size={20} strokeWidth={2} />}
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
        {video ? <Video size={12} strokeWidth={2} /> : <Phone size={12} strokeWidth={2} />}
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
