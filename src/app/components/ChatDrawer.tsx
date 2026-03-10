import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { X, Send } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SUGGESTED_PROMPTS = [
  "What's due this week?",
  "What's my exam schedule?",
  "Can I miss class on Thursday?",
  "What's the late policy for my courses?",
];

export function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const { chatMessages, addChatMessage, aiEnabled, semesters } = useApp();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSemester = semesters.find(s => s.isActive);

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, open]);

  const handleSend = () => {
    if (!input.trim() || !aiEnabled) return;
    
    addChatMessage({
      role: 'user',
      content: input,
    });
    
    setInput('');
  };

  const handlePromptClick = (prompt: string) => {
    addChatMessage({
      role: 'user',
      content: prompt,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md p-0 flex flex-col rounded-l-2xl"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle>Ask about your courses</SheetTitle>
              {activeSemester && (
                <p className="text-sm text-gray-500 mt-1">{activeSemester.name}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="rounded-lg -mr-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {!aiEnabled && (
          <Alert className="mx-6 mt-4 bg-red-50 border-red-200 rounded-lg">
            <AlertDescription className="text-sm text-red-800">
              AI features are temporarily unavailable. Please check back soon.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {chatMessages.length === 0 && aiEnabled && (
            <div className="space-y-3 pt-4">
              <p className="text-sm text-gray-600 mb-4">Try asking:</p>
              {SUGGESTED_PROMPTS.map((prompt, index) => (
                <button
                  key={index}
                  onClick={() => handlePromptClick(prompt)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-sm"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {chatMessages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-200'
                }`}
              >
                {message.role === 'assistant' ? (
                  <div className="text-sm">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-semibold mt-1 mb-0.5">{children}</h3>,
                        p: ({ children }) => <p className="my-1">{children}</p>,
                        ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="leading-snug">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        code: ({ children }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                        hr: () => <hr className="my-2 border-gray-200" />,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                )}
                <p
                  className={`text-xs mt-1 ${
                    message.role === 'user' ? 'text-indigo-200' : 'text-gray-500'
                  }`}
                >
                  {format(new Date(message.timestamp), 'h:mm a')}
                </p>
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {aiEnabled && (
          <div className="border-t px-6 py-4">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask a question..."
                className="rounded-full"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim()}
                className="rounded-full bg-indigo-600 hover:bg-indigo-700"
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}