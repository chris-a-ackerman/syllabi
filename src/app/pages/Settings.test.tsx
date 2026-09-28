// @vitest-environment jsdom
// SYL-72: renders both card states from a mocked lib/api/apiKeys, and
// asserts no key text ever appears in the DOM after a save.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ hash: '' }),
}));

const fetchApiKeyStatus = vi.fn();
const saveAnthropicKey = vi.fn();
const testAnthropicKey = vi.fn();
const deleteAnthropicKey = vi.fn();
const testCanvasToken = vi.fn();

vi.mock('@/lib/api/apiKeys', () => ({
  fetchApiKeyStatus: (...args: unknown[]) => fetchApiKeyStatus(...args),
  saveAnthropicKey: (...args: unknown[]) => saveAnthropicKey(...args),
  testAnthropicKey: (...args: unknown[]) => testAnthropicKey(...args),
  deleteAnthropicKey: (...args: unknown[]) => deleteAnthropicKey(...args),
  testCanvasToken: (...args: unknown[]) => testCanvasToken(...args),
}));

const saveCanvasToken = vi.fn();
const deleteCanvasToken = vi.fn();
vi.mock('@/lib/api/canvas', () => ({
  saveCanvasToken: (...args: unknown[]) => saveCanvasToken(...args),
  deleteCanvasToken: (...args: unknown[]) => deleteCanvasToken(...args),
}));

// SYL-104: the Agent access card loads its own list on mount.
const listAgentTokens = vi.fn();
const createAgentToken = vi.fn();
const revokeAgentToken = vi.fn();
listAgentTokens.mockResolvedValue({ data: [], error: null });
vi.mock('@/lib/api/agentTokens', () => ({
  listAgentTokens: (...args: unknown[]) => listAgentTokens(...args),
  createAgentToken: (...args: unknown[]) => createAgentToken(...args),
  revokeAgentToken: (...args: unknown[]) => revokeAgentToken(...args),
}));

const NOT_SET_STATUS = {
  has_canvas_connected: false,
  canvas_base_url: null,
  canvas_token_last_tested_at: null,
  canvas_token_last_test_ok: null,
  has_anthropic_key: false,
  anthropic_key_last4: null,
  anthropic_key_added_at: null,
  anthropic_key_last_tested_at: null,
  anthropic_key_last_test_ok: null,
};

const SET_STATUS = {
  has_canvas_connected: true,
  canvas_base_url: 'https://canvas.mit.edu',
  canvas_token_last_tested_at: '2026-09-01T00:00:00.000Z',
  canvas_token_last_test_ok: true,
  has_anthropic_key: true,
  anthropic_key_last4: '1234',
  anthropic_key_added_at: '2026-09-01T00:00:00.000Z',
  anthropic_key_last_tested_at: '2026-09-01T00:00:00.000Z',
  anthropic_key_last_test_ok: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Settings', () => {
  it('renders the not-set state for both cards', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: NOT_SET_STATUS, error: null });
    render(<Settings />);

    await waitFor(() => expect(screen.getByLabelText('API Key')).toBeTruthy());
    expect(screen.getByText(/bypasses the app's daily limits|don't count against/i)).toBeTruthy();
    expect(screen.getByText('Connect Canvas')).toBeTruthy();
  });

  it('renders the set state for both cards, with no key material shown', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: SET_STATUS, error: null });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('sk-ant-…1234')).toBeTruthy());
    expect(screen.getByText('Test')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
    expect(screen.getByText('Test connection')).toBeTruthy();
    expect(screen.getByText('Disconnect')).toBeTruthy();
  });

  it('never renders the raw key after a successful save', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: NOT_SET_STATUS, error: null });
    saveAnthropicKey.mockResolvedValue({ data: { ok: true, last4: '9999' }, error: null });
    render(<Settings />);

    const secretKey = 'sk-ant-super-secret-value-should-never-render';
    await waitFor(() => expect(screen.getByLabelText('API Key')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: secretKey } });
    fireEvent.click(screen.getByText('Save & verify'));

    await waitFor(() => expect(screen.getByText('sk-ant-…9999')).toBeTruthy());
    expect(screen.queryByDisplayValue(secretKey)).toBeNull();
    expect(document.body.textContent?.includes(secretKey)).toBe(false);
  });

  it('shows an inline error and stores nothing when Anthropic rejects the key', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: NOT_SET_STATUS, error: null });
    saveAnthropicKey.mockResolvedValue({
      data: null,
      error: { message: 'Anthropic rejected this key' },
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByLabelText('API Key')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-ant-bad' } });
    fireEvent.click(screen.getByText('Save & verify'));

    await waitFor(() => expect(screen.getByText('Anthropic rejected this key')).toBeTruthy());
    expect(screen.queryByText('sk-ant-…')).toBeNull();
  });

  it('removes the key through the confirm dialog and shows the not-set form', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: SET_STATUS, error: null });
    deleteAnthropicKey.mockResolvedValue({ data: { ok: true }, error: null });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('sk-ant-…1234')).toBeTruthy());
    fireEvent.click(screen.getByText('Remove'));

    const dialog = await screen.findByRole('alertdialog');
    const confirmButtons = within(dialog).getAllByText('Remove');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(screen.getByLabelText('API Key')).toBeTruthy());
    expect(screen.queryByText('sk-ant-…1234')).toBeNull();
  });
  it('shows a generated agent token once and drops it when the dialog closes (SYL-104)', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: NOT_SET_STATUS, error: null });
    const rawToken = 'syl_agent_super-secret-value-should-vanish';
    createAgentToken.mockResolvedValue({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        token: rawToken,
        label: null,
        scopes: ['read:upcoming'],
        created_at: '2026-09-27T00:00:00.000Z',
        expires_at: '2026-10-27T00:00:00.000Z',
      },
      error: null,
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('No agent tokens yet.')).toBeTruthy());
    fireEvent.click(screen.getByText('Generate token'));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.getByDisplayValue(rawToken)).toBeTruthy());
    expect(createAgentToken).toHaveBeenCalledWith({ label: '', expiresInDays: 30 });
    expect(screen.getByText(/You won't be able to see this again/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue(rawToken)).toBeNull());
    expect(document.body.innerHTML.includes(rawToken)).toBe(false);

    // Reopening starts a fresh form rather than re-showing the old token.
    fireEvent.click(screen.getByText('Generate token'));
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeTruthy();
    expect(document.body.innerHTML.includes(rawToken)).toBe(false);
  });

  it('shows the 409 cap message from create-agent-token inline (SYL-104)', async () => {
    fetchApiKeyStatus.mockResolvedValue({ data: NOT_SET_STATUS, error: null });
    createAgentToken.mockResolvedValue({
      data: null,
      error: { message: 'At most 10 active agent tokens; revoke one first.' },
    });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('Generate token')).toBeTruthy());
    fireEvent.click(screen.getByText('Generate token'));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(screen.getByText('At most 10 active agent tokens; revoke one first.')).toBeTruthy()
    );
  });
});
