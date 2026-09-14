import { toast } from 'sonner';

// SYL-72: the chat and upload flows all surface `claude_key_rejected`
// differently (some via supabase.functions.invoke's FunctionsHttpError,
// which carries the response as `.context`; lib/api/syllabus.ts's
// fire-and-forget upload path re-throws it as a plain `{ code }` since the
// original Response is discarded by the time its caller sees the error).
// This is the one place that knows how to recognize it either way, so the
// check isn't duplicated across ChatProvider, useBulkUpload,
// UploadSyllabusModal and useCanvasFlow.

const CLAUDE_KEY_REJECTED = 'claude_key_rejected';

/** True if `error` is (or carries) the claude_key_rejected error body. */
export async function isClaudeKeyRejected(error: unknown): Promise<boolean> {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error) {
    return (error as { code?: unknown }).code === CLAUDE_KEY_REJECTED;
  }
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return false;
  try {
    const body = await context.clone().json();
    return body?.error === CLAUDE_KEY_REJECTED;
  } catch {
    return false;
  }
}

/**
 * Toasts the standard "your Claude key was rejected" message with a shortcut
 * to Settings. A full navigation (not react-router's navigate) so this
 * module — used from lib/ and provider code alike — never has to import the
 * router.
 */
export function toastClaudeKeyRejected(): void {
  toast.error('Your Claude API key was rejected.', {
    description: 'Update it in Settings to keep using your own key.',
    action: {
      label: 'Open Settings',
      onClick: () => window.location.assign('/settings'),
    },
  });
}
