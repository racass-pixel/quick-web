// Confirmation modal for deleting (or leaving) a conversation. Three personas:
//
//   - DM:                checkbox «Also delete for {peer name}» (default OFF).
//   - Group/channel owner: checkbox «Delete for all members» (default OFF).
//   - Group/channel member: no checkbox, just confirm-leave.
//
// On success we navigate to /chats since the conversation is gone from our
// list. The server fan-out (`conversation_removed` envelope) will also remove
// it from the store optimistically.

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { messagingClient } from '../../api/messaging';

type Persona = 'dm' | 'group_owner' | 'group_member' | 'channel_owner' | 'channel_member';

type Props = {
  conversationId: string;
  persona: Persona;
  // Used in the "for everyone" checkbox label for DMs.
  peerName?: string;
  // 'group' | 'channel' — used in the title copy for non-DM personas.
  groupOrChannelLabel?: 'group' | 'channel';
  onClose(): void;
};

export function DeleteConversationModal({
  conversationId,
  persona,
  peerName,
  groupOrChannelLabel = 'group',
  onClose,
}: Props) {
  const navigate = useNavigate();
  const [forEveryone, setForEveryone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showCheckbox = persona === 'dm' || persona === 'group_owner' || persona === 'channel_owner';

  let title = 'Delete this chat?';
  let body = 'This action cannot be undone.';
  let checkboxLabel = '';
  let confirmLabel = 'Delete';
  if (persona === 'dm') {
    checkboxLabel = peerName
      ? `Also delete for ${peerName}`
      : 'Also delete for the other side';
  } else if (persona === 'group_owner' || persona === 'channel_owner') {
    title = `Delete this ${groupOrChannelLabel}?`;
    body = `You can either leave the ${groupOrChannelLabel}, or delete it for everyone.`;
    checkboxLabel = `Delete for all members`;
  } else {
    // member — leave only
    title = `Leave this ${groupOrChannelLabel}?`;
    body = `You'll stop receiving messages and your message history here is preserved for others.`;
    confirmLabel = 'Leave';
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await messagingClient.deleteConversation({
        conversationId,
        forEveryone: showCheckbox ? forEveryone : false,
      });
      onClose();
      navigate({ to: '/chats' });
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
        aria-labelledby="delete-conv-title"
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] max-w-[90vw] bg-panel border border-line shadow-xl rounded-md p-5"
      >
        <h2
          id="delete-conv-title"
          className="text-ink-1 text-[16px] font-medium mb-1"
        >
          {title}
        </h2>
        <p className="text-ink-3 text-[13px] mb-4">{body}</p>
        {showCheckbox && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forEveryone}
              onChange={(e) => setForEveryone(e.target.checked)}
              className="accent-ember w-4 h-4"
            />
            <span className="text-ink-2 text-sm">{checkboxLabel}</span>
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
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
