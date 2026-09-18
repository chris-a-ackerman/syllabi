import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import type {
  ApiKeyStatus,
  SaveAnthropicKeyResult,
  TestAnthropicKeyResult,
  TestCanvasTokenResult,
} from '@/lib/types';

// Data access for the Settings page (SYL-72): the Claude API key card and
// the Canvas card's "Test connection" button. Save/delete-canvas-token stay
// in lib/api/canvas.ts — out of scope to move this pass.

export async function fetchApiKeyStatus() {
  const { data, error } = await supabase
    .from('profiles_safe')
    .select(
      'has_canvas_connected, canvas_base_url, canvas_token_last_tested_at, canvas_token_last_test_ok, ' +
        'has_anthropic_key, anthropic_key_last4, anthropic_key_added_at, anthropic_key_last_tested_at, anthropic_key_last_test_ok'
    )
    .single();
  return { data: data as ApiKeyStatus | null, error };
}

/**
 * The four key-management functions are plain POST functions but are fetched
 * directly (rather than through supabase.functions.invoke) so the caller can
 * read the `{ error }` body Supabase sends back on a non-2xx response —
 * invoke() discards it. Mirrors lib/api/canvas.ts's postCanvasFunction. Never
 * throws: failures come back as `{ data: null, error }`.
 */
async function postFunction<T>(path: string, body?: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { data: null, error: { message: 'Not signed in' } };

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { data: null, error: { message: 'Unexpected error. Please try again.' } };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { data: null, error: { message: json?.error ?? `${path} failed (${res.status})` } };
  }
  return { data: json as T, error: null };
}

export async function saveAnthropicKey(key: string) {
  return postFunction<SaveAnthropicKeyResult>('save-anthropic-key', { key });
}

export async function deleteAnthropicKey() {
  return postFunction<{ ok: true }>('delete-anthropic-key');
}

export async function testAnthropicKey() {
  return postFunction<TestAnthropicKeyResult>('test-anthropic-key');
}

export async function testCanvasToken() {
  return postFunction<TestCanvasTokenResult>('test-canvas-token');
}
