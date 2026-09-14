import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

import { isClaudeKeyRejected, toastClaudeKeyRejected } from './claudeKeyRejection';

afterEach(() => {
  vi.clearAllMocks();
});

describe('isClaudeKeyRejected', () => {
  it('is true for a FunctionsHttpError-shaped error whose body is claude_key_rejected', async () => {
    const error = { context: new Response(JSON.stringify({ error: 'claude_key_rejected' }), { status: 402 }) };
    expect(await isClaudeKeyRejected(error)).toBe(true);
  });

  it('is false for a FunctionsHttpError-shaped error with a different body', async () => {
    const error = { context: new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 }) };
    expect(await isClaudeKeyRejected(error)).toBe(false);
  });

  it('is true for a plain { code } shape (lib/api/syllabus.ts\'s re-thrown form)', async () => {
    expect(await isClaudeKeyRejected({ code: 'claude_key_rejected' })).toBe(true);
    expect(await isClaudeKeyRejected({ code: 'something_else' })).toBe(false);
  });

  it('is false for null, non-objects, and a non-JSON response body', async () => {
    expect(await isClaudeKeyRejected(null)).toBe(false);
    expect(await isClaudeKeyRejected(undefined)).toBe(false);
    expect(await isClaudeKeyRejected('claude_key_rejected')).toBe(false);
    expect(await isClaudeKeyRejected({ context: new Response('not json') })).toBe(false);
  });
});

describe('toastClaudeKeyRejected', () => {
  it('toasts once with an Open Settings action', () => {
    toastClaudeKeyRejected();
    expect(toastError).toHaveBeenCalledTimes(1);
    const [, opts] = toastError.mock.calls[0];
    expect(opts.action.label).toBe('Open Settings');
  });
});
