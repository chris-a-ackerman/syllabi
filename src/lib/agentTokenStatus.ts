import { formatDistance } from 'date-fns';
import type { AgentToken } from './types';

export type AgentTokenStatus = 'active' | 'expired' | 'revoked';

type TokenTimes = Pick<AgentToken, 'expires_at' | 'revoked_at'>;

/** Revoked wins over expired: revocation is the deliberate, permanent act. */
export function agentTokenStatus(token: TokenTimes, now: Date = new Date()): AgentTokenStatus {
  if (token.revoked_at) return 'revoked';
  // Same boundary as resolveCaller / create-agent-token: live while expires_at > now.
  return new Date(token.expires_at).getTime() > now.getTime() ? 'active' : 'expired';
}

/** "Expires in 12 days" / "Expired 3 days ago". */
export function agentTokenExpiryLabel(
  token: Pick<AgentToken, 'expires_at'>,
  now: Date = new Date()
) {
  const expiresAt = new Date(token.expires_at);
  const distance = formatDistance(expiresAt, now);
  return expiresAt.getTime() > now.getTime() ? `Expires in ${distance}` : `Expired ${distance} ago`;
}

/** Split into active and inactive (revoked or expired) groups, newest first. */
export function groupAgentTokens<T extends TokenTimes & Pick<AgentToken, 'created_at'>>(
  tokens: T[],
  now: Date = new Date()
) {
  const newestFirst = [...tokens].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return {
    active: newestFirst.filter((t) => agentTokenStatus(t, now) === 'active'),
    inactive: newestFirst.filter((t) => agentTokenStatus(t, now) !== 'active'),
  };
}
