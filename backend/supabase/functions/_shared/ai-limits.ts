// SYL-29: the single place to tune the AI cost controls.
//
// Every value can be overridden per environment via env vars so the contract
// tests can exercise the limits with tiny values. The daily limits are chosen
// so a heavy legitimate user never notices them; they exist to stop one
// account (or one bug) from running up the Anthropic bill.

/** Parse a positive integer from the environment, falling back if unset/invalid. */
export function intFromEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Per-user requests per UTC day, keyed by endpoint name. */
export const AI_DAILY_LIMITS: Record<string, number> = {
  "chat": intFromEnv("AI_DAILY_LIMIT_CHAT", 100),
  "process-syllabus": intFromEnv("AI_DAILY_LIMIT_PROCESS_SYLLABUS", 25),
  // detect-syllabi-info consumes one unit per file, not per request.
  "detect-syllabi-info": intFromEnv("AI_DAILY_LIMIT_DETECT_SYLLABI_INFO", 50),
  "find-canvas-syllabus": intFromEnv("AI_DAILY_LIMIT_FIND_CANVAS_SYLLABUS", 25),
  "match-canvas-assignments": intFromEnv("AI_DAILY_LIMIT_MATCH_CANVAS_ASSIGNMENTS", 25),
};

/**
 * Largest syllabus file forwarded to Claude, in bytes. Anything bigger is
 * rejected before the model call (the Claude API itself caps PDFs at 32 MB).
 * tests/contract/.env.contract shrinks this to 1024 for the size-cap tests.
 */
export const MAX_SYLLABUS_BYTES = intFromEnv("MAX_SYLLABUS_BYTES", 20 * 1024 * 1024);
