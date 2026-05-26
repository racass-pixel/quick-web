// Modal for picking a target conversation to forward a message to. Shows
// the caller's existing conversations with a fast client-side filter on top.
// Clicking a row fires ForwardMessage and shows a brief toast confirmation.

import { useMemo, useState } from 'react';
import { X, Search, Forward as ForwardIcon } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import { useChats } from '../../stores/useChats';

type Props = {
  sourceMessageId: string;
  // Conv id the source message lives in — excluded from the destination list
  // since forwarding to the same conv is a no-op in TG.
  sourceConvId?: string;
  onClose(): void;
  onDone?(targetName: string): void;
};

export function ForwardModal({ sourceMessageId, sourceConvId, onClose, onDone }: Props) {
  const order = useChats((s) => s.conversationsOrder);
  const byId = useChats((s) => s.byId);
  const forwardMessage = useChats((s) => s.forwardMessage);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return order
      .filter((id) => id !== sourceConvId)
      .map((id) => byId[id])
      .filter((c) => {
        if (!c) return false;
        if (!q) return true;
        const name = (c.peer?.displayName || c.title || '').toLowerCase();
        const handle = (c.peer?.handle || '').toLowerCase();
        return name.includes(q) || handle.includes(q);
      });
  }, [order, byId, query, sourceConvId]);

  async function pick(convId: string, name: string) {
    if (busyId) return;
    setBusyId(convId);
    setError(null);
    try {
      await forwardMessage(sourceMessageId, convId);
      onDone?.(name);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Forward failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-full max-h-[80vh] bg-panel border border-line rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Forward to"
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
          <ForwardIcon size={18} className="text-ember" strokeWidth={2} />
          <h2 className="text-ink-1 text-sm font-medium flex-1">Forward to…</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-1 hover:bg-raised transition-colors"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="px-3 py-2 border-b border-line shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
              strokeWidth={2}
            />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full h-9 bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent rounded-full pl-8 pr-3 focus:outline-none focus:border-ember transition-colors text-sm"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="p-6 text-ink-3 text-sm text-center">No matches.</div>
          ) : (
            <ul className="py-1">
              {candidates.map((c) => {
                if (!c) return null;
                const name = c.peer?.displayName || c.title || 'Conversation';
                const color = c.peer?.avatarColor || c.avatarColor || '';
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void pick(c.id, name)}
                      disabled={busyId !== null}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-raised text-left disabled:opacity-50 transition-colors"
                    >
                      <Avatar displayName={name} color={color} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ink-1 text-sm truncate">{name}</div>
                        {c.peer?.handle && (
                          <div className="text-ink-3 text-[12px] font-mono truncate">
                            @{c.peer.handle}
                          </div>
                        )}
                      </div>
                      {busyId === c.id && (
                        <span className="text-[11px] font-mono text-ember">…</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error && (
          <div className="px-4 py-2 border-t border-line text-err text-xs font-mono">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
