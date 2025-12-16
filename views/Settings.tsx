import React, { useState } from 'react';
import { AISettings, AIProvider } from '../types';
import { Save, CheckCircle2, Key, Cpu, Sliders, Eye, EyeOff, Loader2, Palette, ChevronRight, ArrowLeft } from 'lucide-react';
import { AVAILABLE_THEMES, DEFAULT_THEME } from '../constants/themes';
import { useGlobalSettings } from '../components/GlobalSettingsProvider';

const PROVIDERS = [
  { id: AIProvider.GEMINI, label: 'Google Gemini', icon: '💎' },
  { id: AIProvider.OPENAI, label: 'OpenAI GPT', icon: '🟢' },
  { id: AIProvider.CLAUDE, label: 'Anthropic Claude', icon: '🟠' },
];

const MODELS: Record<AIProvider, string[]> = {
  [AIProvider.GEMINI]: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  [AIProvider.OPENAI]: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  [AIProvider.CLAUDE]: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
};

type SettingsView = 'menu' | 'ai' | 'theme';

interface SettingsProps {
  onBack: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onBack }) => {
  const { settings, updateSettings } = useGlobalSettings();
  const [currentView, setCurrentView] = useState<SettingsView>('menu');
  
  // Local state for editing
  const [aiSettings, setAiSettings] = useState<AISettings>(settings.ai);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState<string>(settings.theme?.id || DEFAULT_THEME.id);

  const handleAiChange = (field: keyof AISettings, value: any) => {
    setAiSettings(prev => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
  };

  const handleProviderChange = (provider: AIProvider) => {
      setAiSettings(prev => ({
          ...prev,
          provider,
          model: MODELS[provider][0]
      }));
  };

  const handleSaveAi = async () => {
    setIsSaving(true);
    updateSettings({ ...settings, ai: aiSettings });
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSaveTheme = async () => {
    setIsSaving(true);
    const themeToSave = AVAILABLE_THEMES.find(t => t.id === selectedThemeId) || DEFAULT_THEME;
    updateSettings({ ...settings, theme: themeToSave });
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const renderMenu = () => (
    <div className="max-w-4xl mx-auto p-8">
        <div className="mb-8 flex items-center">
            <button onClick={onBack} className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
                <p className="text-gray-500">Manage application preferences.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* AI Configuration Card */}
            <button 
                onClick={() => setCurrentView('ai')}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all text-left group"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gray-100 rounded-lg group-hover:bg-gray-200 transition-colors">
                        <Cpu className="w-6 h-6 text-gray-600" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">AI Configuration</h3>
                <p className="text-sm text-gray-500">Configure AI providers and API keys.</p>
            </button>

            {/* Theme Settings Card */}
            <button 
                onClick={() => setCurrentView('theme')}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all text-left group"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gray-100 rounded-lg group-hover:bg-gray-200 transition-colors">
                        <Palette className="w-6 h-6 text-gray-600" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Theme & Appearance</h3>
                <p className="text-sm text-gray-500">Customize the look and feel.</p>
            </button>
        </div>
    </div>
  );

  const renderAiSettings = () => (
    <div className="max-w-4xl mx-auto p-8">
        <button 
            onClick={() => setCurrentView('menu')}
            className="flex items-center text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
        >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Settings
        </button>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 bg-gray-50">
                <h3 className="font-bold text-gray-800 flex items-center">
                    <Cpu className="w-5 h-5 mr-2 text-gray-600" />
                    AI Configuration
                </h3>
            </div>

            <div className="p-8 space-y-8">
                {/* Provider Selection */}
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-3">Select AI Provider</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {PROVIDERS.map((prov) => (
                            <button
                                key={prov.id}
                                onClick={() => handleProviderChange(prov.id)}
                                className={`flex items-center p-4 rounded-xl border-2 transition-all ${
                                    aiSettings.provider === prov.id 
                                    ? 'border-gray-400 bg-gray-50 ring-1 ring-gray-400' 
                                    : 'border-gray-200 hover:border-gray-300 bg-white'
                                }`}
                            >
                                <span className="text-2xl mr-3">{prov.icon}</span>
                                <div className="text-left">
                                    <div className={`font-bold text-sm ${aiSettings.provider === prov.id ? 'text-gray-900' : 'text-gray-700'}`}>{prov.label}</div>
                                </div>
                                {aiSettings.provider === prov.id && <CheckCircle2 className="w-5 h-5 ml-auto text-gray-600" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* API Key */}
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center">
                        <Key className="w-4 h-4 mr-2 text-gray-500" />
                        API Key
                        <span className="ml-2 text-xs font-normal text-red-500">* Required</span>
                    </label>
                    <div className="relative">
                        <input 
                            type={showKey ? "text" : "password"}
                            value={aiSettings.apiKey}
                            onChange={(e) => handleAiChange('apiKey', e.target.value)}
                            placeholder={`Enter your ${aiSettings.provider} API Key...`}
                            className="w-full pl-4 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 outline-none font-mono text-sm"
                        />
                        <button 
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {/* Model Parameters */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-3">Model Version</label>
                        <select 
                            value={aiSettings.model}
                            onChange={(e) => handleAiChange('model', e.target.value)}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 outline-none bg-white text-sm"
                        >
                            {MODELS[aiSettings.provider].map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    
                    <div className="space-y-6">
                         <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-bold text-gray-700 flex items-center">
                                    <Sliders className="w-3.5 h-3.5 mr-2" /> Temperature
                                </label>
                                <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{aiSettings.temperature}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0" max="1" step="0.1" 
                                value={aiSettings.temperature}
                                onChange={(e) => handleAiChange('temperature', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-600"
                            />
                         </div>

                         <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-bold text-gray-700">Max Tokens</label>
                                <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{aiSettings.maxTokens}</span>
                            </div>
                            <input 
                                type="number" 
                                value={aiSettings.maxTokens}
                                onChange={(e) => handleAiChange('maxTokens', parseInt(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 outline-none text-sm"
                            />
                         </div>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 px-8 py-4 border-t border-gray-200 flex justify-end items-center">
                {saveSuccess && (
                    <span className="text-green-600 text-sm font-medium mr-4 flex items-center animate-fade-in">
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Settings Saved
                    </span>
                )}
                <button 
                    onClick={handleSaveAi}
                    disabled={isSaving || !aiSettings.apiKey}
                    className="flex items-center px-6 py-2.5 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900 shadow-sm transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Configuration
                </button>
            </div>
        </div>
    </div>
  );

  const renderThemeSettings = () => (
    <div className="max-w-4xl mx-auto p-8">
        <button 
            onClick={() => setCurrentView('menu')}
            className="flex items-center text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
        >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Settings
        </button>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 bg-gray-50">
                <h3 className="font-bold text-gray-800 flex items-center">
                    <Palette className="w-5 h-5 mr-2 text-gray-600" />
                    Theme & Appearance
                </h3>
            </div>

            <div className="p-8">
                <label className="block text-sm font-bold text-gray-700 mb-4">Select Background Theme</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {AVAILABLE_THEMES.map((theme) => (
                        <button
                            key={theme.id}
                            onClick={() => setSelectedThemeId(theme.id)}
                            className={`relative overflow-hidden rounded-xl border-2 transition-all h-32 group ${
                                selectedThemeId === theme.id 
                                ? 'border-gray-500 ring-1 ring-gray-500 shadow-md' 
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                        >
                            {/* Preview Background */}
                            <div 
                                className="absolute inset-0"
                                style={{ background: theme.background }}
                            />
                            
                            {/* Content Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/5 transition-colors">
                                <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-sm">
                                    <span className="font-medium text-gray-800">{theme.name}</span>
                                </div>
                            </div>

                            {selectedThemeId === theme.id && (
                                <div className="absolute top-3 right-3 bg-gray-800 text-white p-1 rounded-full shadow-sm">
                                    <CheckCircle2 className="w-4 h-4" />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-gray-50 px-8 py-4 border-t border-gray-200 flex justify-end items-center">
                {saveSuccess && (
                    <span className="text-green-600 text-sm font-medium mr-4 flex items-center animate-fade-in">
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Theme Applied
                    </span>
                )}
                <button 
                    onClick={handleSaveTheme}
                    disabled={isSaving}
                    className="flex items-center px-6 py-2.5 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900 shadow-sm transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Apply Theme
                </button>
            </div>
        </div>
    </div>
  );

  if (currentView === 'ai') return renderAiSettings();
  if (currentView === 'theme') return renderThemeSettings();
  return renderMenu();
};

export default Settings;
