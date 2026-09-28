import { describe, it, expect } from 'vitest';
import { agentTokenStatus, agentTokenExpiryLabel, groupAgentTokens } from './agentTokenStatus';

const NOW = new Date('2026-09-27T12:00:00Z');
const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();

describe('agentTokenStatus', () => {
  it('is active while unrevoked and expires_at is in the future', () => {
    expect(agentTokenStatus({ expires_at: at(12), revoked_at: null }, NOW)).toBe('active');
  });

  it('is expired once expires_at has passed', () => {
    expect(agentTokenStatus({ expires_at: at(-3), revoked_at: null }, NOW)).toBe('expired');
  });

  it('is expired exactly at expires_at (resolveCaller requires expires_at > now)', () => {
    expect(agentTokenStatus({ expires_at: NOW.toISOString(), revoked_at: null }, NOW)).toBe(
      'expired'
    );
  });

  it('is revoked when revoked_at is set, even if it has also expired', () => {
    expect(agentTokenStatus({ expires_at: at(5), revoked_at: at(-1) }, NOW)).toBe('revoked');
    expect(agentTokenStatus({ expires_at: at(-5), revoked_at: at(-10) }, NOW)).toBe('revoked');
  });
});

describe('agentTokenExpiryLabel', () => {
  it('counts down to a future expiry', () => {
    expect(agentTokenExpiryLabel({ expires_at: at(12) }, NOW)).toBe('Expires in 12 days');
  });

  it('counts up from a past expiry', () => {
    expect(agentTokenExpiryLabel({ expires_at: at(-3) }, NOW)).toBe('Expired 3 days ago');
  });
});

describe('groupAgentTokens', () => {
  it('puts live tokens in active and revoked/expired ones in inactive, newest first', () => {
    const tokens = [
      { id: 'old-active', created_at: at(-20), expires_at: at(10), revoked_at: null },
      { id: 'revoked', created_at: at(-5), expires_at: at(25), revoked_at: at(-1) },
      { id: 'new-active', created_at: at(-1), expires_at: at(29), revoked_at: null },
      { id: 'expired', created_at: at(-40), expires_at: at(-10), revoked_at: null },
    ];
    const { active, inactive } = groupAgentTokens(tokens, NOW);
    expect(active.map((t) => t.id)).toEqual(['new-active', 'old-active']);
    expect(inactive.map((t) => t.id)).toEqual(['revoked', 'expired']);
  });

  it('does not reorder the caller array', () => {
    const tokens = [
      { id: 'a', created_at: at(-2), expires_at: at(5), revoked_at: null },
      { id: 'b', created_at: at(-1), expires_at: at(5), revoked_at: null },
    ];
    groupAgentTokens(tokens, NOW);
    expect(tokens.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
