import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import * as chatApi from '@/lib/api/chat';
import type { Chat, ChatMessage } from '@/lib/types';

interface ChatState {
  chats: Chat[];
  currentChatId: string | null;
  chatMessages: ChatMessage[];
  aiEnabled: boolean;
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>, context?: { semesterId: string; courseIds: string[] }) => void;
  startNewChat: () => void;
  selectChat: (chatId: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  setAiEnabled: (enabled: boolean) => void;
  submitFeedback: (description: string) => Promise<void>;
}

const ChatContext = createContext<ChatState | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // NOTE: client-local only — resets to true on reload, and the AdminPanel
  // toggle does not persist. The `chat` Edge Function enforces the real
  // `app_settings.ai_enabled` flag server-side. Carried over unchanged by
  // SYL-37; wiring it to the server flag is a behavior change, not a move.
  const [aiEnabled, setAiEnabled] = useState(true);

  // Load the user's chats, and the most recent conversation, on sign-in
  useEffect(() => {
    if (!user) {
      setChats([]);
      setCurrentChatId(null);
      setChatMessages([]);
      return;
    }

    const fetchChats = async () => {
      const { data: mappedChats, error: chatErr } = await chatApi.fetchChats();
      if (chatErr) console.error('Error fetching chats:', chatErr);
      setChats(mappedChats);

      if (mappedChats.length > 0) {
        const mostRecentId = mappedChats[0].id;
        setCurrentChatId(mostRecentId);
        const { data: messages } = await chatApi.fetchChatMessages(mostRecentId);
        setChatMessages(messages);
      }
    };

    fetchChats();
  }, [user?.id]);

  const addChatMessage = useCallback((
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
    context?: { semesterId: string; courseIds: string[] },
  ) => {
    // Capture conversation history before adding the new message
    const conversationHistory = chatMessages.map(m => ({ role: m.role, content: m.content }));
    const userSequence = chatMessages.length + 1;
    const tempId = `temp-${Date.now()}`;
    setChatMessages(prev => [...prev, { ...message, id: tempId, timestamp: new Date().toISOString(), sequence: userSequence }]);

    (async () => {
      let chatId = currentChatId;
      let semesterId = context?.semesterId;

      if (!chatId && user && context) {
        const { data: newChat, error: chatError } = await chatApi.createChat(
          user.id,
          context.semesterId,
          message.role === 'user' ? message.content.slice(0, 100) : null,
          context.courseIds,
        );

        if (chatError || !newChat) {
          console.error('[chat] Error creating chat record:', chatError);
          setChatMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: "Sorry, I couldn't start a new conversation. Please try again.",
            timestamp: new Date().toISOString(),
          }]);
          return;
        }

        chatId = newChat.id;
        setCurrentChatId(chatId);

        if (context.courseIds.length > 0) {
          await chatApi.linkChatCourses(newChat.id, context.courseIds);
        }

        setChats(prev => [newChat, ...prev]);
      }

      // For existing chats, look up semesterId from chats state
      if (!semesterId && chatId) {
        semesterId = chats.find(c => c.id === chatId)?.semesterId;
      }

      if (!chatId) return;

      const { data: userMessage, error: msgError } = await chatApi.insertChatMessage(
        chatId, userSequence, message.role, message.content,
      );

      if (msgError || !userMessage) {
        console.error('[chat] Error saving user message to DB:', msgError);
        return;
      }

      setChatMessages(prev => prev.map(m => m.id === tempId ? userMessage : m));

      if (message.role === 'user' && aiEnabled && semesterId) {
        const aiSequence = userSequence + 1;

        const courseIds = context?.courseIds ?? chats.find(c => c.id === chatId)?.courseIds ?? [];
        console.log('[chat] Calling edge function — semester_id:', semesterId, 'course_ids:', courseIds, 'history length:', conversationHistory.length);

        const { data: fnData, error: fnError } = await chatApi.sendChatQuery({
          message: message.content,
          semester_id: semesterId,
          conversation_history: conversationHistory,
          course_ids: courseIds,
        });

        const addErrorMessage = (text: string) => {
          setChatMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: text,
            timestamp: new Date().toISOString(),
            sequence: aiSequence,
          }]);
        };

        if (fnError) {
          console.error('[chat] Edge function invocation error:', fnError);
          addErrorMessage("Sorry, I couldn't reach the assistant. Please check your connection and try again.");
          return;
        }

        if (fnData?.error) {
          console.error('[chat] Edge function returned error:', fnData.error);
          const msg = fnData.error === 'AI features are disabled'
            ? 'AI features are currently disabled by your administrator.'
            : "Sorry, something went wrong on the server. Please try again in a moment.";
          addErrorMessage(msg);
          return;
        }

        console.log('[chat] Edge function response — query_type:', fnData?.query_type, 'reply length:', fnData?.reply?.length);

        const aiContent: string = fnData?.reply ?? '';

        if (!aiContent) {
          addErrorMessage("I received an empty response. Please try rephrasing your question.");
          return;
        }

        const { data: aiMessage, error: aiMsgError } = await chatApi.insertChatMessage(
          chatId, aiSequence, 'assistant', aiContent,
        );

        if (aiMsgError || !aiMessage) {
          console.error('[chat] Error saving AI message to DB:', aiMsgError);
          // Still show the reply to the user even if DB persistence fails
          setChatMessages(prev => [...prev, {
            id: `local-${Date.now()}`,
            role: 'assistant' as const,
            content: aiContent,
            timestamp: new Date().toISOString(),
            sequence: aiSequence,
          }]);
          return;
        }

        setChatMessages(prev => [...prev, aiMessage]);
      }
    })();
  }, [user, chats, chatMessages, currentChatId, aiEnabled]);

  const startNewChat = useCallback(() => {
    setCurrentChatId(null);
    setChatMessages([]);
  }, []);

  const selectChat = useCallback(async (chatId: string) => {
    setCurrentChatId(chatId);
    const { data, error } = await chatApi.fetchChatMessages(chatId);
    if (error) { console.error('Error fetching chat messages:', error); return; }
    setChatMessages(data);
  }, []);

  const deleteChat = useCallback(async (chatId: string) => {
    await chatApi.deleteChat(chatId);
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setChatMessages([]);
    }
  }, [currentChatId]);

  const renameChat = useCallback(async (chatId: string, title: string) => {
    await chatApi.renameChat(chatId, title);
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, title } : c));
  }, []);

  const submitFeedback = useCallback(async (description: string) => {
    if (!user || !currentChatId) return;

    const chat = chats.find(c => c.id === currentChatId);
    const lastMessage = chatMessages[chatMessages.length - 1];

    await chatApi.insertChatFeedback({
      userId: user.id,
      chatId: currentChatId,
      semesterId: chat?.semesterId ?? null,
      courseIds: chat?.courseIds ?? [],
      reportedAtSequence: lastMessage?.sequence ?? null,
      description,
      conversationSnapshot: chatMessages.map(m => ({
        role: m.role,
        content: m.content,
        sequence: m.sequence,
      })),
    });
  }, [user, chats, chatMessages, currentChatId]);

  const value = useMemo<ChatState>(() => ({
    chats,
    currentChatId,
    chatMessages,
    aiEnabled,
    addChatMessage,
    startNewChat,
    selectChat,
    deleteChat,
    renameChat,
    setAiEnabled,
    submitFeedback,
  }), [
    chats, currentChatId, chatMessages, aiEnabled,
    addChatMessage, startNewChat, selectChat, deleteChat, renameChat, submitFeedback,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
