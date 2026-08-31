import { useCallback, useState } from 'react';
import { useChat } from '../context/ChatProvider';

export interface ChatRenameControls {
  /** The chat currently being renamed, or null when no rename is in progress. */
  editingChatId: string | null;
  /** The in-progress title text. */
  editingTitle: string;
  setEditingTitle: (title: string) => void;
  startEditing: (chatId: string, currentTitle: string) => void;
  /** Commits a non-empty title and closes the editor. */
  save: () => void;
  cancel: () => void;
}

/**
 * Inline chat-rename state.
 *
 * Lives above both chat panes because they share one editor: starting a rename
 * on the *current* chat from the history list opens the input in the chat
 * header, not in the list row.
 */
export function useChatRename(): ChatRenameControls {
  const { renameChat } = useChat();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const startEditing = useCallback((chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
  }, []);

  const save = useCallback(() => {
    if (editingChatId && editingTitle.trim()) {
      renameChat(editingChatId, editingTitle.trim());
    }
    setEditingChatId(null);
  }, [editingChatId, editingTitle, renameChat]);

  const cancel = useCallback(() => setEditingChatId(null), []);

  return { editingChatId, editingTitle, setEditingTitle, startEditing, save, cancel };
}
