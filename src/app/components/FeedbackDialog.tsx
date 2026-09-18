import { useState } from 'react';
import { toast } from 'sonner';
import { useChat } from '../context/ChatProvider';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Free-text feedback on the current chat, submitted through the chat context. */
export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { submitFeedback } = useChat();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await submitFeedback(text.trim());
      setText('');
      onOpenChange(false);
      toast.success('Feedback submitted successfully!', {
        description: 'Thank you for helping us improve Syllabi.',
      });
    } catch {
      toast.error('Failed to submit feedback.', {
        description: 'Please try again in a moment.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl shadow-lg max-w-[510px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[18px] font-semibold tracking-tight">
            Submit Feedback
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-gray-500 leading-5">
            Let us know if you encountered a bug or have any feedback about your experience.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe what happened..."
          className="h-[120px] resize-none rounded-[10px] bg-[#f3f3f5] border-0 shadow-[0_0_0_1.23px_rgba(161,161,161,0.21)] text-[14px] placeholder:text-gray-400"
        />
        <AlertDialogFooter>
          <AlertDialogCancel
            className="rounded-[10px] border border-black/10 text-[14px] font-medium"
            onClick={() => setText('')}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-[14px] font-medium px-4"
          >
            Submit Feedback
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
