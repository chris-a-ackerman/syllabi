// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYL-64: chat rename/delete used to await the lib/api call and discard its
// {error}, so a failed write silently applied the local state change anyway.
// This pins that both now reject and leave the chat list untouched.

const { fetchChats, fetchChatMessages, renameChat, deleteChat } = vi.hoisted(() => ({
  fetchChats: vi.fn(),
  fetchChatMessages: vi.fn(),
  renameChat: vi.fn(),
  deleteChat: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('./SettingsProvider', () => ({
  useSettings: () => ({ aiEnabled: true }),
}));

vi.mock('@/lib/api/chat', () => ({
  fetchChats,
  fetchChatMessages,
  renameChat,
  deleteChat,
  createChat: vi.fn(),
  linkChatCourses: vi.fn(),
  insertChatMessage: vi.fn(),
  insertChatFeedback: vi.fn(),
  sendChatQuery: vi.fn(),
}));

// Imported after the mocks above are declared — vi.mock calls are hoisted
// above this import by Vitest regardless of source order.
import { ChatProvider, useChat } from './ChatProvider';

const CHAT = {
  id: 'chat-1',
  semesterId: 'sem-1',
  title: 'Original title',
  courseIds: [],
  createdAt: '2026-09-01T00:00:00.000Z',
};

function renderChat() {
  return renderHook(() => useChat(), {
    wrapper: ({ children }) => <ChatProvider>{children}</ChatProvider>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchChats.mockResolvedValue({ data: [CHAT], error: null });
  fetchChatMessages.mockResolvedValue({ data: [], error: null });
});

describe('ChatProvider chat mutations (SYL-64)', () => {
  it('rejects and leaves the chat list untouched when renameChat fails', async () => {
    const boom = new Error('rename failed');
    renameChat.mockResolvedValue({ error: boom });

    const { result } = renderChat();
    await waitFor(() => expect(result.current.chats).toEqual([CHAT]));

    await act(async () => {
      await expect(result.current.renameChat('chat-1', 'New title')).rejects.toBe(boom);
    });

    expect(result.current.chats).toEqual([CHAT]);
  });

  it('rejects and leaves the chat list untouched when deleteChat fails', async () => {
    const boom = new Error('delete failed');
    deleteChat.mockResolvedValue({ error: boom });

    const { result } = renderChat();
    await waitFor(() => expect(result.current.chats).toEqual([CHAT]));

    await act(async () => {
      await expect(result.current.deleteChat('chat-1')).rejects.toBe(boom);
    });

    expect(result.current.chats).toEqual([CHAT]);
  });
});
