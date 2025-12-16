import React from 'react';
import { ThemeSettings } from '../types';
import { useGlobalSettings } from './GlobalSettingsProvider';
import { DEFAULT_THEME } from '../constants/themes';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useGlobalSettings();
  const currentTheme = settings.theme || DEFAULT_THEME;

  return (
    <div 
      className="min-h-screen transition-all duration-500 ease-in-out"
      style={{ background: currentTheme.background }}
    >
      {children}
    </div>
  );
};

