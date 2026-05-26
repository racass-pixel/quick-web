// Inline quote block rendered inside a message bubble when the message is a
// reply. Clicking the block scrolls to the original message in the thread
// and pulses it for ~1s. Resolves the quoted message from the in-memory
// store; falls back to a generic placeholder when the original isn't loaded.

import type { LocalMessage } from '../../stores/useChats';
import { useChats } from '../../stores/useChats';

type Props = {
  convId: string;
  replyToMessageId: string;
};

const PREVIEW_MAX = 96;

function previewOf(m: LocalMessage | undefined): string {
  if (!m) return 'Message';
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

export function ReplyQuoteBlock({ convId, replyToMessageId }: Props) {
  const messages = useChats((s) => s.messages[convId]);
  const senders = useChats((s) => s.senderUserByMsgId);
  const target = messages?.find((m) => m.id === replyToMessageId);
  const senderInfo = senders[replyToMessageId];
  const senderLabel =
    senderInfo?.displayName ||
    senderInfo?.handle ||
    (target?.senderId ? `${target.senderId.slice(0, 6)}…` : 'unknown');

  function jump() {
    const el = document.querySelector<HTMLElement>(
      `[data-msg-id="${CSS.escape(replyToMessageId)}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    useChats.getState().pulseMessage(replyToMessageId);
  }

  return (
    <button
      type="button"
      onClick={jump}
      className="w-full max-w-full text-left mb-1 rounded-md bg-raised/50 hover:bg-raised transition-colors px-2 py-1 flex items-stretch gap-2 cursor-pointer"
    >
      <div className="w-[2px] bg-ember shrink-0 rounded-full" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-ember truncate">
          {senderLabel}
        </div>
        <div className="text-[12px] text-ink-2 truncate">{previewOf(target)}</div>
      </div>
    </button>
  );
}
