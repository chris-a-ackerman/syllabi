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
  // SYL-72: shared across save-anthropic-key, test-anthropic-key and
  // test-canvas-token — each makes one outbound validation call, so without a
  // limit the endpoint is a free key/token-validation oracle. delete-anthropic-key
  // makes no outbound call and is not rate-limited.
  "manage-api-keys": intFromEnv("AI_DAILY_LIMIT_MANAGE_API_KEYS", 20),
};

/**
 * Largest syllabus file forwarded to Claude, in bytes. Anything bigger is
 * rejected before the model call (the Claude API itself caps PDFs at 32 MB).
 * tests/contract/.env.contract shrinks this to 1024 for the size-cap tests.
 */
export const MAX_SYLLABUS_BYTES = intFromEnv("MAX_SYLLABUS_BYTES", 20 * 1024 * 1024);

/**
 * Longest PDF forwarded to Claude, in pages (Claude rejects long documents
 * outright). Checked with a cheap heuristic page count before the model call
 * — see process-syllabus/parse.ts#countPdfPagesHeuristic for why it's a
 * heuristic, not an exact count.
 */
export const MAX_SYLLABUS_PAGES = intFromEnv("MAX_SYLLABUS_PAGES", 100);

/**
 * SYL-67: cross-user daily cap on ALL AI endpoint calls combined (every
 * endpoint, every user, summed). The per-endpoint limits above only bound one
 * user at a time — this is the backstop against total spend growing
 * unboundedly with the user base (or a bug/compromised token hitting many
 * accounts). Consumed atomically alongside the per-user unit in the same
 * consume_ai_quota call, not as a separate enforceAiQuota endpoint — there is
 * no [endpoint] named "global" to configure per-call.
 */
export const AI_DAILY_LIMIT_GLOBAL = intFromEnv("AI_DAILY_LIMIT_GLOBAL", 2000);
