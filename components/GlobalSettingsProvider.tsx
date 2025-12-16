import React, { createContext, useContext, useEffect, useState } from 'react';
import { GlobalSettings } from '../types';
import { loadGlobalSettings, saveGlobalSettings } from '../utils/globalSettings';

interface GlobalSettingsContextType {
  settings: GlobalSettings;
  updateSettings: (newSettings: GlobalSettings) => void;
}

const GlobalSettingsContext = createContext<GlobalSettingsContextType | undefined>(undefined);

export const useGlobalSettings = () => {
  const context = useContext(GlobalSettingsContext);
  if (!context) {
    throw new Error('useGlobalSettings must be used within a GlobalSettingsProvider');
  }
  return context;
};

export const GlobalSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<GlobalSettings>(loadGlobalSettings());

  const updateSettings = (newSettings: GlobalSettings) => {
    setSettings(newSettings);
    saveGlobalSettings(newSettings);
  };

  // Initial load
  useEffect(() => {
    setSettings(loadGlobalSettings());
  }, []);

  return (
    <GlobalSettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </GlobalSettingsContext.Provider>
  );
};
