export function NewGroupModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80">
      <div className="bg-bg border border-line p-6 w-full max-w-md">
        <div className="text-ink-1 mb-4">New group (coming)</div>
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
