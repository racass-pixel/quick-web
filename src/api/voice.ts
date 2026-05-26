// HTTP multipart upload for voice blobs. The backend's Connect-RPC surface
// isn't well-suited to binary streams, so voice attachments take a dedicated
// REST endpoint: `POST /v1/media/voice` with `file`, `duration_ms` and
// `peaks` (JSON array) as multipart fields. The endpoint returns a JSON body
// `{file_id, url, duration_ms, peaks}` which we re-shape into camelCase for
// the rest of the client.
//
// After this returns successfully the caller invokes
// `messagingClient.sendVoiceMessage({conversationId, voiceFileId})` to write
// the actual message row referencing the uploaded blob.

import { session } from './session';

export type VoiceUploadResult = {
  fileId: string;
  url: string;
  durationMs: number;
  peaks: number[];
};

type WireUploadResponse = {
  file_id: string;
  url: string;
  duration_ms: number;
  peaks: number[];
};

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8080';

export async function uploadVoiceMessage(
  blob: Blob,
  durationMs: number,
  peaks: number[],
): Promise<VoiceUploadResult> {
  const form = new FormData();
  // The backend expects the file under the field name `file` — pick a
  // sensible filename from the blob's mime so server-side ffmpeg can
  // determine the container without sniffing.
  const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', blob, `voice.${ext}`);
  form.append('duration_ms', String(Math.max(0, Math.round(durationMs))));
  form.append('peaks', JSON.stringify(peaks));

  const headers: Record<string, string> = {};
  const token = session.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/v1/media/voice`, {
    method: 'POST',
    body: form,
    headers,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `voice upload failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }
  const body = (await res.json()) as WireUploadResponse;
  return {
    fileId: body.file_id,
    url: body.url,
    durationMs: body.duration_ms,
    peaks: body.peaks,
  };
}
