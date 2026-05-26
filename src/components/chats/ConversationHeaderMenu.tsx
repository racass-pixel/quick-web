// "..." menu shown in the header of a group or channel conversation. Hosts:
//   - Pin / Unpin conversation
//   - Leave (members)  /  Delete for everyone (owners)
//
// "Delete for everyone" is owner-only and routes through the same
// DeleteConversationModal as the DM path but with the owner persona.

import { useState } from 'react';
import { LogOut, MoreVertical, Pin, PinOff, Trash2 } from 'lucide-react';
import { useChats } from '../../stores/useChats';
import { DeleteConversationModal } from './DeleteConversationModal';

type Props = {
  conversationId: string;
  // 'group' | 'channel'
  convType: 'group' | 'channel';
  // 'owner' | 'admin' | 'member' | ''
  myRole: string;
};

export function ConversationHeaderMenu({
  conversationId,
  convType,
  myRole,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pendingPersona, setPendingPersona] = useState<
    null | 'leave' | 'delete'
  >(null);

  const pinned = useChats((s) => s.pinnedConvIds.has(conversationId));
  const togglePin = useChats((s) => s.togglePinnedConv);

  const isOwner = myRole === 'owner';

  async function handleTogglePin() {
    await togglePin(conversationId, !pinned);
    setOpen(false);
  }

  function handleLeave() {
    setOpen(false);
    setPendingPersona('leave');
  }

  function handleDelete() {
    setOpen(false);
    setPendingPersona('delete');
  }

  const persona =
    pendingPersona === 'delete'
      ? convType === 'channel'
        ? 'channel_owner'
        : 'group_owner'
      : convType === 'channel'
        ? 'channel_member'
        : 'group_member';

  const leaveLabel = convType === 'channel' ? 'Leave channel' : 'Leave group';
  const deleteLabel = convType === 'channel' ? 'Delete channel' : 'Delete group';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Conversation menu"
        onClick={() => setOpen((v) => !v)}
        className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ember hover:bg-raised transition-colors"
      >
        <MoreVertical size={20} strokeWidth={2} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute z-20 right-0 top-10 w-52 bg-panel border border-line shadow-lg rounded-md py-1 text-sm"
          >
            <button
              type="button"
              onClick={handleTogglePin}
              className="w-full flex items-center gap-2 px-3 py-2 text-ink-2 hover:text-ink-1 hover:bg-raised text-left"
            >
              {pinned ? <PinOff size={16} /> : <Pin size={16} />}
              {pinned ? 'Unpin conversation' : 'Pin conversation'}
            </button>
            <button
              type="button"
              onClick={handleLeave}
              className="w-full flex items-center gap-2 px-3 py-2 text-ink-2 hover:text-err hover:bg-raised text-left"
            >
              <LogOut size={16} />
              {leaveLabel}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-ink-2 hover:text-err hover:bg-raised text-left"
              >
                <Trash2 size={16} />
                {deleteLabel}
              </button>
            )}
          </div>
        </>
      )}
      {pendingPersona && (
        <DeleteConversationModal
          conversationId={conversationId}
          persona={persona}
          groupOrChannelLabel={convType}
          onClose={() => setPendingPersona(null)}
        />
      )}
    </div>
  );
}
