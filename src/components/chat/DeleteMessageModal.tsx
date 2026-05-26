// Confirmation modal for deleting a single message. Two paths:
//   - "Delete for me"  — always available, hides the message locally for the
//     caller only.
//   - "Delete for everyone" — only when the caller is the sender within 48h
//     OR is an admin/owner of a group/channel; the caller computes the
//     `canDeleteForEveryone` flag and passes it in.
//
// On submit we call Messaging.DeleteMessage; the WS envelope echoed back will
// flip the local state. We close immediately on a successful RPC.

import { useState } from 'react';
import { messagingClient } from '../../api/messaging';

type Props = {
  messageId: string;
  canDeleteForEveryone: boolean;
  // Used in the confirm-button label. e.g. "in this chat" / "for everyone in
  // the group". Caller-supplied to keep wording consistent with the chat
  // header context.
  forEveryoneLabel?: string;
  onClose(): void;
};

export function DeleteMessageModal({
  messageId,
  canDeleteForEveryone,
  forEveryoneLabel = 'Delete for everyone',
  onClose,
}: Props) {
  const [forEveryone, setForEveryone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await messagingClient.deleteMessage({
        messageId,
        forEveryone,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-hidden
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-msg-title"
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] max-w-[90vw] bg-panel border border-line shadow-xl rounded-md p-5"
      >
        <h2
          id="delete-msg-title"
          className="text-ink-1 text-[16px] font-medium mb-1"
        >
          Delete message?
        </h2>
        <p className="text-ink-3 text-[13px] mb-4">
          This action cannot be undone.
        </p>
        {canDeleteForEveryone && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forEveryone}
              onChange={(e) => setForEveryone(e.target.checked)}
              className="accent-ember w-4 h-4"
            />
            <span className="text-ink-2 text-sm">{forEveryoneLabel}</span>
          </label>
        )}
        {error && (
          <p className="text-err text-xs font-mono mb-3" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-[12px] font-mono uppercase tracking-wider text-ink-2 px-3 py-1.5 border border-line hover:border-ember hover:text-ember transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="text-[12px] font-mono uppercase tracking-wider bg-err text-bg px-3 py-1.5 border border-err hover:bg-err/80 transition-colors disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </>
  );
}
