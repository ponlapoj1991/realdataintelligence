import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit3, Trash2, ArrowLeft, Loader2, Save, X, LayoutDashboard, Filter } from 'lucide-react';
import { CanvasWidgetTable, DashboardFilter, DashboardWidget, Project, ProjectDashboard, RawRow, ReportSlide } from '../types';
import { useToast } from '../components/ToastProvider';
import { useGlobalSettings } from '../components/GlobalSettingsProvider';
import {
  ensurePresentations,
  addPresentation,
  renamePresentation,
  removePresentation,
  setActivePresentation,
  updatePresentationSlides,
  updatePresentationCanvasActiveTable,
  updatePresentationCanvasTables,
} from '../utils/reportPresentations';
import { ensureMagicDashboards } from '../utils/dashboards';
import { saveProject } from '../utils/storage-compat';
import BuildReports from './BuildReports';
import { REALPPTX_CHART_THEME } from '../constants/chartTheme';
import type { DashboardChartInsertPayload } from '../utils/dashboardChartPayload';
import { ensureDataSources } from '../utils/dataSources';
import DataSourcePickerModal from '../components/DataSourcePickerModal';
import ChartBuilder from '../components/ChartBuilder';
import { getAllDataSourceChunks } from '../utils/storage-v2';
import { applyTransformation } from '../utils/transform';
import type { MagicAggregationWorkerSource } from '../hooks/useMagicAggregationWorker';
import { toDate } from '../utils/widgetData';

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

    const [isCanvasTablePickerOpen, setCanvasTablePickerOpen] = useState(false);
    const [canvasTablePickerRequestId, setCanvasTablePickerRequestId] = useState<string | null>(null);

    const [isCanvasBuilderOpen, setCanvasBuilderOpen] = useState(false);
    const [canvasBuilderTableId, setCanvasBuilderTableId] = useState<string | null>(null);
    const [canvasBuilderInitialWidget, setCanvasBuilderInitialWidget] = useState<DashboardWidget | null>(null);
    const [canvasBuilderTargetElementId, setCanvasBuilderTargetElementId] = useState<string | null>(null);
    const [canvasBuilderRows, setCanvasBuilderRows] = useState<RawRow[]>([]);
    const [canvasBuilderColumns, setCanvasBuilderColumns] = useState<string[]>([]);
    const [canvasBuilderWorkerSource, setCanvasBuilderWorkerSource] = useState<MagicAggregationWorkerSource | undefined>(undefined);
    const [canvasBuilderLoading, setCanvasBuilderLoading] = useState(false);

    const [canvasNewFilterCol, setCanvasNewFilterCol] = useState('');
    const [canvasFilterRows, setCanvasFilterRows] = useState<RawRow[]>([]);
	  const dashboardsForInsert = (magicDashboards && magicDashboards.length > 0) ? magicDashboards : (project.dashboards || []);

	  type PptxWorkerResponse =
	    | { type: 'pptxPayload'; requestId: string; rowsVersion: number; payload: DashboardChartInsertPayload | null }
	    | { type: 'error'; requestId?: string; rowsVersion?: number; error: string };

	  const pptxWorkerRef = useRef<Worker | null>(null);
	  const pptxRowsVersionRef = useRef(0);
	  const pptxSourceKeyRef = useRef<string>('');
	  const pptxPendingRef = useRef(
	    new Map<
	      string,
	      {
	        rowsVersion: number;
	        resolve: (payload: DashboardChartInsertPayload | null) => void;
	        reject: (err: Error) => void;
	      }
	    >()
	  );

	  useEffect(() => {
	    if (typeof Worker === 'undefined') return;

	    const worker = new Worker(new URL('../workers/magicAggregation.worker.ts', import.meta.url), { type: 'module' });
	    pptxWorkerRef.current = worker;

	    worker.onmessage = (event: MessageEvent<PptxWorkerResponse>) => {
	      const msg = event.data as PptxWorkerResponse;
	      if (!msg || typeof msg !== 'object') return;

	      if (msg.type === 'pptxPayload') {
	        const pending = pptxPendingRef.current.get(msg.requestId);
	        if (!pending) return;
	        pptxPendingRef.current.delete(msg.requestId);
	        if (pending.rowsVersion !== msg.rowsVersion) {
	          pending.resolve(null);
	          return;
	        }
	        pending.resolve(msg.payload ?? null);
	        return;
	      }

	      if (msg.type === 'error') {
	        const requestId = msg.requestId;
	        if (!requestId) return;
	        const pending = pptxPendingRef.current.get(requestId);
	        if (!pending) return;
	        pptxPendingRef.current.delete(requestId);
	        pending.reject(new Error(msg.error || 'Worker failed'));
	      }
	    };

	    worker.onerror = (event) => {
	      console.error('[ReportBuilder] Worker error:', event);
	    };

	    return () => {
	      for (const [, pending] of pptxPendingRef.current) {
	        pending.reject(new Error('Worker terminated'));
	      }
	      pptxPendingRef.current.clear();
	      worker.terminate();
	      pptxWorkerRef.current = null;
	    };
	  }, []);

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

	  const { project: projectWithSources } = useMemo(() => ensureDataSources(normalizedProject), [normalizedProject]);
	  const transformRulesHash = useMemo(() => hashJson(projectWithSources.transformRules || null), [projectWithSources.transformRules]);

    const rowsCacheRef = useRef<Map<string, { version: number; rows: RawRow[] }>>(new Map());

    const loadRowsForDataSource = useCallback(
      async (dataSourceId: string): Promise<RawRow[]> => {
        const src = (projectWithSources.dataSources || []).find((s) => s.id === dataSourceId);
        const version = src?.updatedAt ?? projectWithSources.lastModified ?? 0;
        const cacheKey = `${dataSourceId}:${version}:${transformRulesHash}`;

        const cached = rowsCacheRef.current.get(cacheKey);
        if (cached && cached.version === version) return cached.rows;

        let rows = (src as any)?.rows as RawRow[] | undefined;
        if (!rows || rows.length === 0) {
          rows = await getAllDataSourceChunks(projectWithSources.id, dataSourceId);
        }

        const transformed =
          projectWithSources.transformRules && projectWithSources.transformRules.length > 0
            ? applyTransformation(rows, projectWithSources.transformRules)
            : rows;

        rowsCacheRef.current.set(cacheKey, { version, rows: transformed });
        return transformed;
      },
      [projectWithSources.dataSources, projectWithSources.id, projectWithSources.lastModified, projectWithSources.transformRules, transformRulesHash]
    );

    const ingestionSources = useMemo(
      () => (projectWithSources.dataSources || []).filter((s) => s.kind === 'ingestion'),
      [projectWithSources.dataSources]
    );
    const preparedSources = useMemo(
      () => (projectWithSources.dataSources || []).filter((s) => s.kind === 'prepared'),
      [projectWithSources.dataSources]
    );

    const canvasTables = useMemo(() => {
      const tables = (editingPresentation?.canvasTables || []) as CanvasWidgetTable[];
      return Array.isArray(tables) ? tables : [];
    }, [editingPresentation?.id, editingPresentation?.canvasTables]);

    const canvasActiveTableId = useMemo(() => {
      if (canvasTables.length === 0) return null;
      const active = editingPresentation?.canvasActiveTableId;
      if (active && canvasTables.find((t) => t.id === active)) return active;
      return canvasTables[0].id;
    }, [canvasTables, editingPresentation?.canvasActiveTableId]);

    const buildCanvasContextPayload = useCallback(
      (projectInput: Project): { tables: Array<{ id: string; name: string; dataSourceId: string; dataSourceName: string; dataSourceKind: string }>; activeTableId: string | null } => {
        const presentationId = editingPresentation?.id;
        if (!presentationId) return { tables: [], activeTableId: null };

        const pres = (projectInput.reportPresentations || []).find((p) => p.id === presentationId) as any;
        const rawTables = (pres?.canvasTables || []) as CanvasWidgetTable[];
        const dsList = ensureDataSources(projectInput).project.dataSources || [];

        const tables = (rawTables || []).map((t) => {
          const ds = dsList.find((s) => s.id === t.dataSourceId);
          return {
            id: t.id,
            name: t.name,
            dataSourceId: t.dataSourceId,
            dataSourceName: ds?.name || 'Unknown',
            dataSourceKind: ds?.kind || '',
          };
        });

        const activeTableId =
          (typeof pres?.canvasActiveTableId === 'string' && tables.find((t) => t.id === pres.canvasActiveTableId) ? pres.canvasActiveTableId : null) ||
          (tables[0]?.id ?? null);

        return { tables, activeTableId };
      },
      [editingPresentation?.id]
    );

    const sendCanvasContextToIframe = useCallback(
      (projectInput?: Project) => {
        if (!iframeWindow) return;
        const payload = buildCanvasContextPayload(projectInput || normalizedProject);
        iframeWindow.postMessage({ source: 'realdata-host', type: 'canvas-context', payload }, '*');
      },
      [buildCanvasContextPayload, iframeWindow, normalizedProject]
    );

    const activeCanvasTable = useMemo(() => {
      if (!canvasActiveTableId) return null;
      return canvasTables.find((t) => t.id === canvasActiveTableId) || null;
    }, [canvasActiveTableId, canvasTables]);

    const activeCanvasSource = useMemo(() => {
      if (!activeCanvasTable) return null;
      return (projectWithSources.dataSources || []).find((s) => s.id === activeCanvasTable.dataSourceId) || null;
    }, [activeCanvasTable, projectWithSources.dataSources]);

    const activeCanvasColumns = useMemo(() => {
      if (!activeCanvasTable) return [];
      if (projectWithSources.transformRules && projectWithSources.transformRules.length > 0) {
        return projectWithSources.transformRules.map((r) => r.targetName);
      }
      if (activeCanvasSource?.columns?.length) return activeCanvasSource.columns.map((c) => c.key);
      return [];
    }, [activeCanvasSource?.columns, activeCanvasTable, projectWithSources.transformRules]);

    const activeCanvasFilters = useMemo(() => {
      const f = activeCanvasTable?.filters || [];
      return Array.isArray(f) ? f : [];
    }, [activeCanvasTable?.filters]);

    const getCanvasFilterDataType = useCallback(
      (column: string): DashboardFilter['dataType'] => {
        const col = activeCanvasSource?.columns?.find((c) => c.key === column);
        if (col?.type === 'date') return 'date';
        if (col?.type === 'number') return 'number';
        const samples = canvasFilterRows.slice(0, 80).map((r) => String((r as any)?.[column] ?? '')).filter(Boolean);
        const dateLikes = samples.filter((s) => !!toDate(s)).length;
        if (samples.length >= 12 && dateLikes / samples.length >= 0.7) return 'date';
        return 'text';
      },
      [activeCanvasSource?.columns, canvasFilterRows]
    );

    const persistCanvasTableFilters = useCallback(
      async (tableId: string, nextFilters: DashboardFilter[]) => {
        if (!editingPresentation) return;
        const existingTables = (editingPresentation.canvasTables || []) as CanvasWidgetTable[];
        const nextTables = existingTables.map((t) =>
          t.id === tableId ? { ...t, filters: nextFilters, updatedAt: Date.now() } : t
        );
        const updatedProject = updatePresentationCanvasTables(normalizedProject, editingPresentation.id, nextTables);
        await persistProject(updatedProject);
        sendCanvasContextToIframe(updatedProject);
      },
      [editingPresentation, normalizedProject, persistProject, sendCanvasContextToIframe]
    );

    const persistCanvasActiveTable = useCallback(
      async (tableId: string) => {
        if (!editingPresentation) return;
        const updatedProject = updatePresentationCanvasActiveTable(normalizedProject, editingPresentation.id, tableId);
        await persistProject(updatedProject);
        sendCanvasContextToIframe(updatedProject);
      },
      [editingPresentation, normalizedProject, persistProject, sendCanvasContextToIframe]
    );

    const addCanvasFilter = useCallback(
      async (column: string) => {
        if (!activeCanvasTable) return;
        const dataType = getCanvasFilterDataType(column);
        const next: DashboardFilter = {
          id: crypto.randomUUID(),
          column,
          value: '',
          dataType,
          ...(dataType === 'date' ? { operator: 'between', endValue: '' } : {}),
        };
        const nextFilters = [...activeCanvasFilters, next];
        await persistCanvasTableFilters(activeCanvasTable.id, nextFilters);
        setCanvasNewFilterCol('');
      },
      [activeCanvasFilters, activeCanvasTable, getCanvasFilterDataType, persistCanvasTableFilters]
    );

    const removeCanvasFilter = useCallback(
      async (filterId: string) => {
        if (!activeCanvasTable) return;
        const nextFilters = activeCanvasFilters.filter((f) => f.id !== filterId);
        await persistCanvasTableFilters(activeCanvasTable.id, nextFilters);
      },
      [activeCanvasFilters, activeCanvasTable, persistCanvasTableFilters]
    );

    const updateCanvasFilterValue = useCallback(
      async (filterId: string, value: string, key: 'value' | 'endValue' = 'value') => {
        if (!activeCanvasTable) return;
        const nextFilters = activeCanvasFilters.map((f) => (f.id === filterId ? { ...f, [key]: value } : f));
        await persistCanvasTableFilters(activeCanvasTable.id, nextFilters);
      },
      [activeCanvasFilters, activeCanvasTable, persistCanvasTableFilters]
    );

    const updateCanvasDateFilterOperator = useCallback(
      async (filterId: string, operator: DashboardFilter['operator']) => {
        if (!activeCanvasTable) return;
        const nextFilters = activeCanvasFilters.map((f) => (f.id === filterId ? { ...f, operator } : f));
        await persistCanvasTableFilters(activeCanvasTable.id, nextFilters);
      },
      [activeCanvasFilters, activeCanvasTable, persistCanvasTableFilters]
    );

    const getUniqueValues = useCallback(
      (column: string) => {
        const unique = new Set<string>();
        for (const row of canvasFilterRows) {
          const raw = (row as any)?.[column];
          const s = String(raw ?? '').trim();
          if (!s) continue;
          unique.add(s);
          if (unique.size >= 500) break;
        }
        return Array.from(unique).sort();
      },
      [canvasFilterRows]
    );

    useEffect(() => {
      if (!activeCanvasTable) {
        setCanvasFilterRows([]);
        setCanvasNewFilterCol('');
        return;
      }

      let cancelled = false;
      void (async () => {
        try {
          const rows = await loadRowsForDataSource(activeCanvasTable.dataSourceId);
          if (cancelled) return;
          setCanvasFilterRows(rows.slice(0, 20000));
        } catch (e) {
          console.error('[ReportBuilder] canvas filter rows failed:', e);
          if (!cancelled) setCanvasFilterRows([]);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [activeCanvasTable?.id, activeCanvasTable?.dataSourceId, loadRowsForDataSource]);

    const canvasRefreshTimerRef = useRef<number | null>(null);
    useEffect(() => {
      if (!iframeWindow) return;
      if (!activeCanvasTable) return;
      if (!isEditorReady) return;

      if (canvasRefreshTimerRef.current) window.clearTimeout(canvasRefreshTimerRef.current);
      canvasRefreshTimerRef.current = window.setTimeout(() => {
        iframeWindow.postMessage({ source: 'realdata-host', type: 'request-canvas-refresh' }, '*');
      }, 350);

      return () => {
        if (canvasRefreshTimerRef.current) window.clearTimeout(canvasRefreshTimerRef.current);
        canvasRefreshTimerRef.current = null;
      };
    }, [activeCanvasTable?.filters, iframeWindow, isEditorReady]);

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

	  const ensurePptxWorkerSource = useCallback(
	    (dashboard: ProjectDashboard | null | undefined) => {
	      const worker = pptxWorkerRef.current;
	      if (!worker) return null;

	      const desiredSourceId =
	        dashboard?.dataSourceId ||
	        projectWithSources.activeDataSourceId ||
	        projectWithSources.dataSources?.[0]?.id;

	      const sourceMeta =
	        (desiredSourceId && projectWithSources.dataSources?.find((s) => s.id === desiredSourceId)) ||
	        (projectWithSources.activeDataSourceId &&
	          projectWithSources.dataSources?.find((s) => s.id === projectWithSources.activeDataSourceId)) ||
	        projectWithSources.dataSources?.[0];

	      const dataVersion = sourceMeta?.updatedAt ?? projectWithSources.lastModified;
	      const key = `${projectWithSources.id}:${desiredSourceId || ''}:${dataVersion || 0}:${transformRulesHash}`;

	      if (pptxSourceKeyRef.current !== key) {
	        pptxSourceKeyRef.current = key;
	        pptxRowsVersionRef.current += 1;
	        const rowsVersion = pptxRowsVersionRef.current;
	        worker.postMessage({
	          type: 'setSource',
	          projectId: projectWithSources.id,
	          dataSourceId: desiredSourceId,
	          dataVersion,
	          transformRules: projectWithSources.transformRules,
	          rowsVersion,
	        });
	        return rowsVersion;
	      }

	      return pptxRowsVersionRef.current;
	    },
	    [
	      projectWithSources.activeDataSourceId,
	      projectWithSources.dataSources,
	      projectWithSources.id,
	      projectWithSources.lastModified,
	      projectWithSources.transformRules,
	      transformRulesHash,
	    ]
	  );

	  const requestPptxPayload = useCallback(
	    async (dashboard: ProjectDashboard, widget: DashboardWidget) => {
	      const worker = pptxWorkerRef.current;
	      if (!worker) return null;

	      const rowsVersion = ensurePptxWorkerSource(dashboard);
	      if (!rowsVersion) return null;

	      const requestId = crypto.randomUUID();
	      return await new Promise<DashboardChartInsertPayload | null>((resolve, reject) => {
	        pptxPendingRef.current.set(requestId, { rowsVersion, resolve, reject });
	        worker.postMessage({
	          type: 'buildPptxPayload',
	          requestId,
	          rowsVersion,
	          widget,
	          filters: dashboard.globalFilters,
	          theme: REALPPTX_CHART_THEME,
	          sourceDashboardId: dashboard.id,
	        });
	      });
	    },
	    [ensurePptxWorkerSource]
	  );

    const requestCanvasPptxPayload = useCallback(
      async (dataSourceId: string, widget: DashboardWidget, filters: DashboardFilter[]) => {
        const worker = pptxWorkerRef.current;
        if (!worker) return null;

        const rowsVersion = ensurePptxWorkerSource({ dataSourceId } as any);
        if (!rowsVersion) return null;

        const requestId = crypto.randomUUID();
        return await new Promise<DashboardChartInsertPayload | null>((resolve, reject) => {
          pptxPendingRef.current.set(requestId, { rowsVersion, resolve, reject });
          worker.postMessage({
            type: 'buildPptxPayload',
            requestId,
            rowsVersion,
            widget,
            filters,
            theme: REALPPTX_CHART_THEME,
          });
        });
      },
      [ensurePptxWorkerSource]
    );

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
	        const dashboard = dashboardsForInsert.find((dash) => dash.id === selectedDashboardId) || dashboardsForInsert[0];
	        if (!dashboard) return;

	        const payload = await requestPptxPayload(dashboard, widget);
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
	    [dashboardsForInsert, iframeWindow, requestPptxPayload, selectedDashboardId, showToast]
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

      if (event.data.type === 'request-canvas-context') {
        sendCanvasContextToIframe();
      }

      if (event.data.type === 'open-canvas-table-picker') {
        const requestId = event.data.payload?.requestId as string | undefined;
        if (!requestId) return;
        setCanvasTablePickerRequestId(requestId);
        setCanvasTablePickerOpen(true);
      }

      if (event.data.type === 'create-canvas-table') {
        const name = String(event.data.payload?.name || '').trim();
        const dataSourceId = String(event.data.payload?.dataSourceId || '').trim();
        if (!editingPresentation) return;
        if (!name || !dataSourceId) {
          showToast('Invalid table', 'Name and data source are required.', 'warning');
          iframeWindow?.postMessage({ source: 'realdata-host', type: 'canvas-table-create-error' }, '*');
          return;
        }

        const existing = (editingPresentation.canvasTables || []) as CanvasWidgetTable[];
        const exists = existing.some((t) => t.name.trim().toLowerCase() === name.toLowerCase());
        if (exists) {
          showToast('Duplicate name', 'Table name already exists.', 'warning');
          iframeWindow?.postMessage({ source: 'realdata-host', type: 'canvas-table-create-error' }, '*');
          return;
        }

        const nowMs = Date.now();
        const nextTable: CanvasWidgetTable = {
          id: crypto.randomUUID(),
          name,
          dataSourceId,
          filters: [],
          createdAt: nowMs,
          updatedAt: nowMs,
        };

        void (async () => {
          const nextTables = [...existing, nextTable];
          let updatedProject = updatePresentationCanvasTables(normalizedProject, editingPresentation.id, nextTables);
          updatedProject = updatePresentationCanvasActiveTable(updatedProject, editingPresentation.id, nextTable.id);
          await persistProject(updatedProject);
          sendCanvasContextToIframe(updatedProject);
          showToast('Table created', nextTable.name, 'success');
        })();
      }

      if (event.data.type === 'delete-canvas-table') {
        const tableId = String(event.data.payload?.tableId || '');
        if (!editingPresentation || !tableId) return;

        const usedByWidget = (editingPresentation.slides as any[] | undefined)?.some((slide) =>
          Array.isArray(slide?.elements) ? slide.elements.some((el: any) => el?.canvasTableId === tableId) : false
        );
        if (usedByWidget) {
          showToast('Table in use', 'Remove widgets before deleting this table.', 'warning');
          return;
        }

        const existing = (editingPresentation.canvasTables || []) as CanvasWidgetTable[];
        const nextTables = existing.filter((t) => t.id !== tableId);
        const nextActive =
          editingPresentation.canvasActiveTableId === tableId ? (nextTables[0]?.id ?? undefined) : editingPresentation.canvasActiveTableId;

        void (async () => {
          let updatedProject = updatePresentationCanvasTables(normalizedProject, editingPresentation.id, nextTables);
          updatedProject = updatePresentationCanvasActiveTable(updatedProject, editingPresentation.id, nextActive);
          await persistProject(updatedProject);
          sendCanvasContextToIframe(updatedProject);
          showToast('Table deleted', 'Table removed.', 'success');
        })();
      }

      if (event.data.type === 'set-active-canvas-table') {
        const tableId = String(event.data.payload?.tableId || '');
        if (!editingPresentation) return;
        if (!tableId) return;
        if (!(editingPresentation.canvasTables || []).find((t) => t.id === tableId)) return;

        void (async () => {
          const updatedProject = updatePresentationCanvasActiveTable(normalizedProject, editingPresentation.id, tableId);
          await persistProject(updatedProject);
          sendCanvasContextToIframe(updatedProject);
        })();
      }

      if (event.data.type === 'open-canvas-widget-create') {
        const tableId = String(event.data.payload?.tableId || '');
        if (!editingPresentation || !tableId) return;
        if (!(editingPresentation.canvasTables || []).find((t) => t.id === tableId)) return;
        setCanvasBuilderTargetElementId(null);
        setCanvasBuilderInitialWidget(null);
        setCanvasBuilderTableId(tableId);
        setCanvasBuilderOpen(true);
      }

      if (event.data.type === 'open-canvas-widget-edit') {
        const tableId = String(event.data.payload?.tableId || '');
        const elementId = String(event.data.payload?.elementId || '');
        const widget = event.data.payload?.widget as DashboardWidget | undefined;
        if (!editingPresentation || !tableId || !elementId || !widget) return;
        if (!(editingPresentation.canvasTables || []).find((t) => t.id === tableId)) return;
        setCanvasBuilderTargetElementId(elementId);
        setCanvasBuilderInitialWidget(widget);
        setCanvasBuilderTableId(tableId);
        setCanvasBuilderOpen(true);
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

      // Automation Report: Handle update request for linked charts / canvas widgets
	      if (event.data.type === 'request-chart-updates') {
          const mode = (event.data.payload?.mode as 'dashboard' | 'canvas' | undefined) || 'dashboard';

          if (mode === 'canvas') {
            const canvasElements = event.data.payload?.canvasElements as Array<{
              elementId: string;
              canvasTableId: string;
              widget?: DashboardWidget;
            }> | undefined;

            if (!iframeWindow) return;
            if (!editingPresentation) return;
            if (!canvasElements || canvasElements.length === 0) {
              showToast('No widgets', 'No canvas widgets found.', 'info');
              return;
            }

            void (async () => {
              let updatedCount = 0;
              for (const item of canvasElements) {
                const table = (editingPresentation.canvasTables || []).find((t) => t.id === item.canvasTableId);
                if (!table) continue;
                const widget = item.widget;
                if (!widget) continue;

                const payload = await requestCanvasPptxPayload(table.dataSourceId, widget, table.filters || []);
                if (!payload) continue;

                iframeWindow.postMessage(
                  {
                    source: 'realdata-host',
                    type: 'upsert-canvas-widget',
                    payload: {
                      elementId: item.elementId,
                      chart: payload,
                      canvas: { tableId: table.id, widget },
                    },
                  },
                  '*'
                );

                updatedCount++;
              }

              if (updatedCount > 0) {
                showToast('Widgets updated', `${updatedCount} element(s) refreshed.`, 'success');
              } else {
                showToast('No updates', 'No matching widgets to update.', 'warning');
              }
            })();

            return;
          }

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

	        void (async () => {
	          let updatedCount = 0;

	          const byDashboard = new Map<string, typeof linkedCharts>();
	          for (const linked of linkedCharts) {
	            if (!linked?.dashboardId) continue;
	            const list = byDashboard.get(linked.dashboardId) || [];
	            list.push(linked);
	            byDashboard.set(linked.dashboardId, list);
	          }

	          for (const [dashboardId, links] of byDashboard) {
	            const dashboard = dashboardsForInsert.find((d) => d.id === dashboardId);
	            if (!dashboard) continue;

	            for (const linked of links) {
	              const widget = dashboard.widgets?.find((w) => w.id === linked.widgetId);
	              if (!widget) continue;

	              const payload = await requestPptxPayload(dashboard, widget);
	              if (!payload) continue;

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
	            }
	          }

	          if (updatedCount > 0) {
	            showToast('Charts updated', `${updatedCount} element(s) refreshed with latest data.`, 'success');
	          } else {
	            showToast('No updates', 'Could not find matching widgets for linked charts.', 'warning');
	          }
	        })();
	      }

      // Automation Report: No linked charts message
      if (event.data.type === 'no-linked-charts') {
        showToast('No linked charts', 'Insert charts from Dashboard first to enable updates.', 'info');
      }

      if (event.data.type === 'no-canvas-widgets') {
        showToast('No widgets', 'No canvas widgets found.', 'info');
      }
	    },
	    [dashboardsForInsert, editingPresentation, iframeWindow, normalizedProject, pendingSaveIntent, persistProject, persistSlidesFromExport, queueAutosave, requestCanvasPptxPayload, requestPresentationExport, requestPptxPayload, sendCanvasContextToIframe, showToast]
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
    sendCanvasContextToIframe();
  }, [editingPresentation, iframeWindow, mode, isEditorReady, globalSettings, sendCanvasContextToIframe]);

  const normalizeDateOperator = useCallback((op?: string) => {
    if (op === 'between' || op === 'on' || op === 'before' || op === 'after') return op;
    return 'between';
  }, []);

  const normalizeRangeStart = useCallback((raw?: string | null) => {
    const d = toDate(raw);
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }, []);

  const normalizeRangeEnd = useCallback((raw?: string | null) => {
    const d = toDate(raw);
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }, []);

  const matchesFilterCondition = useCallback(
    (row: RawRow, filter: DashboardFilter) => {
      const value = (row as any)[filter.column];
      if (filter.dataType === 'date') {
        const rowDate = toDate(value);
        if (!rowDate) return false;
        const operator = normalizeDateOperator(filter.operator);
        if (operator === 'between') {
          const start = normalizeRangeStart(filter.value);
          const end = normalizeRangeEnd((filter as any).endValue);
          if (start && rowDate < start) return false;
          if (end && rowDate > end) return false;
          if (!start && !end) return true;
          return true;
        }

        const start = normalizeRangeStart(filter.value);
        const end = normalizeRangeEnd(filter.value);
        if (!start || !end) return true;

        if (operator === 'on') return rowDate >= start && rowDate <= end;
        if (operator === 'before') return rowDate < start;
        return rowDate > end;
      }

      if (!filter.value) return true;
      return String(value ?? '').toLowerCase() === String(filter.value).toLowerCase();
    },
    [normalizeDateOperator, normalizeRangeEnd, normalizeRangeStart]
  );

  useEffect(() => {
    if (!isCanvasBuilderOpen || !canvasBuilderTableId || !editingPresentation) return;

    const table = (editingPresentation.canvasTables || []).find((t) => t.id === canvasBuilderTableId);
    if (!table) return;

    setCanvasBuilderLoading(true);
    setCanvasBuilderRows([]);
    setCanvasBuilderColumns([]);
    setCanvasBuilderWorkerSource(undefined);

    void (async () => {
      try {
        const src = (projectWithSources.dataSources || []).find((s) => s.id === table.dataSourceId);
        const dataVersion = src?.updatedAt ?? projectWithSources.lastModified;
        const workerSource: MagicAggregationWorkerSource = {
          mode: 'dataSource',
          projectId: projectWithSources.id,
          dataSourceId: table.dataSourceId,
          dataVersion,
          transformRules: projectWithSources.transformRules,
        } as any;

        setCanvasBuilderWorkerSource(workerSource);

        const rows = await loadRowsForDataSource(table.dataSourceId);
        const filtered = (table.filters || []).length ? rows.filter((r) => (table.filters || []).every((f) => matchesFilterCondition(r, f))) : rows;
        setCanvasBuilderRows(filtered);

        const availableColumns =
          projectWithSources.transformRules && projectWithSources.transformRules.length > 0
            ? projectWithSources.transformRules.map((r) => r.targetName)
            : src?.columns?.length
              ? src.columns.map((c) => c.key)
              : filtered[0]
                ? Object.keys(filtered[0])
                : [];

        setCanvasBuilderColumns(availableColumns);
      } catch (e) {
        console.error('[ReportBuilder] canvas widget builder load failed:', e);
        showToast('Load failed', 'Unable to load table rows.', 'error');
      } finally {
        setCanvasBuilderLoading(false);
      }
    })();
  }, [
    canvasBuilderTableId,
    editingPresentation,
    isCanvasBuilderOpen,
    loadRowsForDataSource,
    matchesFilterCondition,
    projectWithSources.dataSources,
    projectWithSources.id,
    projectWithSources.lastModified,
    projectWithSources.transformRules,
    showToast,
  ]);

  const handleSaveCanvasWidget = useCallback(
    async (widget: DashboardWidget) => {
      if (!iframeWindow) return;
      if (!editingPresentation || !canvasBuilderTableId) return;
      const table = (editingPresentation.canvasTables || []).find((t) => t.id === canvasBuilderTableId);
      if (!table) return;

      const payload = await requestCanvasPptxPayload(table.dataSourceId, widget, table.filters || []);
      if (!payload) {
        showToast('No data', 'This chart has no data after filters.', 'warning');
        return;
      }

      iframeWindow.postMessage(
        {
          source: 'realdata-host',
          type: 'upsert-canvas-widget',
          payload: {
            elementId: canvasBuilderTargetElementId || undefined,
            chart: payload,
            canvas: { tableId: table.id, widget },
          },
        },
        '*'
      );

      setCanvasBuilderOpen(false);
      setCanvasBuilderTableId(null);
      setCanvasBuilderTargetElementId(null);
      setCanvasBuilderInitialWidget(null);
      showToast('Widget saved', widget.title || 'Widget updated.', 'success');
    },
    [canvasBuilderTableId, canvasBuilderTargetElementId, editingPresentation, iframeWindow, requestCanvasPptxPayload, showToast]
  );

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

        {activeCanvasTable && (
          <div className="bg-white border-b border-gray-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-700">Magic Filters</span>
              </div>

              {canvasTables.length > 1 && (
                <select
                  className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={canvasActiveTableId || ''}
                  onChange={(e) => void persistCanvasActiveTable(e.target.value)}
                >
                  {canvasTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {activeCanvasFilters.map((filter) =>
                  filter.dataType === 'date' ? (
                    <div
                      key={filter.id}
                      className="flex flex-wrap items-center bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 gap-2"
                    >
                      <span className="text-[11px] font-bold text-indigo-800 uppercase">{filter.column}</span>
                      <select
                        className="bg-transparent text-[11px] font-semibold text-indigo-700 border border-indigo-200 rounded px-1.5 py-1 focus:ring-2 focus:ring-indigo-400 outline-none"
                        value={normalizeDateOperator(filter.operator)}
                        onChange={(e) => void updateCanvasDateFilterOperator(filter.id, e.target.value as any)}
                      >
                        <option value="between">Is between</option>
                        <option value="on">Is on</option>
                        <option value="before">Before</option>
                        <option value="after">After</option>
                      </select>
                      <div className="flex items-center gap-1">
                        <input
                          type="date"
                          value={filter.value || ''}
                          onChange={(e) => void updateCanvasFilterValue(filter.id, e.target.value)}
                          className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                        />
                        {normalizeDateOperator(filter.operator) === 'between' && (
                          <>
                            <span className="text-[10px] text-indigo-500">to</span>
                            <input
                              type="date"
                              value={filter.endValue || ''}
                              onChange={(e) => void updateCanvasFilterValue(filter.id, e.target.value, 'endValue')}
                              className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                            />
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => void removeCanvasFilter(filter.id)}
                        className="text-indigo-400 hover:text-indigo-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div
                      key={filter.id}
                      className="flex items-center bg-blue-50 border border-blue-100 rounded-lg px-2 py-1"
                    >
                      <span className="text-[11px] font-bold text-blue-800 mr-2 uppercase">{filter.column}:</span>
                      <select
                        className="bg-transparent text-xs text-blue-900 border-none focus:ring-0 p-0 pr-5 cursor-pointer font-medium outline-none"
                        value={filter.value || ''}
                        onChange={(e) => void updateCanvasFilterValue(filter.id, e.target.value)}
                      >
                        <option value="">All</option>
                        {getUniqueValues(filter.column).map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => void removeCanvasFilter(filter.id)} className="ml-2 text-blue-400 hover:text-blue-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                )}

                <div className="flex items-center">
                  <select
                    className="text-xs border border-gray-300 rounded-l-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    value={canvasNewFilterCol}
                    onChange={(e) => setCanvasNewFilterCol(e.target.value)}
                  >
                    <option value="">+ Add Filter</option>
                    {activeCanvasColumns.filter((c) => !activeCanvasFilters.find((f) => f.column === c)).map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!canvasNewFilterCol}
                    onClick={() => void addCanvasFilter(canvasNewFilterCol)}
                    className="bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg px-2.5 py-1.5 hover:bg-gray-200 disabled:opacity-50 text-xs font-semibold uppercase"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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

          <DataSourcePickerModal
            isOpen={isCanvasTablePickerOpen}
            title="Select Data Source"
            ingestionSources={ingestionSources}
            preparedSources={preparedSources}
            selectedSourceId={null}
            onSelect={(src) => {
              if (!iframeWindow || !canvasTablePickerRequestId) {
                setCanvasTablePickerOpen(false);
                setCanvasTablePickerRequestId(null);
                return;
              }
              const rowCount = typeof src.rowCount === 'number' ? src.rowCount : src.rows.length;
              iframeWindow.postMessage(
                {
                  source: 'realdata-host',
                  type: 'canvas-table-picked',
                  payload: {
                    requestId: canvasTablePickerRequestId,
                    source: {
                      id: src.id,
                      name: src.name,
                      kind: src.kind,
                      rowCount,
                    },
                  },
                },
                '*'
              );
              setCanvasTablePickerOpen(false);
              setCanvasTablePickerRequestId(null);
            }}
            onClose={() => {
              setCanvasTablePickerOpen(false);
              setCanvasTablePickerRequestId(null);
            }}
          />

          <ChartBuilder
            isOpen={isCanvasBuilderOpen}
            onClose={() => {
              setCanvasBuilderOpen(false);
              setCanvasBuilderTableId(null);
              setCanvasBuilderTargetElementId(null);
              setCanvasBuilderInitialWidget(null);
            }}
            onSave={handleSaveCanvasWidget}
            availableColumns={canvasBuilderColumns}
            initialWidget={canvasBuilderInitialWidget}
            data={canvasBuilderRows}
            chartTheme={REALPPTX_CHART_THEME}
            workerSource={canvasBuilderWorkerSource}
          />
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
