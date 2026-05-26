// TG-style composer.
//
// Layout:  [📎]  [ textarea (auto-grow 44→120) ]  [🎤 / ➤]
//
// The right-side button morphs: a microphone icon when the input is empty
// (hold-to-record), an ember send arrow when the user has typed something.
// Both are crossfaded with a 150ms transition.
//
// Voice — when the input is empty and the user presses-and-holds the mic
// button, recording starts: the textarea is replaced with a live recording
// bar (timer, amplitude blob, slide-to-cancel hint) and the right button
// morphs into a red square. Releasing the button stops the recorder; sliding
// the pointer more than 80px left while still held cancels. On stop we
// upload the captured blob to /v1/media/voice and then call
// `messagingClient.sendVoiceMessage` to write the actual message row.
//
// Edge cases:
//   - recordings shorter than 800ms are dropped silently (TG-style — too
//     short to be meaningful)
//   - mic permission denials surface as an inline error pill under the
//     composer for ~3s, then dismiss themselves

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronLeft, Loader2, Mic, Paperclip, Send, Square } from 'lucide-react';
import { messagingClient } from '../../api/messaging';
import { uploadVoiceMessage } from '../../api/voice';
import { startRecording, type RecorderHandle } from '../../lib/voiceRecorder';

type Props = {
  onSend: (body: string) => Promise<void> | void;
  onTyping?: () => void;
  disabled?: boolean;
  placeholder?: string;
  // Conversation id, required for voice messages (the upload + sendVoiceMessage
  // path is handled inside the composer rather than going through onSend).
  conversationId?: string;
};

const LINE_HEIGHT_PX = 20;
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 120;
const CANCEL_SWIPE_PX = 80;
const MIN_VOICE_MS = 800;

type Phase = 'idle' | 'recording' | 'uploading';

function fmtTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Composer({ onSend, onTyping, disabled, placeholder, conversationId }: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Voice state. The recorder handle and a few pointer-tracking refs live
  // outside React state so they don't trigger re-renders on every move/tick.
  const [phase, setPhase] = useState<Phase>('idle');
  const [timerMs, setTimerMs] = useState(0);
  const [liveLevel, setLiveLevel] = useState(0);
  const [swipeDx, setSwipeDx] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const pressStartXRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const cancelOnReleaseRef = useRef<boolean>(false);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Auto-resize: reset height then expand up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  // Reference LINE_HEIGHT_PX so it isn't dead — handy elsewhere if the
  // composer ever needs to enforce a precise line count.
  void LINE_HEIGHT_PX;

  // Auto-dismiss the inline voice-error pill so it doesn't linger.
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 3000);
    return () => clearTimeout(t);
  }, [voiceError]);

  // Tick loop while recording — drives both the running timer and the
  // live-level animation off a single requestAnimationFrame.
  useEffect(() => {
    if (phase !== 'recording') return;
    let mounted = true;
    function tick() {
      if (!mounted) return;
      setTimerMs(Date.now() - startedAtRef.current);
      const r = recorderRef.current;
      if (r) setLiveLevel(r.getLiveLevel());
      rafRef.current = window.requestAnimationFrame(tick);
    }
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase]);

  async function submit() {
    const body = value.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setValue('');
    } finally {
      setSending(false);
      // Restore focus so the user can immediately type the next message.
      // Browsers blur disabled textareas; defer to next tick so React has
      // already re-enabled the element by the time we focus it.
      requestAnimationFrame(() => {
        ref.current?.focus();
      });
    }
  }

  function handleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void submit();
    }
  }

  function handleChange(ev: ChangeEvent<HTMLTextAreaElement>) {
    setValue(ev.target.value);
    if (ev.target.value.trim().length > 0) onTyping?.();
  }

  // Internal: tear down a live recorder, drop in-flight refs, return to idle.
  const resetRecordingState = useCallback(() => {
    recorderRef.current = null;
    pressStartXRef.current = null;
    pointerIdRef.current = null;
    cancelOnReleaseRef.current = false;
    setSwipeDx(0);
    setTimerMs(0);
    setLiveLevel(0);
  }, []);

  // Press handler — starts the recorder. Async, but we don't await in the
  // event handler since user-gesture context for getUserMedia is satisfied
  // as long as we kick off the promise synchronously from the press event.
  async function onMicPointerDown(ev: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || phase !== 'idle' || value.trim().length > 0) return;
    if (!conversationId) return;
    ev.preventDefault();
    pressStartXRef.current = ev.clientX;
    pointerIdRef.current = ev.pointerId;
    try {
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    } catch {
      // ignore — pointer capture is a nice-to-have, not a hard requirement
    }
    try {
      const handle = await startRecording();
      // Bail if the user already released (or the component unmounted) by
      // the time getUserMedia resolved.
      if (pointerIdRef.current === null && !cancelOnReleaseRef.current) {
        handle.cancel();
        return;
      }
      recorderRef.current = handle;
      startedAtRef.current = Date.now();
      setPhase('recording');
    } catch (err) {
      // Most common cause: user clicked Block in the permission prompt, or
      // the device has no mic. Either way, gently surface and revert.
      // eslint-disable-next-line no-console
      console.warn('[composer] mic start failed', err);
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : 'Could not start recording';
      setVoiceError(msg);
      resetRecordingState();
      setPhase('idle');
    }
  }

  function onMicPointerMove(ev: ReactPointerEvent<HTMLButtonElement>) {
    if (phase !== 'recording') return;
    if (pressStartXRef.current == null) return;
    if (pointerIdRef.current !== ev.pointerId) return;
    const dx = ev.clientX - pressStartXRef.current;
    // Only track leftward movement; pin to 0..-CANCEL_SWIPE_PX*1.5.
    const clamped = Math.max(-CANCEL_SWIPE_PX * 1.5, Math.min(0, dx));
    setSwipeDx(clamped);
  }

  async function finishRecording(cancelled: boolean) {
    const handle = recorderRef.current;
    if (!handle) {
      resetRecordingState();
      setPhase('idle');
      return;
    }
    if (cancelled) {
      handle.cancel();
      resetRecordingState();
      setPhase('idle');
      return;
    }
    setPhase('uploading');
    try {
      const result = await handle.stop();
      if (result.durationMs < MIN_VOICE_MS) {
        // TG-style: too short. Silently drop — no error toast.
        resetRecordingState();
        setPhase('idle');
        return;
      }
      if (!conversationId) {
        resetRecordingState();
        setPhase('idle');
        return;
      }
      const uploaded = await uploadVoiceMessage(
        result.blob,
        result.durationMs,
        result.peaks,
      );
      await messagingClient.sendVoiceMessage({
        conversationId,
        voiceFileId: uploaded.fileId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[composer] voice send failed', err);
      setVoiceError('Voice message failed to send');
    } finally {
      resetRecordingState();
      setPhase('idle');
    }
  }

  function onMicPointerUp(ev: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerIdRef.current !== null && pointerIdRef.current !== ev.pointerId) return;
    // Clear the pointer-id sentinel before kicking the finish path so a race
    // with the async start above doesn't accidentally cancel a fresh recorder.
    pointerIdRef.current = null;
    const cancelled = swipeDx <= -CANCEL_SWIPE_PX || cancelOnReleaseRef.current;
    void finishRecording(cancelled);
  }

  function onMicPointerCancel() {
    pointerIdRef.current = null;
    void finishRecording(true);
  }

  // Clean up on unmount: if a recorder is still live, cancel it so we don't
  // leak the mic stream.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const hasText = value.trim().length > 0;
  const isRecording = phase === 'recording';
  const isUploading = phase === 'uploading';
  const showRecBar = isRecording || isUploading;
  const cancelArmed = swipeDx <= -CANCEL_SWIPE_PX;

  return (
    <div className="border-t border-line bg-bg px-3 py-2">
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach (coming soon)"
          title="Attach (coming soon)"
          disabled
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:bg-raised transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        >
          <Paperclip size={20} strokeWidth={2} />
        </button>

        {showRecBar ? (
          <div className="flex-1 min-h-[44px] rounded-2xl bg-raised border border-transparent px-4 py-2.5 flex items-center gap-3 text-[14px] text-ink-1 overflow-hidden">
            {isRecording ? (
              <>
                {/* Pulsing red dot — TG-style "recording" indicator. */}
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full bg-err shrink-0"
                  style={{ animation: 'pulse 1s ease-in-out infinite' }}
                  aria-hidden="true"
                />
                <span className="font-mono tabular-nums text-ink-1 select-none">
                  {fmtTimer(timerMs)}
                </span>
                {/* Live ember pulse — scales with mic input level. */}
                <span className="relative w-6 h-6 shrink-0" aria-hidden="true">
                  <span
                    className="absolute inset-0 m-auto rounded-full bg-ember/70"
                    style={{
                      width: `${6 + liveLevel * 18}px`,
                      height: `${6 + liveLevel * 18}px`,
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      transition: 'width 80ms linear, height 80ms linear',
                    }}
                  />
                </span>
                <div
                  className={
                    'flex-1 flex items-center justify-center gap-1 text-ink-3 font-mono text-[12px] select-none transition-colors ' +
                    (cancelArmed ? 'text-err' : '')
                  }
                  style={{
                    transform: `translateX(${Math.max(-CANCEL_SWIPE_PX, swipeDx)}px)`,
                    transition: 'transform 60ms linear',
                  }}
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                  <span>{cancelArmed ? 'Release to cancel' : 'Slide to cancel'}</span>
                </div>
              </>
            ) : (
              <>
                <Loader2 size={16} className="animate-spin text-ember shrink-0" aria-hidden="true" />
                <span className="font-mono text-[12px] text-ink-3 select-none">
                  Uploading…
                </span>
              </>
            )}
          </div>
        ) : (
          <textarea
            ref={ref}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || sending}
            placeholder={placeholder ?? 'Write a message'}
            rows={1}
            className="flex-1 resize-none bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent rounded-2xl px-4 py-2.5 focus:outline-none focus:border-ember/40 transition-colors text-[15px] leading-snug disabled:opacity-50 min-h-[44px]"
          />
        )}

        <div className="relative w-10 h-10 shrink-0">
          {/* Mic — voice. Hold to record. Hidden when text appears or while uploading. */}
          <button
            type="button"
            aria-label="Hold to record voice message"
            title="Hold to record"
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerCancel}
            disabled={disabled || !conversationId || isUploading}
            className={
              'absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center transition-opacity duration-150 disabled:cursor-not-allowed ' +
              (isRecording
                ? 'bg-err text-bg opacity-100 scale-105'
                : 'text-ink-3 hover:bg-raised') +
              ' ' +
              (hasText || isUploading ? 'opacity-0 pointer-events-none' : 'opacity-100')
            }
            style={{ touchAction: 'none' }}
          >
            {isRecording ? (
              <Square size={16} strokeWidth={2.5} fill="currentColor" />
            ) : (
              <Mic size={20} strokeWidth={2} />
            )}
          </button>
          {/* Upload spinner — sits where the mic would, visible while uploading. */}
          <div
            aria-hidden={!isUploading}
            className={
              'absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center text-ember transition-opacity duration-150 ' +
              (isUploading ? 'opacity-100' : 'opacity-0 pointer-events-none')
            }
          >
            <Loader2 size={20} className="animate-spin" />
          </div>
          {/* Send — primary action, fades in once there's text. */}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || sending || !hasText}
            aria-label="Send"
            title="Send"
            className={
              'absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center bg-ember text-bg hover:bg-ember-soft transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ember ' +
              (hasText ? 'opacity-100' : 'opacity-0 pointer-events-none')
            }
          >
            <Send size={18} strokeWidth={2.25} className="-ml-0.5" />
          </button>
        </div>
      </div>

      {voiceError && (
        <div
          role="alert"
          className="mt-2 px-3 py-1.5 rounded-md bg-err/10 border border-err/40 text-err text-[12px] font-mono"
        >
          {voiceError}
        </div>
      )}
    </div>
  );
}
