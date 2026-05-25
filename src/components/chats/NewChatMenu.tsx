type Kind = 'dm' | 'group' | 'channel';

export function NewChatMenu({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (kind: Kind) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-hidden
        className="fixed inset-0 z-10 cursor-default"
        onClick={onClose}
      />
      <div
        role="menu"
        className="absolute z-20 right-0 top-10 w-48 bg-bg border border-line shadow-lg py-1 text-sm"
      >
        <button
          type="button"
          onClick={() => onPick('dm')}
          className="block w-full text-left px-3 py-2 text-ink-2 hover:text-ember hover:bg-raised"
        >
          New DM
        </button>
        <button
          type="button"
          onClick={() => onPick('group')}
          className="block w-full text-left px-3 py-2 text-ink-2 hover:text-ember hover:bg-raised"
        >
          New group
        </button>
        <button
          type="button"
          onClick={() => onPick('channel')}
          className="block w-full text-left px-3 py-2 text-ink-2 hover:text-ember hover:bg-raised"
        >
          New channel
        </button>
      </div>
    </>
  );
}
