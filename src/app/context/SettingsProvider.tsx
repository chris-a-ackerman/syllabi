import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import * as settingsApi from '@/lib/api/settings';

interface SettingsState {
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => Promise<void>;
}

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Mirrors the global `app_settings.ai_enabled` kill switch, which the `chat`
  // Edge Function also enforces server-side. Starts optimistically enabled (the
  // column's own default) and is corrected by the fetch below, so a slow read
  // never leaves the composer disabled for a user who should have it.
  const [aiEnabled, setAiEnabledState] = useState(true);

  useEffect(() => {
    if (!user) {
      setAiEnabledState(true);
      return;
    }

    const fetchAiFlag = async () => {
      const { data, error } = await settingsApi.fetchAiEnabled();
      if (error) {
        console.error('Error fetching app settings:', error);
        return;
      }
      if (data !== null) setAiEnabledState(data);
    };

    fetchAiFlag();
  }, [user?.id]);

  const setAiEnabled = useCallback(async (enabled: boolean) => {
    if (!user) return;
    setAiEnabledState(enabled); // Optimistic — reverted below if the write is refused
    const { error } = await settingsApi.updateAiEnabled(enabled, user.id);
    if (error) {
      // RLS filters a non-admin's write out entirely, so this covers both a
      // failed request and an unauthorised one.
      console.error('Error updating AI kill switch:', error);
      setAiEnabledState(!enabled);
    }
  }, [user]);

  const value = useMemo<SettingsState>(
    () => ({ aiEnabled, setAiEnabled }),
    [aiEnabled, setAiEnabled],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
