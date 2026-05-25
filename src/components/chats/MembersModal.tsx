// Modal listing the members of a group/channel. Opens when the user clicks
// the conversation title/avatar. Roles are shown as small mono badges next
// to each member's handle.

import { useEffect, useState } from 'react';
import type { Member } from '@racass-pixel/quick-protocol';
import { messagingClient } from '../../api/messaging';
import { Avatar } from '../primitives/Avatar';
import { Kicker } from '../primitives/Kicker';

export function MembersModal({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-bg/80 pt-20 px-4">
      <button
        type="button"
        aria-hidden
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative bg-bg border border-line w-full max-w-md shadow-lg">
        <div className="px-5 pt-5 pb-3 border-b border-line flex items-center justify-between">
          <Kicker className="mb-0">
            members{members ? ` · ${members.length}` : ''}
          </Kicker>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 text-xs font-mono hover:text-ember"
          >
            close
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
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
                    <Avatar
                      displayName={u.displayName}
                      color={u.avatarColor}
                      size={36}
                    />
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
      </div>
    </div>
  );
}
