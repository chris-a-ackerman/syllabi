import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Flag, MessageSquare, Send, Settings2 } from 'lucide-react';
import type { Course, Semester } from '@/lib/types';
import { useAuth } from '../context/AuthProvider';
import { useData } from '../context/DataProvider';
import { useChat } from '../context/ChatProvider';
import { useSettings } from '../context/SettingsProvider';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { DeadlineUrgencyBanner } from './DeadlineUrgencyBanner';
import { EditableChatTitle } from './EditableChatTitle';
import { FeedbackDialog } from './FeedbackDialog';
import type { ChatRenameControls } from '../hooks/useChatRename';

const SUGGESTED_PROMPTS = [
  "What's due this week?",
  "What's my exam schedule?",
  'Can I miss class on Thursday?',
  "What's the late policy for my courses?",
  'When are office hours?',
  'What assignments can I drop?',
];

interface ChatPanelProps {
  activeSemester?: Semester;
  activeCourses: Course[];
  selectedCourses: string[];
  rename: ChatRenameControls;
  /** Opens the knowledge-base sidebar from the "no courses selected" prompt. */
  onConfigureKnowledgeBase: () => void;
}

/** The chat surface: title header, message list, and composer. */
export function ChatPanel({
  activeSemester,
  activeCourses,
  selectedCourses,
  rename,
  onConfigureKnowledgeBase,
}: ChatPanelProps) {
  const { user } = useAuth();
  const { events } = useData();
  const { chats, currentChatId, chatMessages, addChatMessage } = useChat();
  const { aiEnabled } = useSettings();

  const [input, setInput] = useState('');
  const [activeChatCollapsed, setActiveChatCollapsed] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentChat = chats.find((c) => c.id === currentChatId);
  const chatCourseIds = currentChat ? currentChat.courseIds : selectedCourses;
  const selectedCourseObjects = activeCourses.filter((c) => chatCourseIds.includes(c.id));
  const isTyping = chatMessages[chatMessages.length - 1]?.role === 'user';
  const composerDisabled = !aiEnabled || (!currentChatId && selectedCourses.length === 0);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const sendMessage = (content: string) => {
    if (!activeSemester) return;
    addChatMessage(
      { role: 'user', content },
      currentChatId ? undefined : { semesterId: activeSemester.id, courseIds: selectedCourses },
    );
  };

  const handleSend = () => {
    if (!input.trim() || !aiEnabled) return;
    sendMessage(input);
    setInput('');
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Chat Header */}
      <div className="border-b border-[#e5e7eb] pt-4 pb-3 px-7 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="group flex items-center gap-1.5 min-w-0">
            <EditableChatTitle
              variant="header"
              title={currentChat?.title ?? 'New Chat'}
              isEditing={rename.editingChatId !== null && rename.editingChatId === currentChatId}
              canRename={Boolean(currentChat)}
              rename={rename}
              onStartEditing={() =>
                rename.startEditing(currentChatId!, currentChat?.title ?? 'New Chat')
              }
            />
          </div>
          {selectedCourseObjects.length > 0 && (
            <button
              onClick={() => setActiveChatCollapsed((v) => !v)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={activeChatCollapsed ? 'Expand active chat' : 'Collapse active chat'}
            >
              {activeChatCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
        {!activeChatCollapsed && selectedCourseObjects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedCourseObjects.map((course) => (
              <div
                key={course.id}
                className="inline-flex items-center gap-2 border border-[#e5e7eb] rounded-full px-3.5 py-0.5"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: course.color }}
                />
                <span className="text-sm font-medium text-[#101828] tracking-[-0.015em]">
                  {course.code}
                </span>
                <span className="text-sm text-[#6a7282]">·</span>
                <span className="text-sm text-[#4a5565] tracking-[-0.015em]">{course.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <DeadlineUrgencyBanner
            events={events.filter((e) => activeCourses.some((c) => c.id === e.courseId))}
            courses={activeCourses}
            activeSemesterId={activeSemester?.id}
          />

          {chatMessages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Hi {user?.displayName?.split(' ')[0]}! 👋
              </h2>
              <p className="text-gray-600 mb-8">
                I'm here to help you stay on top of your courses. Ask me anything about your syllabi!
              </p>

              {aiEnabled && selectedCourses.length > 0 && (
                <div className="max-w-2xl mx-auto">
                  <p className="text-sm text-gray-500 mb-4">Try asking:</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => sendMessage(prompt)}
                        className="text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-sm"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedCourses.length === 0 && (
                <div className="mt-8">
                  <Card className="max-w-md mx-auto p-6 rounded-2xl">
                    <p className="text-gray-600 mb-4">
                      Select courses from the knowledge base to get started
                    </p>
                    <Button
                      onClick={onConfigureKnowledgeBase}
                      className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                    >
                      <Settings2 className="mr-2 h-4 w-4" />
                      Configure Knowledge Base
                    </Button>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Chat Messages */}
          <div className="space-y-6">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                    message.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-table:w-full prose-th:text-left prose-th:font-semibold prose-td:align-top prose-blockquote:border-l-indigo-400 prose-blockquote:text-gray-600">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                  <p
                    className={`text-xs mt-2 ${
                      message.role === 'user' ? 'text-indigo-200' : 'text-gray-500'
                    }`}
                  >
                    {format(new Date(message.timestamp), 'h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {isTyping && (
            <div className="flex justify-start mt-6">
              <div className="bg-gray-100 rounded-2xl px-5 py-3 flex items-center gap-1">
                {[0, 200, 400].map((delay) => (
                  <div
                    key={delay}
                    className="w-2 h-2 bg-gray-400 rounded-full"
                    style={{ animation: `typingDot 1.2s ease-in-out ${delay}ms infinite` }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 px-6 py-4 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFeedbackOpen(true)}
              disabled={!currentChatId}
              className="shrink-0 rounded-full text-gray-400 hover:text-gray-600 h-12 w-12"
              title="Submit feedback"
            >
              <Flag className="h-4 w-4" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                !aiEnabled
                  ? 'AI is currently disabled'
                  : !currentChatId && selectedCourses.length === 0
                    ? 'Select courses to start chatting...'
                    : 'Ask a question about your courses...'
              }
              disabled={composerDisabled}
              className="rounded-full flex-1 px-6"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || composerDisabled}
              className="rounded-full bg-indigo-600 hover:bg-indigo-700 h-12 px-6"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
