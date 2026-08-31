import { Pencil } from 'lucide-react';
import type { ChatRenameControls } from '../hooks/useChatRename';

/**
 * The two places a chat title is renamed inline: a row in the chat history
 * sidebar, and the header above the message list. Only the styling differs.
 */
const VARIANTS = {
  sidebar: {
    input:
      'text-sm font-medium text-gray-900 bg-transparent border-b border-indigo-400 outline-none w-full pr-7',
    wrapper: 'flex items-center gap-1 pr-7',
    title: 'text-sm font-medium text-gray-900 truncate',
    button:
      'opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-200 shrink-0',
  },
  header: {
    input:
      'text-sm font-medium text-[#364153] leading-5 tracking-[-0.015em] bg-transparent border-b border-indigo-400 outline-none min-w-0 w-full max-w-xs',
    // `contents` keeps the title and pencil as direct flex children of the header row.
    wrapper: 'contents',
    title: 'text-sm font-medium text-[#364153] leading-5 tracking-[-0.015em] truncate',
    button:
      'opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-100 shrink-0',
  },
} as const;

interface EditableChatTitleProps {
  /** The title to display when not editing. */
  title: string;
  /** True when this title is the one being edited. */
  isEditing: boolean;
  rename: ChatRenameControls;
  onStartEditing: () => void;
  variant: keyof typeof VARIANTS;
  /** Hides the rename affordance (the header has no chat to rename yet). */
  canRename?: boolean;
  /** Keeps clicks from reaching a clickable ancestor, e.g. the sidebar row. */
  stopPropagation?: boolean;
}

export function EditableChatTitle({
  title,
  isEditing,
  rename,
  onStartEditing,
  variant,
  canRename = true,
  stopPropagation = false,
}: EditableChatTitleProps) {
  const styles = VARIANTS[variant];

  if (isEditing) {
    return (
      <input
        autoFocus
        value={rename.editingTitle}
        onChange={(e) => rename.setEditingTitle(e.target.value)}
        onBlur={rename.save}
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') rename.save();
          if (e.key === 'Escape') rename.cancel();
        }}
        className={styles.input}
      />
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.title}>{title}</p>
      {canRename && (
        <button
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            onStartEditing();
          }}
          className={styles.button}
          aria-label="Rename chat"
        >
          <Pencil className="h-4 w-4 text-gray-400" />
        </button>
      )}
    </div>
  );
}
