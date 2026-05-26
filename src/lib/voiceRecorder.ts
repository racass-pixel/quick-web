// MediaRecorder-backed voice capture used by the Composer's hold-to-record
// button. The exported `startRecording` requests mic access, wires an
// AnalyserNode for the live-level UI and a MediaRecorder for the actual
// audio capture. The returned control object lets the caller stop (resolving
// with the recorded blob, duration and 64 normalised peak values) or cancel
// (tear down the stream without resolving a result).
//
// The browser produces an opus stream — we prefer `audio/webm;codecs=opus`
// then fall back to `audio/ogg;codecs=opus`, and finally to whatever default
// the browser supports. Backend accepts any opus container; mime is preserved
// on the upload so server-side ffmpeg can decode either.
//
// Peak extraction happens client-side via the Web Audio API (decodeAudioData),
// rather than relying on backend ffmpeg. We split channel 0 into 64 equal
// buckets and take the per-bucket peak amplitude, normalised to 0-255 ints
// for compact wire transport.

export type RecordingState =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number; mediaRecorder: MediaRecorder }
  | { kind: 'finalising' };

export type RecordingResult = {
  blob: Blob;
  durationMs: number;
  peaks: number[]; // 64 values 0-255
};

export type RecorderHandle = {
  stop(): Promise<RecordingResult>;
  cancel(): void;
  getLiveLevel(): number; // 0-1 current input level, for UI animation
};

const PEAK_BUCKETS = 64;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/ogg',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore — some implementations throw on unknown mimes
    }
  }
  return undefined;
}

export async function startRecording(): Promise<RecorderHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('MediaDevices API unavailable');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = pickMimeType();
  let mediaRecorder: MediaRecorder;
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (e) {
    // Tear down the mic if MediaRecorder construction failed.
    for (const t of stream.getTracks()) t.stop();
    throw e;
  }

  const chunks: Blob[] = [];
  mediaRecorder.addEventListener('dataavailable', (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  });

  // Live-level wiring — separate from MediaRecorder. We hook the same
  // MediaStream into an AnalyserNode and sample its time-domain buffer in
  // getLiveLevel, computing a quick RMS so the UI's ember pulse mirrors the
  // user's actual voice amplitude.
  const AudioCtxCtor: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyserBuf: Float32Array<ArrayBuffer> | null = null;
  if (AudioCtxCtor) {
    try {
      audioCtx = new AudioCtxCtor();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyserBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      audioCtx = null;
      analyser = null;
    }
  }

  function teardown() {
    try {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    } catch {
      // ignore — already stopped or never started
    }
    try {
      source?.disconnect();
    } catch {
      // ignore
    }
    try {
      analyser?.disconnect();
    } catch {
      // ignore
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      void audioCtx.close();
    }
    for (const t of stream.getTracks()) t.stop();
  }

  // Some browsers require an explicit timeslice arg to start producing
  // chunks early. We pass 100ms so a stop() call sees data immediately even
  // for very short recordings.
  mediaRecorder.start(100);
  const startedAt = Date.now();

  let cancelled = false;
  let stopPromise: Promise<RecordingResult> | null = null;

  function stop(): Promise<RecordingResult> {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise<RecordingResult>((resolve, reject) => {
      const onStop = () => {
        mediaRecorder.removeEventListener('stop', onStop);
        if (cancelled) {
          teardown();
          reject(new Error('cancelled'));
          return;
        }
        const blob = new Blob(chunks, {
          type: mediaRecorder.mimeType || mimeType || 'audio/webm',
        });
        // We computed startedAt ourselves rather than relying on
        // MediaRecorder timing — clock-based duration is accurate enough for
        // the UI label and matches what the backend will see on the audio.
        const durationMs = Date.now() - startedAt;
        // Tear down the mic AFTER reading the blob so the chunk callbacks
        // have had a chance to flush.
        teardown();
        computePeaks(blob)
          .then((res) => {
            resolve({
              blob,
              // Prefer the decoded duration when available — it's the
              // authoritative number for what the bytes contain. Some
              // browsers chop the tail when the recorder is asked to stop
              // early; in those cases the decoded duration may be slightly
              // shorter than our wall-clock estimate.
              durationMs: res.durationMs > 0 ? res.durationMs : durationMs,
              peaks: res.peaks,
            });
          })
          .catch(() => {
            // decodeAudioData can fail for tiny/empty blobs — fall back to
            // a flat waveform so the UI still gets renderable data.
            resolve({
              blob,
              durationMs,
              peaks: new Array(PEAK_BUCKETS).fill(0),
            });
          });
      };
      mediaRecorder.addEventListener('stop', onStop);
      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        else onStop();
      } catch (err) {
        reject(err);
      }
    });
    return stopPromise;
  }

  function cancel(): void {
    cancelled = true;
    try {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    } catch {
      // ignore
    }
    teardown();
  }

  function getLiveLevel(): number {
    if (!analyser || !analyserBuf) return 0;
    try {
      analyser.getFloatTimeDomainData(analyserBuf);
    } catch {
      return 0;
    }
    // RMS over the latest time-domain frame. Values are in [-1, 1].
    let sumSq = 0;
    for (let i = 0; i < analyserBuf.length; i++) {
      const v = analyserBuf[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / analyserBuf.length);
    // Clamp to [0, 1]; mic input rarely exceeds 0.5 RMS, so a *2 makes the
    // pulse visible without saturating instantly.
    return Math.min(1, rms * 2);
  }

  return { stop, cancel, getLiveLevel };
}

// Decode the recorded blob and downsample to 64 peak values.
//
// We use an OfflineAudioContext-friendly approach: a transient AudioContext
// just for decoding, then we close it immediately. decodeAudioData accepts
// the opus container as long as the browser can decode it (which it must,
// since the browser produced it).
async function computePeaks(
  blob: Blob,
): Promise<{ peaks: number[]; durationMs: number }> {
  if (blob.size === 0) {
    return { peaks: new Array(PEAK_BUCKETS).fill(0), durationMs: 0 };
  }
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtxCtor: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtxCtor) {
    return { peaks: new Array(PEAK_BUCKETS).fill(0), durationMs: 0 };
  }
  const ctx = new AudioCtxCtor();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    const channel = audioBuf.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channel.length / PEAK_BUCKETS));
    const peaks: number[] = new Array(PEAK_BUCKETS).fill(0);
    let globalMax = 0;
    for (let b = 0; b < PEAK_BUCKETS; b++) {
      const start = b * bucketSize;
      const end = b === PEAK_BUCKETS - 1 ? channel.length : start + bucketSize;
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(channel[i]);
        if (v > peak) peak = v;
      }
      peaks[b] = peak;
      if (peak > globalMax) globalMax = peak;
    }
    // Normalise to 0-255. If the recording is silent (globalMax = 0) we keep
    // the array of zeros so the receiver still gets a flat waveform.
    const out = new Array<number>(PEAK_BUCKETS);
    if (globalMax > 0) {
      const scale = 255 / globalMax;
      for (let i = 0; i < PEAK_BUCKETS; i++) {
        out[i] = Math.max(0, Math.min(255, Math.round(peaks[i] * scale)));
      }
    } else {
      for (let i = 0; i < PEAK_BUCKETS; i++) out[i] = 0;
    }
    return { peaks: out, durationMs: Math.round(audioBuf.duration * 1000) };
  } finally {
    if (ctx.state !== 'closed') void ctx.close();
  }
}
