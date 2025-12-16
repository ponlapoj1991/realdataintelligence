import { ThemeSettings } from '../types';

export const DEFAULT_THEME: ThemeSettings = {
  id: 'classic',
  name: 'Classic White',
  background: '#F9FAFB', // gray-50
  isGradient: false,
};

export const PASTEL_THEME: ThemeSettings = {
  id: 'pastel-dream',
  name: 'Pastel Dream',
  background: 'linear-gradient(135deg, #ffe4d6 0%, #a5d8ff 100%)',
  isGradient: true,
};

export const AVAILABLE_THEMES = [DEFAULT_THEME, PASTEL_THEME];
