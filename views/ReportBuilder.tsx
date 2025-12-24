import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit3, Trash2, ArrowLeft, Loader2, Save, X, LayoutDashboard } from 'lucide-react';
import { Project, DashboardWidget, ReportSlide } from '../types';
import { useToast } from '../components/ToastProvider';
import { useGlobalSettings } from '../components/GlobalSettingsProvider';
import {
  ensurePresentations,
  addPresentation,
  renamePresentation,
  removePresentation,
  setActivePresentation,
  updatePresentationSlides,
} from '../utils/reportPresentations';
import { ensureMagicDashboards } from '../utils/dashboards';
import { resolveDashboardBaseData } from '../utils/dashboardData';
import { saveProject } from '../utils/storage-compat';
import BuildReports from './BuildReports';
import { REALPPTX_CHART_THEME } from '../constants/chartTheme';
import { buildDashboardChartPayload } from '../utils/dashboardChartPayload';
import { applyWidgetFilters } from '../utils/widgetData';

const hashString = (input: string) => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

const hashJson = (value: unknown) => {
  try {
    return hashString(JSON.stringify(value ?? null));
  } catch {
    return '';
  }
};

const runWhenIdle = (fn: () => void, timeoutMs = 1200) => {
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return;
  }
  window.setTimeout(fn, 0);
};

interface ReportBuilderProps {
  project: Project;
  onUpdateProject: (project: Project) => void;
}

type ViewMode = 'list' | 'editor';

const ReportBuilder: React.FC<ReportBuilderProps> = ({ project, onUpdateProject }) => {
  const { settings: globalSettings } = useGlobalSettings();
  const {
    project: withMagicDash,
    dashboards: magicDashboards,
    activeDashboard: activeMagicDashboard,
    changed: magicChanged,
  } = useMemo(() => ensureMagicDashboards(project), [project]);

  const {
    project: normalizedProject,
    presentations,
    activePresentation,
    changed: presentationsChanged,
  } = useMemo(() => ensurePresentations(withMagicDash), [withMagicDash]);

  const [mode, setMode] = useState<ViewMode>('list');
  const [selectedPresentationId, setSelectedPresentationId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPresentationName, setNewPresentationName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSaveIntent, setPendingSaveIntent] = useState<'stay' | 'close' | null>(null);
  const [isInsertDrawerOpen, setInsertDrawerOpen] = useState(false);
  const [insertingWidgetId, setInsertingWidgetId] = useState<string | null>(null);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(
    activeMagicDashboard?.id || project.activeDashboardId || project.dashboards?.[0]?.id || null
  );
  const [iframeWindow, setIframeWindow] = useState<Window | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const { showToast } = useToast();
  const dashboardsForInsert = (magicDashboards && magicDashboards.length > 0) ? magicDashboards : (project.dashboards || []);

  useEffect(() => {
    if (presentationsChanged || magicChanged) {
      onUpdateProject(normalizedProject);
      saveProject(normalizedProject);
    }
  }, [presentationsChanged, magicChanged, normalizedProject, onUpdateProject]);

  useEffect(() => {
    if (presentations.length === 0) {
      setMode('list');
      setSelectedPresentationId(null);
    }
  }, [presentations.length]);

  useEffect(() => {
    if (!dashboardsForInsert.length) {
      setSelectedDashboardId(null);
      return;
    }
    if (!selectedDashboardId || !dashboardsForInsert.find((dash) => dash.id === selectedDashboardId)) {
      setSelectedDashboardId(dashboardsForInsert[0].id);
    }
  }, [dashboardsForInsert, selectedDashboardId]);

  const persistProject = async (next: Project) => {
    onUpdateProject(next);
    await saveProject(next);
  };

  const autosaveTimerRef = useRef<number | null>(null);
  const lastSentLoadRef = useRef<{ presentationId: string; slidesHash: string } | null>(null);

  const editingPresentation =
    presentations.find((p) => p.id === (selectedPresentationId || normalizedProject.activePresentationId)) ||
    activePresentation;

  const queueAutosave = useCallback(
    (presentationId: string, slides: ReportSlide[], name?: string) => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = window.setTimeout(() => {
        if (!editingPresentation) return;
        if (editingPresentation.id !== presentationId) return;
        runWhenIdle(() => {
          if (!editingPresentation) return;
          if (editingPresentation.id !== presentationId) return;
          const updatedProject = updatePresentationSlides(normalizedProject, editingPresentation.id, slides);
          if (name && name.trim() && name.trim() !== editingPresentation.name) {
            const renamed = renamePresentation(updatedProject, editingPresentation.id, name.trim());
            void persistProject(renamed);
            return;
          }
          void persistProject(updatedProject);
        }, 1500);
      }, 900);
    },
    [editingPresentation, normalizedProject, persistProject]
  );

  const selectedDashboard =
    dashboardsForInsert.find((dash) => dash.id === selectedDashboardId) || dashboardsForInsert[0];

  const persistSlidesFromExport = useCallback(
    async (slides: ReportSlide[], exitAfter?: boolean) => {
      if (!editingPresentation) {
        showToast('Save failed', 'No active presentation to update.', 'error');
        setIsSaving(false);
        setPendingSaveIntent(null);
        return;
      }
      try {
        const updatedProject = updatePresentationSlides(normalizedProject, editingPresentation.id, slides);
        await persistProject(updatedProject);
        showToast('Saved', `"${editingPresentation.name}" updated.`, 'success');
        if (exitAfter) {
          setMode('list');
          setSelectedPresentationId(null);
        }
      } catch (error) {
        console.error('Failed to persist presentation', error);
        showToast('Save failed', 'Unable to persist presentation slides.', 'error');
      } finally {
        setIsSaving(false);
        setPendingSaveIntent(null);
      }
    },
    [editingPresentation, normalizedProject, persistProject, showToast]
  );

  const executeExportRequest = useCallback(
    (intentOverride?: 'stay' | 'close') => {
      const intentToUse = intentOverride ?? pendingSaveIntent;
      if (!intentToUse) return false;
      if (!iframeWindow) {
        showToast('Editor unavailable', 'Unable to communicate with RealPPTX.', 'error');
        setPendingSaveIntent(null);
        setIsSaving(false);
        return false;
      }
      if (!isEditorReady) {
        showToast('Editor still loading', 'Waiting for RealPPTX to finish initializing.', 'info');
        return false;
      }
      setIsSaving(true);
      iframeWindow.postMessage(
        {
          source: 'realdata-host',
          type: 'request-presentation-export',
        },
        '*'
      );
      return true;
    },
    [iframeWindow, isEditorReady, pendingSaveIntent, showToast]
  );

  const requestPresentationExport = useCallback(
    (intent: 'stay' | 'close') => {
      setPendingSaveIntent(intent);
      executeExportRequest(intent);
    },
    [executeExportRequest]
  );

  const handleCreatePresentation = async () => {
    if (!newPresentationName.trim()) {
      showToast('Name required', 'Please provide a presentation name.', 'warning');
      return;
    }
    const { project: updated, presentation } = addPresentation(normalizedProject, newPresentationName.trim());
    await persistProject(updated);
    setNewPresentationName('');
    setIsCreateOpen(false);
    setSelectedPresentationId(presentation.id);
    setMode('editor');
    showToast('Presentation created', presentation.name, 'success');
  };

  const handleOpenPresentation = async (presentationId: string) => {
    const updated = setActivePresentation(normalizedProject, presentationId);
    await persistProject(updated);
    setSelectedPresentationId(presentationId);
    setMode('editor');
  };

  const handleDeletePresentation = async (presentationId: string) => {
    const target = presentations.find((p) => p.id === presentationId);
    if (!target) return;
    if (!window.confirm(`Delete "${target.name}"? This cannot be undone.`)) return;
    const updated = removePresentation(normalizedProject, presentationId);
    await persistProject(updated);
    showToast('Presentation deleted', target.name, 'success');
    if (selectedPresentationId === presentationId) {
      setSelectedPresentationId(null);
      setMode('list');
    }
  };

  const handleRenamePresentation = async (presentationId: string) => {
    const target = presentations.find((p) => p.id === presentationId);
    if (!target) return;
    const nextName = prompt('Rename presentation', target.name);
    if (!nextName || nextName.trim() === target.name) return;
    const updated = renamePresentation(normalizedProject, presentationId, nextName.trim());
    await persistProject(updated);
    showToast('Presentation renamed', nextName.trim(), 'success');
  };

  const handleInsertChart = useCallback(
    async (widget: DashboardWidget) => {
      if (!iframeWindow) {
        showToast('Editor not ready', 'Waiting for RealPPTX to finish loading.', 'warning');
        return;
      }
      setInsertingWidgetId(widget.id);
      try {
        const dashboard =
          dashboardsForInsert.find((dash) => dash.id === selectedDashboardId) || dashboardsForInsert[0];

        const { rows: baseRows } = resolveDashboardBaseData(normalizedProject, dashboard ?? null);
        const rows = applyWidgetFilters(baseRows, dashboard?.globalFilters);

        const payload = buildDashboardChartPayload(widget, rows, {
          theme: REALPPTX_CHART_THEME,
          sourceDashboardId: dashboard?.id,
        });
        if (!payload) {
          showToast('Nothing to insert', 'This chart has no data after filters.', 'warning');
          return;
        }
        iframeWindow.postMessage(
          {
            source: 'realdata-host',
            type: 'insert-dashboard-chart',
            payload,
          },
          '*'
        );
        setInsertDrawerOpen(false);
        showToast('Chart inserted', widget.title || 'Dashboard chart added to slide.', 'success');
      } catch (error) {
        console.error('Failed to prepare dashboard chart payload', error);
        showToast('Insert failed', 'Unable to serialize chart data.', 'error');
      } finally {
        setInsertingWidgetId(null);
      }
    },
    [dashboardsForInsert, iframeWindow, normalizedProject, selectedDashboardId, showToast]
  );

  const handleIframeLoad = useCallback((iframe: HTMLIFrameElement | null) => {
    setIframeWindow(iframe?.contentWindow ?? null);
    setIsEditorReady(false);
    lastSentLoadRef.current = null;
  }, []);

  const handlePptistMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== 'object' || !event.data) return;
      if (event.data.source !== 'pptist' && event.data.source !== 'realpptx') return;
      if (event.data.type === 'open-dashboard-insert') {
        if (!dashboardsForInsert.length) {
          showToast('No dashboards', 'No dashboard configuration found.', 'info');
          return;
        }
        setInsertDrawerOpen(true);
      }
      if (event.data.type === 'ready') {
        setIsEditorReady(true);
      }
      if (event.data.type === 'request-save') {
        requestPresentationExport('stay');
      }
      if (event.data.type === 'presentation-export') {
        const payload = event.data.payload;
        if (!payload?.slides || !Array.isArray(payload.slides)) {
          showToast('Save failed', 'No slide data received from editor.', 'error');
          setIsSaving(false);
          setPendingSaveIntent(null);
          return;
        }
        persistSlidesFromExport(payload.slides, pendingSaveIntent === 'close');
      }

      if (event.data.type === 'autosave-presentation') {
        const payload = event.data.payload as { presentationId?: string; slides?: ReportSlide[]; title?: string } | undefined;
        if (!payload?.presentationId || !payload.slides || !Array.isArray(payload.slides)) return;
        queueAutosave(payload.presentationId, payload.slides, payload.title);
      }

      // Automation Report: Handle update request for linked charts
      if (event.data.type === 'request-chart-updates') {
        const linkedCharts = event.data.payload?.linkedCharts as Array<{
          elementId: string;
          widgetId: string;
          dashboardId: string;
          kind?: 'chart' | 'kpi';
        }> | undefined;

        if (!linkedCharts || linkedCharts.length === 0) {
          showToast('No linked charts', 'No charts are linked to Dashboard widgets.', 'info');
          return;
        }

        let updatedCount = 0;
        linkedCharts.forEach((linked) => {
          // Find the dashboard and widget
          const dashboard = dashboardsForInsert.find((d) => d.id === linked.dashboardId);
          if (!dashboard) return;

          const widget = dashboard.widgets?.find((w) => w.id === linked.widgetId);
          if (!widget) return;

          // Build fresh payload for this widget
          const { rows: baseRows } = resolveDashboardBaseData(normalizedProject, dashboard);
          const rows = applyWidgetFilters(baseRows, dashboard.globalFilters);

          const payload = buildDashboardChartPayload(widget, rows, {
            theme: REALPPTX_CHART_THEME,
            sourceDashboardId: dashboard.id,
          });

          if (!payload) return;

          if (linked.kind === 'kpi' || payload.chartType === 'kpi') {
            const escapeHtml = (input: string) =>
              input
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');

            const toNumber = (raw: unknown) => {
              if (raw === null || raw === undefined) return 0;
              if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
              if (typeof raw === 'object' && (raw as any).value !== undefined) {
                const n = Number((raw as any).value);
                return Number.isFinite(n) ? n : 0;
              }
              const n = Number(raw);
              return Number.isFinite(n) ? n : 0;
            };

            const formatKpiValue = (
              value: number,
              mode?: 'auto' | 'text' | 'number' | 'compact' | 'accounting'
            ) => {
              if (!Number.isFinite(value)) return '0';
              switch (mode) {
                case 'text':
                  return String(value);
                case 'number':
                  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
                case 'compact':
                  return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value);
                case 'accounting':
                  return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
                case 'auto':
                default: {
                  const abs = Math.abs(value);
                  if (abs >= 1_000_000) {
                    return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value);
                  }
                  if (Number.isInteger(value)) {
                    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
                  }
                  return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
                }
              }
            };

            const raw = payload.data?.series?.[0]?.[0];
            const value = toNumber(raw);
            const valueFormat = payload.options?.dataLabelValueFormat;
            const text = formatKpiValue(value, valueFormat);
            const themeAccent = payload.theme?.colors?.[0] || payload.theme?.textColor || '#111827';
            const color = payload.options?.dataLabelColor || themeAccent;
            const fontFamily = payload.options?.dataLabelFontFamily;
            const fontWeight = payload.options?.dataLabelFontWeight || 'bold';

            const safeText = escapeHtml(text);
            const content = `<p style="text-align:center;"><span style="font-weight:${fontWeight};${fontFamily ? ` font-family:${fontFamily};` : ''}">${safeText}</span></p>`;

            iframeWindow?.postMessage(
              {
                source: 'realdata-host',
                type: 'update-kpi-text',
                payload: {
                  elementId: linked.elementId,
                  content,
                  defaultColor: color,
                  ...(fontFamily ? { defaultFontName: fontFamily } : {}),
                },
              },
              '*'
            );
          } else {
            // Send update to RealPPTX
            iframeWindow?.postMessage(
              {
                source: 'realdata-host',
                type: 'update-chart-data',
                payload: {
                  elementId: linked.elementId,
                  data: payload.data,
                  options: payload.options,
                  theme: payload.theme,
                },
              },
              '*'
            );
          }
          updatedCount++;
        });

        if (updatedCount > 0) {
          showToast('Charts updated', `${updatedCount} element(s) refreshed with latest data.`, 'success');
        } else {
          showToast('No updates', 'Could not find matching widgets for linked charts.', 'warning');
        }
      }

      // Automation Report: No linked charts message
      if (event.data.type === 'no-linked-charts') {
        showToast('No linked charts', 'Insert charts from Dashboard first to enable updates.', 'info');
      }
    },
    [dashboardsForInsert, iframeWindow, normalizedProject, pendingSaveIntent, persistSlidesFromExport, queueAutosave, requestPresentationExport, showToast]
  );

  useEffect(() => {
    window.addEventListener('message', handlePptistMessage);
    return () => window.removeEventListener('message', handlePptistMessage);
  }, [handlePptistMessage]);

  useEffect(() => {
    if (mode !== 'editor') {
      setIsEditorReady(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!iframeWindow || !isEditorReady || !pendingSaveIntent || isSaving) {
      return;
    }
    executeExportRequest();
  }, [iframeWindow, isEditorReady, pendingSaveIntent, isSaving, executeExportRequest]);

  useEffect(() => {
    if (!iframeWindow || mode !== 'editor' || !editingPresentation || !isEditorReady) return;

    const slides = editingPresentation.slides || [];
    const slidesHash = hashJson(slides);
    const updatedAt = typeof editingPresentation.updatedAt === 'number' ? editingPresentation.updatedAt : 0;

    const lastSent = lastSentLoadRef.current;
    const isSamePayload =
      !!lastSent &&
      lastSent.presentationId === editingPresentation.id &&
      lastSent.slidesHash === slidesHash;

    if (isSamePayload) return;
    lastSentLoadRef.current = { presentationId: editingPresentation.id, slidesHash };

    iframeWindow.postMessage(
      {
        source: 'realdata-host',
        type: 'load-presentation',
        payload: {
          presentationId: editingPresentation.id,
          slides,
          title: editingPresentation.name,
          updatedAt,
          globalSettings,
          chartTheme: REALPPTX_CHART_THEME,
        },
      },
      '*'
    );
  }, [editingPresentation, iframeWindow, mode, isEditorReady, globalSettings]);

  const renderListView = () => (
    <div className="h-full flex flex-col px-10 py-8 overflow-y-auto w-full bg-[#F8F9FA]">
      <div className="space-y-8 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Canvas Start</h1>
            <p className="text-sm text-gray-500 mt-1">
              Create multiple decks per project and jump back into RealPPTX instantly.
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Slide</span>
          </button>
        </div>

        {presentations.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-500">
            <p className="text-lg font-semibold text-gray-700 mb-2">No presentation yet</p>
            <p className="text-sm">
              Start by creating your first slide deck for this project.
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="mt-6 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm"
            >
              Create Presentation
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Name</th>
                  <th className="px-6 py-3 text-left font-semibold">Last updated</th>
                  <th className="px-6 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {presentations.map((presentation) => (
                  <tr key={presentation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{presentation.name}</div>
                      <div className="text-xs text-gray-500">
                        Created {new Date(presentation.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(presentation.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleRenamePresentation(presentation.id)}
                          className="inline-flex items-center px-2 py-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md"
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1" />
                          Rename
                        </button>
                        <button
                          onClick={() => handleOpenPresentation(presentation.id)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleDeletePresentation(presentation.id)}
                          className="inline-flex items-center px-2 py-1 text-xs text-red-600 hover:text-red-700 border border-red-100 rounded-md"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderCreateModal = () =>
    isCreateOpen && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-900">Create Presentation</h3>
          <p className="text-sm text-gray-500">
            Give this deck a clear name so you can find it later.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-600">Presentation Name</label>
            <input
              autoFocus
              value={newPresentationName}
              onChange={(e) => setNewPresentationName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePresentation();
              }}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Executive Review"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => {
                setIsCreateOpen(false);
                setNewPresentationName('');
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleCreatePresentation}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );

  const renderInsertDrawer = () => {
    if (!isInsertDrawerOpen || !selectedDashboard) return null;
    const widgets = selectedDashboard.widgets || [];
    return (
      <div className="absolute top-0 right-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-2xl z-20 flex flex-col">
        <div className="h-12 border-b border-gray-100 flex items-center justify-between px-3 bg-gray-50">
          <div>
            <p className="text-[10px] uppercase text-gray-400">Insert dashboard</p>
            <p className="text-sm font-semibold text-gray-800 flex items-center space-x-2">
              <LayoutDashboard className="w-4 h-4 text-blue-500" />
              <span>{selectedDashboard.name}</span>
            </p>
          </div>
          <button
            onClick={() => setInsertDrawerOpen(false)}
            className="text-gray-400 hover:text-gray-600 rounded-full p-1"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-gray-100">
          <label className="text-xs text-gray-500 block mb-1">Dashboard</label>
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedDashboardId || ''}
            onChange={(e) => setSelectedDashboardId(e.target.value)}
          >
            {dashboardsForInsert.map((dash) => (
              <option key={dash.id} value={dash.id}>
                {dash.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {widgets.length === 0 ? (
            <div className="text-xs text-gray-500">This dashboard has no charts yet.</div>
          ) : (
            widgets.map((widget) => (
              <div key={widget.id} className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{widget.title || widget.type}</p>
                    <p className="text-xs text-gray-500 capitalize">Type: {widget.type}</p>
                  </div>
                  <button
                    onClick={() => handleInsertChart(widget)}
                    disabled={!!insertingWidgetId}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      insertingWidgetId
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {insertingWidgetId === widget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Insert'}
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">
                  {widget.chartTitle || widget.title || 'Chart from dashboard'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  if (mode === 'editor' && editingPresentation) {
    return (
      <div className="flex flex-col h-full bg-gray-900">
        <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                setMode('list');
                setSelectedPresentationId(null);
              }}
              className="inline-flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md bg-white"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </button>
            <div>
              <p className="text-sm font-semibold text-gray-900">{project.name}</p>
              <p className="text-xs text-gray-500">{editingPresentation.name}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => requestPresentationExport('stay')}
              disabled={isSaving}
              className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md border ${
                isSaving
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'border-blue-600 text-blue-600 hover:bg-blue-50'
              }`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save
            </button>
            <button
              onClick={() => requestPresentationExport('close')}
              disabled={isSaving}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Save & Close
            </button>
          </div>
        </header>
        <div className="flex-1 relative">
          <BuildReports
            key={editingPresentation.id}
            project={project}
            globalSettings={globalSettings}
            chartTheme={REALPPTX_CHART_THEME}
            onMessage={handlePptistMessage}
            onIframeLoad={handleIframeLoad}
          />
          {renderInsertDrawer()}
        </div>
      </div>
    );
  }

  return (
    <>
      {renderListView()}
      {renderCreateModal()}
    </>
  );
};

export default ReportBuilder;
