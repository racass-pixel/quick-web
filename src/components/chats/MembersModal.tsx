export function MembersModal({
  conversationId: _conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80">
      <div className="bg-bg border border-line p-6">
        <div className="text-ink-1 mb-3">Members (coming)</div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-3 text-xs font-mono hover:text-ember"
        >
          close
        </button>
      </div>
    </div>
  );
}
