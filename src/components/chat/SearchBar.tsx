// In-chat search bar. Slides down from the conversation header when the
// magnifier in ChatThread is toggled on. Debounces queries (300ms) and calls
// SearchMessages scoped to the current conversation. Results render inline
// below the bar via SearchResults.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Message } from '@racass-pixel/quick-protocol';
import { messagingClient } from '../../api/messaging';
import { SearchResults } from './SearchResults';

type Props = {
  convId: string;
  onClose(): void;
};

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const LIMIT = 30;

export function SearchBar({ convId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const id = ++reqIdRef.current;
      try {
        const res = await messagingClient.searchMessages({
          query: q,
          conversationId: convId,
          limit: LIMIT,
          beforeId: '',
        });
        if (id !== reqIdRef.current) return;
        setHits(res.messages ?? []);
      } catch {
        if (id !== reqIdRef.current) return;
        setHits([]);
      } finally {
        if (id === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, convId]);

  function onKey(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      onClose();
    }
  }

  return (
    <div className="shrink-0 border-b border-line bg-bg">
      <div className="px-4 py-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search in this chat"
          className="flex-1 h-9 bg-raised text-ink-1 placeholder:text-ink-3 border border-transparent rounded-full px-4 focus:outline-none focus:border-ember transition-colors text-sm"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-1 hover:bg-raised transition-colors"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      {query.trim().length >= MIN_CHARS && (
        <div className="max-h-72 overflow-y-auto border-t border-line">
          <SearchResults
            query={query.trim()}
            hits={hits}
            loading={loading}
            scopedConvId={convId}
            onHitClick={onClose}
          />
        </div>
      )}
    </div>
  );
}
