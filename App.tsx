
import React, { useState, useEffect } from 'react';
import Landing from './views/Landing';
import Sidebar from './components/Sidebar';
import DataIngest from './views/DataIngest';
import PrepLanding from './views/PrepLanding';
import CleansingData from './views/CleansingData';
import BuildStructure from './views/BuildStructure';
import DashboardMagic from './views/DashboardMagic';
import ReportBuilder from './views/ReportBuilder';
import AiAgent from './views/AiAgent';
import Settings from './views/Settings';
import ManagementLanding from './views/ManagementLanding';
import { Project, AppView, ProjectTab } from './types';
import { saveLastState } from './utils/storage-compat';
import { ToastProvider } from './components/ToastProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { GlobalSettingsProvider } from './components/GlobalSettingsProvider';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.LANDING);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>(ProjectTab.UPLOAD);

  // On Load, check for previous state (Optional - keeping simple for now)
  useEffect(() => {
    // We could impl init logic here
  }, []);

  const handleSelectProject = (project: Project) => {
    setCurrentProject(project);
    setCurrentView(AppView.PROJECT);
    setActiveTab(ProjectTab.UPLOAD); // Default start at management landing
    saveLastState(project.id, ProjectTab.UPLOAD);
  };

  const handleTabChange = (tab: ProjectTab) => {
    setActiveTab(tab);
    if (currentProject) {
        saveLastState(currentProject.id, tab);
    }
  };

  const handleBackToLanding = () => {
    setCurrentView(AppView.LANDING);
    setCurrentProject(null);
    saveLastState('', ProjectTab.UPLOAD); // Clear state
  };

  const updateProject = (updated: Project) => {
      setCurrentProject(updated);
  };

  // Render Logic
  if (currentView === AppView.LANDING) {
    return (
      <GlobalSettingsProvider>
        <ThemeProvider>
          <Landing
            onSelectProject={handleSelectProject}
            onOpenSettings={() => setCurrentView(AppView.SETTINGS)}
          />
        </ThemeProvider>
      </GlobalSettingsProvider>
    );
  }

  if (currentView === AppView.SETTINGS) {
    return (
      <GlobalSettingsProvider>
        <ThemeProvider>
          <Settings onBack={() => setCurrentView(AppView.LANDING)} />
        </ThemeProvider>
      </GlobalSettingsProvider>
    );
  }

  if (currentView === AppView.PROJECT && currentProject) {
    return (
      <GlobalSettingsProvider>
        <ThemeProvider>
          <ToastProvider>
          <div className="flex h-screen overflow-hidden font-sans text-gray-900 bg-transparent">
          <Sidebar 
              activeTab={activeTab} 
              onTabChange={handleTabChange} 
              onBackToLanding={handleBackToLanding}
              projectName={currentProject.name}
          />
          
          <div className="flex-1 flex flex-col overflow-hidden feature-compact bg-white/50 backdrop-blur-sm">
              {/* Top Bar */}
              <header className="h-14 bg-white/80 backdrop-blur-md border-b border-gray-200/50 flex items-center justify-between px-8 shadow-sm flex-shrink-0 z-10">
                  <span className="text-sm text-gray-500 font-medium">
                      {activeTab === ProjectTab.UPLOAD && 'Management Data'}
                      {activeTab === ProjectTab.INGESTION && 'Ingestion Data'}
                      {activeTab === ProjectTab.PREPARATION && 'Preparation Data'}
                      {activeTab === ProjectTab.PREP_TOOLS && 'Preparation Tools'}
                      {activeTab === ProjectTab.CLEANSING && 'Cleansing Data'}
                      {activeTab === ProjectTab.BUILD_STRUCTURE && 'Build Structure'}
                      {activeTab === ProjectTab.DASHBOARD_MAGIC && 'Dashboard Magic'}
                      {activeTab === ProjectTab.AI_AGENT && 'AI Enrichment'}
                      {activeTab === ProjectTab.REPORT && 'Presentation Slide'}
                      {activeTab === ProjectTab.SETTINGS && 'Configuration'}
                  </span>
                  <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      <span className="text-xs text-gray-400">Auto-saved (IndexedDB)</span>
                  </div>
              </header>

              <main className="flex-1 overflow-hidden relative">
                  {activeTab === ProjectTab.UPLOAD && <ManagementLanding />}
                  {activeTab === ProjectTab.INGESTION && (
                    <div className="h-full overflow-y-auto">
                      <DataIngest
                        project={currentProject}
                        onUpdateProject={updateProject}
                        kind="ingestion"
                      />
                    </div>
                  )}
                  {activeTab === ProjectTab.PREPARATION && (
                    <div className="h-full overflow-y-auto">
                      <DataIngest project={currentProject} onUpdateProject={updateProject} kind="prepared" />
                    </div>
                  )}
                  {activeTab === ProjectTab.PREP_TOOLS && <PrepLanding />}
                  {activeTab === ProjectTab.CLEANSING && (
                    <CleansingData project={currentProject} onUpdateProject={updateProject} />
                  )}
                  {activeTab === ProjectTab.BUILD_STRUCTURE && (
                    <BuildStructure project={currentProject} onUpdateProject={updateProject} />
                  )}
                  {activeTab === ProjectTab.DASHBOARD_MAGIC && (
                      <div className="h-full overflow-y-auto">
                        <DashboardMagic project={currentProject} onUpdateProject={updateProject} />
                      </div>
                  )}
                  {activeTab === ProjectTab.AI_AGENT && (
                      <AiAgent project={currentProject} onUpdateProject={updateProject} />
                  )}
                  {activeTab === ProjectTab.REPORT && (
                      <ReportBuilder project={currentProject} onUpdateProject={updateProject} />
                  )}
                  {activeTab === ProjectTab.SETTINGS && (
                      <Settings onBack={() => setActiveTab(ProjectTab.UPLOAD)} />
                  )}
              </main>
          </div>
        </div>
      </ToastProvider>
      </ThemeProvider>
    </GlobalSettingsProvider>
    );
  }

  return <div>Loading...</div>;
};

export default App;
