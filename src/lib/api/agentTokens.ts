import { supabase } from '@/lib/supabase';
import { postFunction } from '@/lib/api/apiKeys';
import type { AgentToken, CreateAgentTokenResult } from '@/lib/types';

// Data access for the Settings "Agent access" card (SYL-104). Tokens are read
// from agent_tokens_safe (no hash column); minting and revoking go through the
// two edge functions so the raw token is generated and hashed server-side.

export async function listAgentTokens() {
  const { data, error } = await supabase
    .from('agent_tokens_safe')
    .select('id, label, scopes, created_at, expires_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false });
  return { data: (data ?? null) as AgentToken[] | null, error };
}

export async function createAgentToken({
  label,
  expiresInDays,
}: {
  label?: string;
  expiresInDays: number;
}) {
  return postFunction<CreateAgentTokenResult>('create-agent-token', {
    label: label?.trim() || undefined,
    expires_in_days: expiresInDays,
  });
}

export async function revokeAgentToken(id: string) {
  return postFunction<{ ok: true; id: string; revoked_at: string }>('revoke-agent-token', { id });
}
