// @vitest-environment jsdom
/* eslint-disable react-hooks/immutability, react-hooks/globals --
   A render counter is by definition a side effect of rendering, and the test
   needs a handle on the chat actions from outside the tree. Both require
   module-scope mutation that these rules forbid in application code. */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';
import { ChatProvider, useChat } from './ChatProvider';
import { DataProvider, useData } from './DataProvider';

// SYL-37: the three providers exist so that chat activity does not re-render
// the rest of the app. This pins that: a chat state update must re-render chat
// consumers only. Under the single AppContext it replaced, the same update
// re-rendered every useApp() consumer, because the provider value was a fresh
// object literal on every render.

const renderCounts = { auth: 0, data: 0, chat: 0 };
let chat: ReturnType<typeof useChat>;

function AuthConsumer() {
  useAuth();
  renderCounts.auth++;
  return null;
}

function DataConsumer() {
  useData();
  renderCounts.data++;
  return null;
}

function ChatConsumer() {
  chat = useChat();
  renderCounts.chat++;
  return <span data-testid="message-count">{chat.chatMessages.length}</span>;
}

function renderApp() {
  return render(
    <AuthProvider>
      <DataProvider>
        <ChatProvider>
          <AuthConsumer />
          <DataConsumer />
          <ChatConsumer />
        </ChatProvider>
      </DataProvider>
    </AuthProvider>
  );
}

beforeEach(() => {
  // Keep the providers offline: isSupabaseConfigured() reads these at call time.
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  renderCounts.auth = 0;
  renderCounts.data = 0;
  renderCounts.chat = 0;
});

describe('provider render isolation', () => {
  it('re-renders only chat consumers when a chat message is added', async () => {
    const { getByTestId } = renderApp();

    // Let the mount effects (session check, empty-state resets) settle first.
    await act(async () => {});
    renderCounts.auth = 0;
    renderCounts.data = 0;
    renderCounts.chat = 0;

    // The optimistic append that happens the moment you hit send in chat.
    await act(async () => {
      chat.addChatMessage(
        { role: 'user', content: 'when is the midterm?' },
        { semesterId: 'sem-1', courseIds: [] }
      );
    });

    // The chat state genuinely changed...
    expect(getByTestId('message-count').textContent).toBe('1');
    expect(renderCounts.chat).toBe(1);

    // ...and nothing outside chat re-rendered.
    expect(renderCounts.data).toBe(0);
    expect(renderCounts.auth).toBe(0);
  });

  it('keeps provider values referentially stable across chat updates', async () => {
    let dataValue: ReturnType<typeof useData> | undefined;
    let authValue: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      dataValue = useData();
      authValue = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <DataProvider>
          <ChatProvider>
            <Probe />
            <ChatConsumer />
          </ChatProvider>
        </DataProvider>
      </AuthProvider>
    );
    await act(async () => {});

    const dataBefore = dataValue;
    const authBefore = authValue;

    await act(async () => {
      chat.addChatMessage(
        { role: 'user', content: 'and the final?' },
        { semesterId: 'sem-1', courseIds: [] }
      );
    });

    expect(dataValue).toBe(dataBefore);
    expect(authValue).toBe(authBefore);
  });
});
