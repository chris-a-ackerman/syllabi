import { useState } from 'react';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { useChat } from '../context/ChatProvider';
import { EditableChatTitle } from './EditableChatTitle';
import type { ChatRenameControls } from '../hooks/useChatRename';

interface ChatHistoryListProps {
  rename: ChatRenameControls;
  /** Called after a chat is selected or started, so the mobile drawer can close. */
  onChatOpened?: () => void;
}

/** The chat-history sidebar: past conversations, inline rename, delete, new chat. */
export function ChatHistoryList({ rename, onChatOpened }: ChatHistoryListProps) {
  const { chats, currentChatId, selectChat, deleteChat, startNewChat } = useChat();
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-medium text-[#364153] mb-1.5">Chat History</h3>
        <p className="text-xs text-[#6a7282]">Your previous conversations will appear here</p>
      </div>

      <div className="flex flex-col gap-2">
        {chats.length === 0 && (
          <p className="text-xs text-[#99a1af] text-center py-4">No chats yet</p>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group relative w-full border rounded-[10px] p-3 text-left transition-colors cursor-pointer ${
              chat.id === currentChatId
                ? 'bg-indigo-50 border-[#a3b3ff]'
                : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => {
              if (rename.editingChatId !== chat.id) {
                selectChat(chat.id);
                onChatOpened?.();
              }
            }}
          >
            <EditableChatTitle
              variant="sidebar"
              stopPropagation
              title={chat.title ?? 'Chat'}
              // Renaming the open chat is handled by the chat header's editor.
              isEditing={rename.editingChatId === chat.id && chat.id !== currentChatId}
              rename={rename}
              onStartEditing={() => rename.startEditing(chat.id, chat.title ?? 'Chat')}
            />
            <p className="text-xs text-[#99a1af] mt-1">
              {format(parseISO(chat.createdAt), 'MMM d, h:mm a')}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setChatToDelete(chat.id);
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-50"
              aria-label="Delete chat"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-6">
        <button
          onClick={startNewChat}
          className="w-full bg-white border border-black/10 rounded-[10px] h-8 flex items-center gap-2 px-2.5 hover:bg-gray-50 transition-colors"
        >
          <Plus className="h-4 w-4 text-gray-900" />
          <span className="text-sm font-medium text-gray-900">New Chat</span>
        </button>
      </div>

      <ConfirmDeleteDialog
        open={chatToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setChatToDelete(null);
        }}
        title="Delete this chat?"
        description="This action cannot be undone. This chat will be permanently deleted from your chat history forever."
        confirmLabel="Delete Forever"
        onConfirm={() => {
          if (chatToDelete) deleteChat(chatToDelete);
        }}
      />
    </div>
  );
}
