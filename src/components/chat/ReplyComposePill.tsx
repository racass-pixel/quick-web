// Quote pill rendered above the composer when the user has picked a message
// to reply to. Shows the original sender's name + a short preview of the
// quoted body, with an ember left-rail and a small dismiss button.

import { X, CornerUpLeft } from 'lucide-react';
import type { LocalMessage } from '../../stores/useChats';

type Props = {
  message: LocalMessage;
  senderName: string;
  onCancel(): void;
};

const PREVIEW_MAX = 80;

function previewText(m: LocalMessage): string {
  const body = (m.displayBody && m.displayBody.length > 0 ? m.displayBody : m.body) ?? '';
  if (body.length > 0) {
    return body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX)}…` : body;
  }
  const atts = (m.attachments as Array<{ kind: string; filename?: string }> | undefined) ?? [];
  if (atts.length > 0) {
    const first = atts[0];
    if (first.kind === 'image') return 'Photo';
    return first.filename || 'Attachment';
  }
  if (m.voice) return 'Voice message';
  return 'Message';
}

export function ReplyComposePill({ message, senderName, onCancel }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-raised/60 border-t border-line">
      <CornerUpLeft size={16} className="text-ember shrink-0" strokeWidth={2} />
      <div className="w-[2px] self-stretch bg-ember shrink-0 rounded-full" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ember truncate">
          Reply to {senderName}
        </div>
        <div className="text-[12px] text-ink-3 truncate">{previewText(message)}</div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply"
        className="w-7 h-7 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-1 hover:bg-raised transition-colors"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
