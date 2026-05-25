// Modal for creating a new broadcast channel. Title + subscriber picker. On
// submit, calls Messaging.createChannel and navigates to the new conversation.

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { User } from '@racass-pixel/quick-protocol';
import { messagingClient } from '../../api/messaging';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Kicker } from '../primitives/Kicker';
import { UserMultiPicker } from './UserMultiPicker';

export function NewChannelModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [subs, setSubs] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length >= 1 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await messagingClient.createChannel({
        title: title.trim(),
        subscriberUserIds: subs.map((u) => u.id),
      });
      const id = r.conversation?.id;
      if (!id) throw new Error('No conversation returned.');
      onClose();
      navigate({ to: '/chats/$id', params: { id } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create channel.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-bg/80 pt-20 px-4">
      <button
        type="button"
        aria-hidden
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <form
        onSubmit={submit}
        className="relative bg-bg border border-line w-full max-w-md shadow-lg"
      >
        <div className="px-5 pt-5 pb-3 border-b border-line flex items-center justify-between">
          <Kicker className="mb-0">new channel</Kicker>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 text-xs font-mono hover:text-ember"
          >
            close
          </button>
        </div>
        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="kicker block mb-2">title</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Product updates"
              maxLength={80}
            />
            <p className="text-ink-3 text-xs font-mono mt-1">
              Only admins can post; everyone else reads.
            </p>
          </div>
          <div>
            <label className="kicker block mb-2">subscribers (optional)</label>
            <UserMultiPicker
              value={subs}
              onChange={setSubs}
              placeholder="Add subscribers by handle…"
            />
            <p className="text-ink-3 text-xs font-mono mt-1">
              {subs.length} selected
            </p>
          </div>
          {error && (
            <p className="text-err text-xs font-mono" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="px-5 py-4 border-t border-line flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create channel'}
          </Button>
        </div>
      </form>
    </div>
  );
}
