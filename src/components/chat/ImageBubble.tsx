// Inline image attachment. Renders the server-provided thumbnail (or the
// original when no thumb is available), capped at 320px wide, and opens the
// lightbox on click.

import { useState } from 'react';
import { ImageLightbox } from './ImageLightbox';

type Props = {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  filename?: string;
};

const MAX_W = 320;
const MAX_H = 360;

export function ImageBubble({ url, thumbnailUrl, width, height, filename }: Props) {
  const [open, setOpen] = useState(false);

  // Pre-compute a CSS box that respects the original aspect ratio so the
  // bubble doesn't jump as the image loads.
  let boxW = MAX_W;
  let boxH = MAX_H;
  if (width && height && width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio >= 1) {
      boxW = Math.min(MAX_W, width);
      boxH = Math.round(boxW / ratio);
    } else {
      boxH = Math.min(MAX_H, height);
      boxW = Math.round(boxH * ratio);
    }
  }

  const src = thumbnailUrl && thumbnailUrl.length > 0 ? thumbnailUrl : url;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-md bg-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        style={{ width: boxW, height: boxH, maxWidth: '100%' }}
        aria-label="Open image"
      >
        <img
          src={src}
          alt={filename ?? 'image'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </button>
      {open && (
        <ImageLightbox url={url} filename={filename} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
