import { GlobalSettings, AIProvider } from '../types';
import { DEFAULT_THEME } from '../constants/themes';

const STORAGE_KEY = 'realdataint_global_settings';

const DEFAULT_SETTINGS: GlobalSettings = {
  theme: DEFAULT_THEME,
  ai: {
    provider: AIProvider.GEMINI,
    apiKey: '',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 2000,
  },
};

export const loadGlobalSettings = (): GlobalSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with default to ensure new fields are present
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load global settings', e);
  }
  return DEFAULT_SETTINGS;
};

export const saveGlobalSettings = (settings: GlobalSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save global settings', e);
  }
};
