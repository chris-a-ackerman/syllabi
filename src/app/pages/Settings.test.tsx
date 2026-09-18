// @vitest-environment jsdom
// SYL-72: renders both card states from a mocked lib/api/apiKeys, and
// asserts no key text ever appears in the DOM after a save.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
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
});
