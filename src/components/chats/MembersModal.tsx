// "Group info" modal. Opens when the user clicks the conversation title or
// avatar in a group/channel header. Layout follows Telegram's group-profile
// card: a large avatar, the conversation title, a tappable member count, the
// full member list with roles, plus contextual actions (add members, leave
// group). The Leave action lives here too so the user has a single canonical
// "settings panel" for the conversation.
//
// Owner/admin extras: a small "+" button in the header opens an inline
// AddMembers panel that reuses UserMultiPicker. Submitting calls
// Messaging.addMembers and refreshes the list in place.

import { useEffect, useState } from 'react';
import type { Member, User } from '@racass-pixel/quick-protocol';
import { LogOut, Plus } from 'lucide-react';
import { messagingClient } from '../../api/messaging';
import { useChats } from '../../stores/useChats';
import { Avatar } from '../primitives/Avatar';
import { Button } from '../primitives/Button';
import { Kicker } from '../primitives/Kicker';
import { useProfile } from '../../stores/useProfile';
import { UserMultiPicker } from './UserMultiPicker';

export function MembersModal({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Pull the conversation snapshot for the header (avatar, title, type).
  const conv = useChats((s) => s.byId[conversationId]);
  const myRole = conv?.myRole ?? '';
  const canAdd = myRole === 'owner' || myRole === 'admin';
  const convLabel = conv?.type === 'channel' ? 'channel' : 'group';
  const headerTitle = conv?.title || (conv?.type === 'channel' ? 'Channel' : 'Group');
  const headerColor = conv?.avatarColor ?? '';

  // Pull list on mount + after a successful add so the user sees the new
  // members appear in the same modal.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await messagingClient.listMembers({ conversationId });
        if (cancelled) return;
        setMembers(r.members ?? []);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load members.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Filter the picker results so already-present members can't be added twice.
  const memberIds = new Set((members ?? []).map((m) => m.user?.id).filter(Boolean) as string[]);
  const pickedNew = picked.filter((u) => !memberIds.has(u.id));

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (pickedNew.length === 0 || submitting) return;
    setSubmitting(true);
    setAddError(null);
    try {
      await messagingClient.addMembers({
        conversationId,
        userIds: pickedNew.map((u) => u.id),
      });
      // Refetch — server-side validation may have rejected some entries
      // (private accounts, blocks etc.) so we trust the round trip.
      const r = await messagingClient.listMembers({ conversationId });
      setMembers(r.members ?? []);
      setPicked([]);
      setShowAdd(false);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Could not add members.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitLeave() {
    if (leaving) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await messagingClient.leaveConversation({ conversationId });
      // Drop the conv from the local store so the sidebar updates without
      // waiting for the WS conversation_removed roundtrip.
      useChats.setState((s) => {
        if (!s.byId[conversationId]) return s;
        const nextById = { ...s.byId };
        delete nextById[conversationId];
        const nextMessages = { ...s.messages };
        delete nextMessages[conversationId];
        return {
          byId: nextById,
          messages: nextMessages,
          conversationsOrder: s.conversationsOrder.filter((id) => id !== conversationId),
          activeConvId: s.activeConvId === conversationId ? null : s.activeConvId,
        };
      });
      onClose();
    } catch (e: unknown) {
      setLeaveError(e instanceof Error ? e.message : 'Could not leave.');
      setLeaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-bg/80 pt-12 px-4">
      <button
        type="button"
        aria-hidden
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative bg-bg border border-line w-full max-w-md shadow-lg flex flex-col max-h-[85vh]">
        {/* Top bar */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-line flex items-center justify-between">
          <Kicker className="mb-0">{convLabel} info</Kicker>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 text-xs font-mono hover:text-ember"
          >
            close
          </button>
        </div>

        {/* Identity block — big avatar, title, member count. */}
        <div className="shrink-0 flex flex-col items-center text-center px-5 pt-6 pb-5 border-b border-line">
          <Avatar displayName={headerTitle} color={headerColor} size={96} />
          <div className="mt-4 text-ink-1 text-xl tracking-tight">
            {headerTitle}
          </div>
          <div className="mt-1 text-ink-3 text-xs font-mono">
            {(members?.length ?? conv?.memberCount ?? 0)}{' '}
            {(members?.length ?? conv?.memberCount ?? 0) === 1 ? 'member' : 'members'}
          </div>
          {/* Edit name is unsupported on the backend today — surface a note
              for owners/admins so they know it's not a missing UI. */}
          {canAdd && (
            <div className="mt-3 text-ink-3 text-[11px] font-mono">
              Renaming the {convLabel} isn't available yet.
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur px-5 py-2 border-b border-line flex items-center justify-between">
            <span className="kicker mb-0">
              members{members ? ` · ${members.length}` : ''}
            </span>
            {canAdd && !showAdd && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                aria-label="Add members"
                title="Add members"
                className="w-7 h-7 inline-flex items-center justify-center rounded-full text-ink-2 hover:text-ember hover:bg-raised transition-colors"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          {showAdd && (
            <form
              onSubmit={submitAdd}
              className="px-5 py-4 border-b border-line space-y-3 bg-raised/40"
            >
              <label className="kicker block">add members</label>
              <UserMultiPicker
                value={picked}
                onChange={setPicked}
                placeholder="Find by handle…"
              />
              {pickedNew.length !== picked.length && (
                <p className="text-ink-3 text-xs font-mono">
                  {picked.length - pickedNew.length} already in this conversation
                </p>
              )}
              {addError && (
                <p className="text-err text-xs font-mono" role="alert">
                  {addError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowAdd(false);
                    setPicked([]);
                    setAddError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pickedNew.length === 0 || submitting}>
                  {submitting
                    ? 'Adding…'
                    : `Add ${pickedNew.length || ''}`.trim()}
                </Button>
              </div>
            </form>
          )}

          {error && (
            <p className="px-5 py-4 text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
          {!members && !error && (
            <p className="px-5 py-4 text-ink-3 text-xs font-mono cursor-blink">
              loading
            </p>
          )}
          {members && members.length === 0 && (
            <p className="px-5 py-4 text-ink-3 text-sm">No members.</p>
          )}
          {members && members.length > 0 && (
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const u = m.user;
                if (!u) return null;
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <button
                      type="button"
                      aria-label={`Open profile for ${u.displayName}`}
                      onClick={() => useProfile.getState().open(u)}
                      className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      <Avatar
                        displayName={u.displayName}
                        color={u.avatarColor}
                        size={36}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-ink-1 text-sm truncate">
                        {u.displayName}
                      </div>
                      <div className="text-ink-3 text-xs font-mono truncate">
                        @{u.handle}
                      </div>
                    </div>
                    {m.role && m.role !== 'member' && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-ember border border-line px-1.5 py-0.5">
                        {m.role}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer — leave control */}
        {myRole && (
          <div className="shrink-0 border-t border-line px-5 py-3">
            {confirmLeave ? (
              <div className="flex flex-col gap-2">
                <p className="text-ink-2 text-sm">
                  Leave this {convLabel}? You'll stop receiving messages.
                </p>
                {leaveError && (
                  <p className="text-err text-xs font-mono" role="alert">
                    {leaveError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setConfirmLeave(false);
                      setLeaveError(null);
                    }}
                    disabled={leaving}
                  >
                    Cancel
                  </Button>
                  <button
                    type="button"
                    onClick={() => void submitLeave()}
                    disabled={leaving}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-err text-err hover:bg-err hover:text-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <LogOut size={14} strokeWidth={2} />
                    {leaving ? 'Leaving…' : `Leave ${convLabel}`}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm text-err hover:bg-raised transition-colors"
              >
                <LogOut size={14} strokeWidth={2} />
                Leave {convLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
