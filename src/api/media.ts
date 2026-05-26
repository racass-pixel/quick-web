// HTTP multipart upload for generic media attachments (images, files).
// Mirrors the voice upload path (POST /v1/media/voice) but uses the generic
// endpoint added in v0.14.0: POST /v1/media/upload. Accepts any file; the
// server enforces size caps (image 50MB, file 500MB) and returns the kind
// it inferred from the mime.
//
// Caller flow: upload one or more files, collect their `file_id` values,
// then pass them to Messaging.SendMessage as `attachment_file_ids`.

import { session } from './session';

export type UploadedAttachment = {
  fileId: string;
  kind: 'image' | 'file' | 'voice' | string;
  mime: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  url?: string;
  thumbnailUrl?: string;
  filename?: string;
};

type WireUploadResponse = {
  file_id: string;
  kind: string;
  mime: string;
  size?: number;
  size_bytes?: number;
  width?: number;
  height?: number;
  url?: string;
  thumbnail_url?: string;
  filename?: string;
};

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8080';

export type UploadProgressEvent = {
  loaded: number;
  total: number;
};

export async function uploadAttachment(
  file: File,
  onProgress?: (e: UploadProgressEvent) => void,
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append('file', file, file.name);

  const headers: Record<string, string> = {};
  const token = session.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Use XMLHttpRequest so we can surface upload progress. The fetch API has
  // no portable progress event for the request body.
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/v1/media/upload`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => {
      if (!onProgress) return;
      onProgress({
        loaded: ev.loaded,
        total: ev.total > 0 ? ev.total : file.size,
      });
    };
    xhr.onerror = () => reject(new Error('upload failed: network error'));
    xhr.onabort = () => reject(new Error('upload aborted'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `upload failed: ${xhr.status} ${xhr.statusText}${
              xhr.responseText ? ` — ${xhr.responseText}` : ''
            }`,
          ),
        );
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as WireUploadResponse;
        resolve({
          fileId: body.file_id,
          kind: body.kind,
          mime: body.mime,
          sizeBytes: body.size_bytes ?? body.size ?? file.size,
          width: body.width,
          height: body.height,
          url: body.url,
          thumbnailUrl: body.thumbnail_url,
          filename: body.filename ?? file.name,
        });
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(form);
  });
}
