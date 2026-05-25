// Pre-flight explainer rendered before we ever request getUserMedia. We show
// it exactly once per browser profile (consent persists in localStorage); the
// goal is to give the user context for the impending Chrome/Firefox permission
// prompt so they aren't surprised. We do NOT actually request the OS-level
// permission here — clicking Continue closes the modal and lets the underlying
// call flow proceed, which is what triggers the browser prompt.

import { useEffect } from 'react';
import { Kicker } from '../primitives/Kicker';

const CONSENT_KEY = 'quick.media-consent';

export function hasMediaConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMediaConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    /* ignore quota or disabled storage */
  }
}

type Props = {
  open: boolean;
  onContinue(): void;
  onCancel(): void;
};

export function MediaConsentModal({ open, onContinue, onCancel }: Props) {
  // Close on Escape; matches the visual affordance of Cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center px-6">
      <div className="card max-w-md w-full p-8">
        <Kicker>Permission</Kicker>
        <h2 className="text-ink-1 text-xl mb-3 tracking-tight">
          Mic + camera
        </h2>
        <p className="text-ink-2 text-sm leading-relaxed mb-8">
          quick needs access to your microphone and camera to start a call.
          We don't record anything. Your browser will ask next.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-line text-ink-2 hover:text-ink-1 hover:border-line-strong transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="px-4 py-2 text-sm font-medium bg-ember text-bg hover:bg-ember-soft transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
