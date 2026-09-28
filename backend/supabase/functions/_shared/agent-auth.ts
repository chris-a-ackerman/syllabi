// SYL-92: who is calling — a user's session JWT, or a scoped agent token?
//
// Agent tokens are `syl_agent_<43 base64url chars>`, minted by
// create-agent-token and stored only as a sha256 hex digest in
// public.agent_tokens. They are read-only, carry explicit scopes, and expire
// (expires_at, fixed at creation); the agent never holds the user's password
// or a session JWT.
//
// SECURITY: a caller resolved via "agent_token" is served with the
// service-role client, where RLS does not apply. Every query a function makes
// for such a caller MUST filter on the returned userId explicitly
// (`.eq("user_id", userId)` on every table). Functions that use this helper
// apply that filter on the JWT path too, so there's one code path to review.
//
// No supabase-js import here on purpose: callers pass their clients in, which
// keeps this module unit-testable offline (tests/unit/agent-auth.test.ts).

export const AGENT_TOKEN_PREFIX = "syl_agent_";
const AGENT_TOKEN_RE = /^syl_agent_[A-Za-z0-9_-]{43}$/;

export type Caller =
  | { ok: true; userId: string; via: "jwt" | "agent_token"; tokenId?: string }
  | { ok: false };

// Structural types for the two clients — just the calls this module makes.
interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
export interface AgentTokenRow {
  id: string;
  user_id: string;
  scopes: string[];
  expires_at: string;
}
export interface TokenLookupClient {
  from(table: "agent_tokens"): {
    select(cols: string): {
      eq(col: string, val: string): {
        is(col: string, val: null): {
          maybeSingle(): PromiseLike<QueryResult<AgentTokenRow>>;
        };
      };
    };
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}
export interface JwtClient {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export interface ResolveDeps {
  /** Service-role client; used only for the hashed-token lookup. */
  service: TokenLookupClient;
  /** Builds an anon-key client carrying the caller's Authorization header. */
  jwtClient: (authHeader: string) => JwtClient;
  /** Clock override for tests; defaults to the real time. */
  now?: () => Date;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** sha256 hex of the raw token — the only form that is ever stored. */
export async function hashAgentToken(raw: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

/** `syl_agent_` + 32 CSPRNG bytes, base64url (43 chars). */
export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function bearerToken(authHeader: string | null): string | null {
  const m = authHeader?.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

/**
 * Resolve the caller for a function that accepts agent tokens.
 *
 * 1. `Bearer syl_agent_…` → sha256 → service-role lookup of a live row
 *    (revoked_at IS NULL, expires_at in the future) whose scopes include
 *    `requiredScope` → bump last_used_at → `{ via: "agent_token" }`.
 * 2. Any other bearer → the usual `auth.getUser()` JWT check → `{ via: "jwt" }`.
 * 3. Anything else — missing header, malformed/unknown/revoked/expired
 *    token, wrong scope, lookup error — is `{ ok: false }` (the handler
 *    answers 401).
 */
export async function resolveCaller(
  authHeader: string | null,
  requiredScope: string,
  deps: ResolveDeps
): Promise<Caller> {
  const token = bearerToken(authHeader);
  if (!token || !authHeader) return { ok: false };

  if (token.startsWith(AGENT_TOKEN_PREFIX)) {
    // Never fall through to the JWT path with something that looks like an
    // agent token — it either resolves as one or it's rejected.
    if (!AGENT_TOKEN_RE.test(token)) return { ok: false };
    const hash = await hashAgentToken(token);
    const { data, error } = await deps.service
      .from("agent_tokens")
      .select("id, user_id, scopes, expires_at")
      .eq("token_hash", hash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data) return { ok: false };
    if (!Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) return { ok: false };
    // Expired — or an unparseable timestamp, which fails closed (NaN > x is false).
    const now = (deps.now ?? (() => new Date()))();
    if (!(Date.parse(data.expires_at) > now.getTime())) return { ok: false };

    // Best effort: a failed timestamp write shouldn't fail the read.
    const { error: touchError } = await deps.service
      .from("agent_tokens")
      .update({ last_used_at: now.toISOString() })
      .eq("id", data.id);
    if (touchError) console.error("agent-auth: last_used_at update failed:", touchError.message);

    return { ok: true, userId: data.user_id, via: "agent_token", tokenId: data.id };
  }

  const { data, error } = await deps.jwtClient(authHeader).auth.getUser();
  if (error || !data?.user) return { ok: false };
  return { ok: true, userId: data.user.id, via: "jwt" };
}
