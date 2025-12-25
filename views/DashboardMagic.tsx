import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Edit3,
  LayoutDashboard,
  Plus,
  Trash2,
  Filter,
  MousePointer2,
  Eye,
  EyeOff,
  FileOutput,
  Loader2,
  X,
  Table,
  Copy,
  Download,
  Presentation,
  GripHorizontal,
  Move,
  Save
} from 'lucide-react';
import EmptyState from '../components/EmptyState';
import ChartBuilder from '../components/ChartBuilder';
import MagicWidgetRenderer from '../components/MagicWidgetRenderer';
import DataSourcePickerModal from '../components/DataSourcePickerModal';
import { Project, ProjectDashboard, DashboardWidget, DashboardFilter, DrillDownState, RawRow, FilterDataType, DateFilterOperator } from '../types';
import {
  ensureMagicDashboards,
  addMagicDashboard,
  removeMagicDashboard,
  setActiveMagicDashboard,
  setMagicDashboardDataSource,
  updateMagicDashboardWidgets,
  updateMagicDashboardGlobalFilters,
  renameMagicDashboard,
} from '../utils/dashboards';
import { ensureDataSources, getDataSourcesByKind } from '../utils/dataSources';
import { resolveDashboardBaseData } from '../utils/dashboardData';
import { saveProject } from '../utils/storage-compat';
import { getAllDataChunks, getAllDataSourceChunks } from '../utils/storage-v2';
import { REALPPTX_CHART_THEME } from '../constants/chartTheme';
import { exportToExcel } from '../utils/excel';
import { generatePowerPoint } from '../utils/report';
import { useMagicAggregationWorker } from '../hooks/useMagicAggregationWorker';
import { applyWidgetFilters, getTopNOverflowDimensionValues } from '../utils/widgetData';
import { applyTransformation } from '../utils/transform';

// --- Helper Functions (Ported from Analytics.tsx) ---
const SAMPLE_SIZE = 50;

const normalizeDateOperator = (operator?: DateFilterOperator): DateFilterOperator => {
  if (operator === 'on' || operator === 'before' || operator === 'after' || operator === 'between') return operator;
  return 'between';
};

const toDateValue = (value: any): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
};

const normalizeDateInputValue = (value: string): string => {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
};

const normalizeRangeStart = (value?: string) => {
  if (!value) return null;
  const date = toDateValue(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeRangeEnd = (value?: string) => {
  if (!value) return null;
  const date = toDateValue(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const inferColumnType = (column: string, rows: RawRow[]): FilterDataType => {
  const samples: any[] = [];
  for (let i = 0; i < rows.length && samples.length < SAMPLE_SIZE; i++) {
    const val = rows[i][column];
    if (val !== undefined && val !== null && val !== '') {
      samples.push(val);
    }
  }

  if (samples.length === 0) return 'text';

  const dateLikes = samples.filter((val) => {
    if (val instanceof Date) return !isNaN(val.getTime());
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length < 6) return false;
      const containsDateSep = /[-/]/.test(trimmed);
      const parsed = Date.parse(trimmed);
      return containsDateSep && !Number.isNaN(parsed);
    }
    return false;
  });
  if (dateLikes.length / samples.length >= 0.6) return 'date';

  const numberLikes = samples.filter((val) => {
    if (typeof val === 'number') return true;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return false;
      return !Number.isNaN(Number(trimmed));
    }
    return false;
  });
  if (numberLikes.length / samples.length >= 0.6) return 'number';

  return 'text';
};

interface DashboardMagicProps {
  project: Project;
  onUpdateProject?: (project: Project) => void;
}

const DashboardMagic: React.FC<DashboardMagicProps> = ({ project, onUpdateProject }) => {
  const { project: withDataSources } = useMemo(() => ensureDataSources(project), [project]);
  const { project: normalizedProject, dashboards, activeDashboard, changed } = useMemo(
    () => ensureMagicDashboards(withDataSources),
    [withDataSources]
  );

  useEffect(() => {
    if (changed && onUpdateProject) {
      onUpdateProject(normalizedProject);
      saveProject(normalizedProject);
    }
  }, [changed, normalizedProject, onUpdateProject]);

  const [mode, setMode] = useState<'list' | 'editor'>('list');
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string>('');
  const [isCreateSourcePickerOpen, setCreateSourcePickerOpen] = useState(false);
  const [isEditorSourcePickerOpen, setEditorSourcePickerOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(activeDashboard?.widgets || []);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);

  // --- New States for Filters & Interaction ---
  const [filters, setFilters] = useState<DashboardFilter[]>([]);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
	  const [interactionMode, setInteractionMode] = useState<'drill' | 'filter'>('drill');
	  const [isExporting, setIsExporting] = useState(false);
	  const [isSaving, setIsSaving] = useState(false);
	  const [newFilterCol, setNewFilterCol] = useState('');
	  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
	  const [filterValueOptions, setFilterValueOptions] = useState<Record<string, string[]>>({});
	  const filterValueLoadingRef = useRef<Set<string>>(new Set());

  // Grid State
  const [draggedWidget, setDraggedWidget] = useState<{ id: string; sectionIndex: number; colSpan: number; heightPx: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startSpan: number; colPx: number } | null>(null);
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ sectionIndex: number; beforeId?: string; afterId?: string } | null>(null);

  // Migration: Auto-assign sections and colSpan
  useEffect(() => {
    if (widgets.length > 0 && widgets.some((w) => w.sectionIndex === undefined || w.colSpan === undefined)) {
      const updated = widgets.map((w, idx) => {
        // Default logic: 2 widgets per section (no hard limit)
        const defaultSection = Math.floor(idx / 2);
        const defaultSpan = w.width === 'full' ? 4 : 2;
        return {
          ...w,
          sectionIndex: w.sectionIndex ?? defaultSection,
          colSpan: w.colSpan ?? defaultSpan,
        };
      });
      // Sort by section then id to keep stability
      updated.sort((a, b) => (a.sectionIndex || 0) - (b.sectionIndex || 0));
      setWidgets(updated);
      void handleSaveWidgets(updated);
    }
  }, [widgets.length]); // Check length or dependency that indicates load

  useEffect(() => {
    if (isCreateOpen && project.dataSources && project.dataSources.length > 0) {
      setSelectedDataSourceId(project.activeDataSourceId || project.dataSources[0].id);
    }
  }, [isCreateOpen, project.activeDataSourceId, project.dataSources]);

  const ingestionSources = useMemo(() => getDataSourcesByKind(normalizedProject, 'ingestion'), [normalizedProject]);
  const preparedSources = useMemo(() => getDataSourcesByKind(normalizedProject, 'prepared'), [normalizedProject]);

  useEffect(() => {
    if (activeDashboard) {
      setWidgets(activeDashboard.widgets);
    } else {
      setWidgets([]);
    }
  }, [activeDashboard]);

  useEffect(() => {
    if (dashboards.length === 0) {
      setMode('list');
      setSelectedDashboardId(null);
    }
  }, [dashboards.length]);

  const editingDashboard: ProjectDashboard | undefined =
    dashboards.find((d) => d.id === (selectedDashboardId || normalizedProject.activeMagicDashboardId)) || activeDashboard;

  useEffect(() => {
    setFilters(editingDashboard?.globalFilters || []);
  }, [editingDashboard?.id]);

  // --- Data Logic (Moved from Analytics.tsx) ---
  const { rows: baseData, availableColumns, dataSourceId: baseDataSourceId } = useMemo(() => {
    return resolveDashboardBaseData(normalizedProject, editingDashboard ?? null);
  }, [
    // Keep base data stable while editing widgets to avoid re-sending huge rows to the worker.
    normalizedProject.dataSources,
    normalizedProject.activeDataSourceId,
    normalizedProject.transformRules,
    editingDashboard?.dataSourceId,
  ]);

	  const workerSource = useMemo(() => {
	    const resolvedSource =
	      (baseDataSourceId && normalizedProject.dataSources?.find((s) => s.id === baseDataSourceId)) ||
	      (normalizedProject.activeDataSourceId && normalizedProject.dataSources?.find((s) => s.id === normalizedProject.activeDataSourceId)) ||
	      normalizedProject.dataSources?.[0];

    return {
      mode: 'dataSource' as const,
      projectId: normalizedProject.id,
      dataSourceId: baseDataSourceId || resolvedSource?.id,
      dataVersion: resolvedSource?.updatedAt ?? normalizedProject.lastModified,
      transformRules: normalizedProject.transformRules,
	    };
	  }, [baseDataSourceId, normalizedProject.dataSources, normalizedProject.activeDataSourceId, normalizedProject.id, normalizedProject.lastModified, normalizedProject.transformRules]);
	
	  const resolvedSourceForMagic = useMemo(() => {
	    const desiredId = workerSource.dataSourceId;
	    return (
	      (desiredId && normalizedProject.dataSources?.find((s) => s.id === desiredId)) ||
	      (normalizedProject.activeDataSourceId &&
	        normalizedProject.dataSources?.find((s) => s.id === normalizedProject.activeDataSourceId)) ||
	      normalizedProject.dataSources?.[0] ||
	      null
	    );
	  }, [workerSource.dataSourceId, normalizedProject.dataSources, normalizedProject.activeDataSourceId]);
	
	  const sourceColumnTypeMap = useMemo(() => {
	    const out: Record<string, FilterDataType> = {};
	    const cols = resolvedSourceForMagic?.columns || [];
	    for (const c of cols) {
	      if (!c?.key) continue;
	      if (c.type === 'date') out[c.key] = 'date';
	      else if (c.type === 'number') out[c.key] = 'number';
	      else out[c.key] = 'text';
	    }
	    return out;
	  }, [resolvedSourceForMagic?.id, resolvedSourceForMagic?.columns]);

	  const columnTypeMap = useMemo(() => {
	    const sampleRows = baseData.slice(0, SAMPLE_SIZE);
	    const map: Record<string, FilterDataType> = {};
	    availableColumns.forEach(col => {
	      map[col] = sourceColumnTypeMap[col] || inferColumnType(col, sampleRows);
	    });
	    return map;
	  }, [availableColumns, baseData, sourceColumnTypeMap]);

  const getColumnType = useCallback(
    (column: string): FilterDataType => columnTypeMap[column] || 'text',
    [columnTypeMap]
  );

  const matchesFilterCondition = useCallback((row: RawRow, filter: DashboardFilter) => {
    if (!filter.column) return true;
    const value = row[filter.column];
    if (filter.dataType === 'date') {
      const rowDate = toDateValue(value);
      if (!rowDate) return false;
      const operator = normalizeDateOperator(filter.operator);
      if (operator === 'between') {
        const start = normalizeRangeStart(filter.value);
        const end = normalizeRangeEnd(filter.endValue);
        if (start && rowDate < start) return false;
        if (end && rowDate > end) return false;
        if (!start && !end) return true;
        return true;
      }

      const start = normalizeRangeStart(filter.value);
      const end = normalizeRangeEnd(filter.value);
      if (!start || !end) return true;

      if (operator === 'on') {
        return rowDate >= start && rowDate <= end;
      }

      if (operator === 'before') {
        return rowDate < start;
      }

      // after
      return rowDate > end;
    }
    if (!filter.value) return true;
    return String(value ?? '').toLowerCase() === filter.value.toLowerCase();
  }, []);

	  const filteredData = useMemo(() => {
	    if (filters.length === 0) return baseData;
	    return baseData.filter(row => filters.every(f => matchesFilterCondition(row, f)));
	  }, [baseData, filters, matchesFilterCondition]);
	
	  const magicAggWorker = useMagicAggregationWorker(workerSource, REALPPTX_CHART_THEME);
	
	  const makeFilterValueKey = useCallback(
	    (col: string) => {
	      const dashId = editingDashboard?.id || 'unknown';
	      const sourceId = workerSource.dataSourceId || 'unknown';
	      const dataVersion = workerSource.dataVersion || 0;
	      return `${dashId}:${sourceId}:${dataVersion}:${col}`;
	    },
	    [editingDashboard?.id, workerSource.dataSourceId, workerSource.dataVersion]
	  );
	
	  const prefetchFilterValues = useCallback(
	    async (col: string) => {
	      const key = makeFilterValueKey(col);
	      if (filterValueOptions[key]) return;
	      if (filterValueLoadingRef.current.has(key)) return;
	      filterValueLoadingRef.current.add(key);
	
	      try {
	        if (magicAggWorker.isSupported) {
	          const values = await magicAggWorker.requestColumnOptions({
	            columnKey: col,
	            limitRows: 20000,
	            limitValues: 500,
	          });
	          setFilterValueOptions((prev) => ({ ...prev, [key]: values }));
	          return;
	        }
	
	        const unique = new Set(baseData.map((row) => String((row as any)?.[col] || '')));
	        const out = Array.from(unique).filter(Boolean).sort().slice(0, 100);
	        setFilterValueOptions((prev) => ({ ...prev, [key]: out }));
	      } catch (e) {
	        console.error('[DashboardMagic] filter values failed:', e);
	      } finally {
	        filterValueLoadingRef.current.delete(key);
	      }
	    },
	    [baseData, filterValueOptions, magicAggWorker, makeFilterValueKey]
	  );

  const drilldownReqRef = useRef(0);
  const drilldownRowsCacheRef = useRef<Map<string, { version: number; rows: RawRow[] }>>(new Map());

  const loadRowsForSource = useCallback(
    async (sourceId: string): Promise<RawRow[]> => {
      const src = (normalizedProject.dataSources || []).find((s) => s.id === sourceId);
      const version = src?.updatedAt ?? normalizedProject.lastModified ?? 0;

      const cached = drilldownRowsCacheRef.current.get(sourceId);
      if (cached && cached.version === version) return cached.rows;

      let rows = await getAllDataSourceChunks(normalizedProject.id, sourceId);
      if (rows.length === 0 && src && Array.isArray((src as any).rows) && (src as any).rows.length > 0) {
        rows = (src as any).rows as RawRow[];
      }
      if (rows.length === 0 && normalizedProject.activeDataSourceId === sourceId) {
        rows = await getAllDataChunks(normalizedProject.id);
      }
      const transformed =
        normalizedProject.transformRules && normalizedProject.transformRules.length > 0
          ? applyTransformation(rows, normalizedProject.transformRules)
          : rows;

      drilldownRowsCacheRef.current.set(sourceId, { version, rows: transformed });
      while (drilldownRowsCacheRef.current.size > 2) {
        const oldestKey = drilldownRowsCacheRef.current.keys().next().value as string | undefined;
        if (!oldestKey) break;
        drilldownRowsCacheRef.current.delete(oldestKey);
      }

      return transformed;
    },
    [normalizedProject.dataSources, normalizedProject.id, normalizedProject.lastModified, normalizedProject.transformRules]
  );

  const persistProject = useCallback(
    async (updated: Project) => {
      onUpdateProject?.(updated);
      await saveProject(updated);
    },
    [onUpdateProject]
  );

  const persistGlobalFilters = useCallback(
    async (nextFilters: DashboardFilter[]) => {
      if (!editingDashboard) return;
      const updated = updateMagicDashboardGlobalFilters(normalizedProject, editingDashboard.id, nextFilters);
      await persistProject(updated);
    },
    [editingDashboard, normalizedProject, persistProject]
  );

  // --- Filter Actions ---
	  const addFilter = (column: string, value: string = '') => {
	    if (!column) return;
	    const exists = filters.find(f => f.column === column);
	    if (exists) {
	      if (value) updateFilterValue(exists.id, value);
	      return;
	    }

    let dataType = getColumnType(column);
    let initialValue = value;
    let endValue: string | undefined;
    let operator: DateFilterOperator | undefined;

    if (dataType === 'date') {
      operator = 'between';
      if (value) {
        const normalized = normalizeDateInputValue(value);
        if (normalized) {
          initialValue = normalized;
        } else {
          dataType = 'text';
        }
      } else {
        initialValue = '';
        endValue = '';
      }
    }

    const newFilter: DashboardFilter = {
      id: crypto.randomUUID(),
      column,
      value: initialValue,
      endValue,
      dataType,
      operator,
    };
	    if (dataType !== 'date') {
	      void prefetchFilterValues(column);
	    }
	    setFilters((prev) => {
	      const next = [...prev, newFilter];
	      void persistGlobalFilters(next);
	      return next;
	    });
	    setNewFilterCol('');
	  };

  const removeFilter = (id: string) => {
    setFilters((prev) => {
      const next = prev.filter(f => f.id !== id);
      void persistGlobalFilters(next);
      return next;
    });
  };

  const updateFilter = (id: string, patch: Partial<DashboardFilter>) => {
    setFilters((prev) => {
      const next = prev.map(f => f.id === id ? { ...f, ...patch } : f);
      void persistGlobalFilters(next);
      return next;
    });
  };

  const updateFilterValue = (id: string, val: string, field: 'value' | 'endValue' = 'value') => {
    updateFilter(id, { [field]: val } as Partial<DashboardFilter>);
  };

  const updateDateFilterOperator = (id: string, operator: DateFilterOperator) => {
    updateFilter(id, {
      operator,
      ...(operator === 'between' ? {} : { endValue: '' }),
    });
  };

	  useEffect(() => {
	    for (const f of filters) {
	      if (!f?.column) continue;
	      if (f.dataType === 'date') continue;
	      void prefetchFilterValues(f.column);
	    }
	  }, [filters, prefetchFilterValues]);
	
	  const getUniqueValues = (col: string) => {
	    const key = makeFilterValueKey(col);
	    return filterValueOptions[key] || [];
	  };

  // --- Dashboard Actions ---
  const handleCreateDashboard = async () => {
    if (!onUpdateProject || !newDashboardName.trim()) return;
    const { project: updated, dashboard } = addMagicDashboard(normalizedProject, newDashboardName.trim(), selectedDataSourceId);
    await persistProject(updated);
    setNewDashboardName('');
    setIsCreateOpen(false);
    setSelectedDashboardId(dashboard.id);
    setMode('editor');
  };

  const handleOpenDashboard = async (dashboardId: string) => {
    const updated = setActiveMagicDashboard(normalizedProject, dashboardId);
    await persistProject(updated);
    setSelectedDashboardId(dashboardId);
    setMode('editor');
  };

  const handleDeleteDashboard = async (dashboardId: string) => {
    const target = dashboards.find((d) => d.id === dashboardId);
    if (!target) return;
    if (!window.confirm(`Delete dashboard "${target.name}"?`)) return;
    const updated = removeMagicDashboard(normalizedProject, dashboardId);
    await persistProject(updated);
    setMode('list');
    setSelectedDashboardId(null);
  };

  const handleRenameDashboard = async (dashboard: ProjectDashboard) => {
    const nextName = prompt('Rename dashboard', dashboard.name);
    if (!nextName || nextName.trim() === dashboard.name) return;
    const updated = renameMagicDashboard(normalizedProject, dashboard.id, nextName.trim());
    await persistProject(updated);
  };

  const handleSaveDashboard = async () => {
    if (!editingDashboard) return;
    setIsSaving(true);
    try {
      const updated = updateMagicDashboardWidgets(normalizedProject, editingDashboard.id, widgets);
      await persistProject(updated);
      // Small delay to show saving feedback
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWidgets = async (nextWidgets: DashboardWidget[]) => {
    if (!editingDashboard) return;
    const updated = updateMagicDashboardWidgets(normalizedProject, editingDashboard.id, nextWidgets);
    await persistProject(updated);
  };

  const handleSaveWidget = async (newWidget: DashboardWidget) => {
    let updatedWidgets = [...widgets];
    if (editingWidget) {
      updatedWidgets = updatedWidgets.map((w) => (w.id === newWidget.id ? newWidget : w));
    } else {
      // New widget goes to first section with space, or just append to last section
      // Requirement: At least 2 sections visible.
      // We'll add to the last section used or 0 if empty
      const lastSection = widgets.reduce((max, w) => Math.max(max, w.sectionIndex || 0), 0);
      newWidget.sectionIndex = lastSection;
      newWidget.colSpan = 2; // Default half
      updatedWidgets.push(newWidget);
    }
    setWidgets(updatedWidgets);
    setIsBuilderOpen(false);
    setEditingWidget(null);
    await handleSaveWidgets(updatedWidgets);
  };

  const handleDeleteWidget = async (widgetId: string) => {
    const updatedWidgets = widgets.filter((w) => w.id !== widgetId);
    setWidgets(updatedWidgets);
    await handleSaveWidgets(updatedWidgets);
  };

  const generateWidgetId = () => 'w-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  const deepClone = <T,>(value: T): T => {
    const sc = (globalThis as any).structuredClone as undefined | ((val: any) => any);
    if (typeof sc === 'function') return sc(value) as T;
    return JSON.parse(JSON.stringify(value)) as T;
  };

  const handleDuplicateWidget = async (widget: DashboardWidget) => {
    const copy = deepClone(widget);
    copy.id = generateWidgetId();
    const idx = widgets.findIndex((w) => w.id === widget.id);
    const next = [...widgets];
    next.splice(idx >= 0 ? idx + 1 : next.length, 0, copy);
    setWidgets(next);
    await handleSaveWidgets(next);
  };

  const handleActiveDataSourceChange = async (id: string) => {
    if (!editingDashboard) return;
    const updated = setMagicDashboardDataSource(normalizedProject, editingDashboard.id, id);
    await persistProject(updated);
  };

  const dashboardRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);

  const MAX_SECTIONS = 20;
  const GRID_GAP_PX = 24; // gap-6

  const getSectionCount = useCallback((nextWidgets: DashboardWidget[]) => {
    const maxIndex = nextWidgets.reduce((max, w) => Math.max(max, w.sectionIndex ?? 0), -1);
    return Math.min(MAX_SECTIONS, Math.max(2, maxIndex + 2)); // keep one empty tail section available
  }, []);

  const lastPopulatedSection = useMemo(() => {
    return widgets.reduce((max, w) => Math.max(max, w.sectionIndex ?? 0), -1);
  }, [widgets]);

  const renderedSectionCount = useMemo(() => {
    if (draggedWidget) return MAX_SECTIONS;
    return getSectionCount(widgets);
  }, [draggedWidget, getSectionCount, widgets]);

  const visibleSectionCount = useMemo(() => {
    if (draggedWidget) return renderedSectionCount;
    return Math.min(renderedSectionCount, Math.max(2, lastPopulatedSection + 2));
  }, [draggedWidget, lastPopulatedSection, renderedSectionCount]);

  const sections = useMemo(
    () => Array.from({ length: visibleSectionCount }, (_, i) => i),
    [visibleSectionCount]
  );

  const handleExportPPT = async () => {
    if (!dashboardRef.current || widgets.length === 0) {
      alert('No charts to export');
      return;
    }

    setIsExporting(true);
    try {
      const filtersStr = filters.map(f => `${f.column}: ${f.value}`).join(', ');
      await generatePowerPoint(
        normalizedProject,
        dashboardRef.current,
        filtersStr,
        widgets,
        filteredData,
        REALPPTX_CHART_THEME
      );
    } catch (e) {
      console.error('PPT export failed:', e);
      alert('Failed to export PPTX. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // --- Grid Handlers ---

  const onDragStart = (e: React.DragEvent, id: string, sectionIndex: number) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
      e.dataTransfer.setDragImage(img, 0, 0);
    } catch {
      // Ignore drag image failures
    }

    const target = e.currentTarget as HTMLElement;
    const cardEl = target.closest?.('[data-widget-id]') as HTMLElement | null;
    const rect = (cardEl ?? target).getBoundingClientRect();
    const w = widgets.find((x) => x.id === id);
    const colSpan = Math.max(1, Math.min(4, w?.colSpan || (w?.width === 'full' ? 4 : 2)));
    setDraggedWidget({ id, sectionIndex, colSpan, heightPx: Math.max(120, Math.round(rect.height)) });
    setDragOverSection(sectionIndex);
    setDropTarget(null);
  };

  const onDragOverSection = (e: React.DragEvent, sectionIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedWidget) return;

    setDragOverSection(sectionIndex);

    const scrollEl = editorScrollRef.current;
    if (scrollEl) {
      const r = scrollEl.getBoundingClientRect();
      const threshold = 90;
      const delta = 24;
      if (e.clientY < r.top + threshold) scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - delta);
      else if (e.clientY > r.bottom - threshold) scrollEl.scrollTop += delta;
    }

    const overWidget = (e.target as HTMLElement)?.closest?.('[data-widget-id]');
    if (overWidget) return;

    const sectionEl = e.currentTarget as HTMLElement;
    const candidates = Array.from(sectionEl.querySelectorAll<HTMLElement>('[data-widget-id]'))
      .filter((el) => el.dataset.widgetId && el.dataset.widgetId !== draggedWidget.id);

    if (candidates.length === 0) {
      setDropTarget({ sectionIndex });
      return;
    }

    const items = candidates.map((el) => ({ id: el.dataset.widgetId!, rect: el.getBoundingClientRect() }));

    const rowThresholdPx = 16;
    const rows: Array<{ top: number; items: typeof items }> = [];
    for (const item of items) {
      const row = rows.find((r) => Math.abs(r.top - item.rect.top) <= rowThresholdPx);
      if (row) {
        row.items.push(item);
      } else {
        rows.push({ top: item.rect.top, items: [item] });
      }
    }

    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) {
      row.items.sort((a, b) => a.rect.left - b.rect.left);
    }

    const x = e.clientX;
    const y = e.clientY;

    const bestRow = rows.reduce<{ idx: number; dist: number } | null>((best, row, idx) => {
      const centers = row.items.map((i) => i.rect.top + i.rect.height / 2);
      const centerY = centers.reduce((sum, c) => sum + c, 0) / Math.max(1, centers.length);
      const dist = Math.abs(y - centerY);
      if (!best || dist < best.dist) return { idx, dist };
      return best;
    }, null);

    const rowItems = bestRow ? rows[bestRow.idx].items : rows[0].items;
    const beforeInRow = rowItems.find((item) => x < item.rect.left + item.rect.width / 2);
    if (beforeInRow) {
      setDropTarget({ sectionIndex, beforeId: beforeInRow.id });
      return;
    }

    setDropTarget({ sectionIndex, afterId: rowItems[rowItems.length - 1].id });
  };

  const onDropSection = async (targetSection: number) => {
    if (!draggedWidget) return;
    const { id } = draggedWidget;

    const moving = widgets.find((w) => w.id === id);
    if (!moving) return;

    const next = widgets.filter((w) => w.id !== id);
    const moved = { ...moving, sectionIndex: targetSection };

    const target = dropTarget && dropTarget.sectionIndex === targetSection ? dropTarget : null;

    let insertIndex = next.length;
    if (target?.beforeId) {
      const idx = next.findIndex((w) => w.id === target.beforeId);
      if (idx >= 0) insertIndex = idx;
    } else if (target?.afterId) {
      const idx = next.findIndex((w) => w.id === target.afterId);
      if (idx >= 0) insertIndex = idx + 1;
    } else {
      const lastIdx = (() => {
        for (let i = next.length - 1; i >= 0; i--) {
          if ((next[i].sectionIndex ?? 0) === targetSection) return i;
        }
        return -1;
      })();
      if (lastIdx >= 0) insertIndex = lastIdx + 1;
    }

    next.splice(insertIndex, 0, moved);

    setWidgets(next);
    setDraggedWidget(null);
    setDragOverSection(null);
    setDropTarget(null);
    await handleSaveWidgets(next);
  };

  const onDragEnd = () => {
    setDraggedWidget(null);
    setDragOverSection(null);
    setDropTarget(null);
  };

  const onDragEnterSection = (sectionIndex: number) => {
    if (!draggedWidget) return;
    setDragOverSection(sectionIndex);
    if (!dropTarget || dropTarget.sectionIndex !== sectionIndex) {
      setDropTarget({ sectionIndex });
    }
  };

  const onDragOverWidget = (e: React.DragEvent, sectionIndex: number, widgetId: string) => {
    if (!draggedWidget) return;
    if (draggedWidget.id === widgetId) {
      setDragOverSection(sectionIndex);
      setDropTarget({ sectionIndex });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDragOverSection(sectionIndex);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBefore = e.clientY < rect.top + rect.height / 2;
    setDropTarget({
      sectionIndex,
      ...(isBefore ? { beforeId: widgetId } : { afterId: widgetId }),
    });
  };

  // Resize Logic
  const widgetsRef = useRef(widgets);
  useEffect(() => { widgetsRef.current = widgets; }, [widgets]);

  useEffect(() => {
    if (!resizing) return;
    const { id, startX, startSpan, colPx } = resizing;
    let raf = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const diff = e.clientX - startX;
        const step = colPx > 0 ? colPx : 1;
        const deltaCols = Math.round(diff / step);
        const newSpan = Math.max(1, Math.min(4, startSpan + deltaCols));
        setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, colSpan: newSpan } : w)));
      });
    };

    const handleMouseUp = async () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      setResizing(null);
      await handleSaveWidgets(widgetsRef.current);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, handleSaveWidgets]);


  // --- Interaction Handler (Filter vs Drill) ---
  const handleChartValueSelect = useCallback(
    (widget: DashboardWidget, activeLabel?: string, activeSeries?: string) => {
      void (async () => {
        const label = String(activeLabel ?? '').trim();
        if (!label) return;

        const reqId = ++drilldownReqRef.current;
        setDrillDown({
          isOpen: true,
          title: widget.title,
          filterCol: '',
          filterVal: '',
          data: [],
          isLoading: true,
          error: undefined,
        });

        const sourceId =
          baseDataSourceId ||
          workerSource.dataSourceId ||
          normalizedProject.activeDataSourceId ||
          normalizedProject.dataSources?.[0]?.id;
        if (!sourceId) return;

        const sourceRows =
          baseData.length > 0 && baseDataSourceId === sourceId ? baseData : await loadRowsForSource(sourceId);
        if (reqId !== drilldownReqRef.current) return;

        const globalFiltered =
          filters.length === 0
            ? sourceRows
            : sourceRows.filter((row) => filters.every((f) => matchesFilterCondition(row, f)));
        const rowsForWidget = applyWidgetFilters(globalFiltered, widget.filters);

        const columnsForInference =
          availableColumns.length > 0 ? availableColumns : rowsForWidget[0] ? Object.keys(rowsForWidget[0]) : [];

        const inferFilterColumn = () => {
          const dim = String((widget as any)?.dimension ?? '').trim();
          if (dim) return dim;
          if (!columnsForInference.length) return '';

          const sample = rowsForWidget.slice(0, 400);
          if (sample.length === 0) return '';

          const normalizeCandidate = (raw: any) => {
            const s = String(raw ?? '').trim();
            return s ? s : '(Empty)';
          };

          const labelRange = (() => {
            const text = label.trim();
            if (!text) return null;
            const parts = text.split(' - ');
            if (parts.length === 2) {
              const start = toDateValue(parts[0].trim());
              const end = toDateValue(parts[1].trim());
              if (!start || !end) return null;
              start.setHours(0, 0, 0, 0);
              end.setHours(23, 59, 59, 999);
              return { startMs: start.getTime(), endMs: end.getTime() };
            }
            const d = toDateValue(text);
            if (!d) return null;
            d.setHours(0, 0, 0, 0);
            return { startMs: d.getTime(), endMs: d.getTime() + 24 * 60 * 60 * 1000 - 1 };
          })();

          if (labelRange) {
            let bestCol = '';
            let bestScore = 0;
            for (const col of columnsForInference) {
              let score = 0;
              for (const row of sample) {
                const d = toDateValue((row as any)[col]);
                if (!d) continue;
                const ms = d.getTime();
                if (ms >= labelRange.startMs && ms <= labelRange.endMs) score += 1;
              }
              if (score > bestScore) {
                bestScore = score;
                bestCol = col;
              }
            }
            if (bestScore > 0) return bestCol;
          }

          let bestCol = '';
          let bestScore = 0;
          for (const col of columnsForInference) {
            let score = 0;
            for (const row of sample) {
              const base = normalizeCandidate((row as any)[col]);
              if (!widget.groupByString) {
                if (base === label) score += 1;
                continue;
              }
              const tokens = base.split(/[,\n;|]+/).map((t) => t.trim()).filter(Boolean);
              if (tokens.includes(label)) score += 1;
            }
            if (score > bestScore) {
              bestScore = score;
              bestCol = col;
            }
          }
          if (bestScore > 0) return bestCol;

          return '';
        };

        const filterColumn = inferFilterColumn();
        if (!filterColumn) {
          if (reqId !== drilldownReqRef.current) return;
          setDrillDown((prev) => (prev ? { ...prev, isLoading: false, error: 'Drilldown failed' } : prev));
          return;
        }

        const widgetForDrill: DashboardWidget = widget.dimension ? widget : { ...widget, dimension: filterColumn };

        const normalizeDim = (raw: any) => {
          const s = String(raw ?? '').trim();
          return s ? s : '(Empty)';
        };
        const getDimValues = (row: RawRow) => {
          const base = normalizeDim(row[filterColumn]);
          if (!widgetForDrill.groupByString) return [base];
          const tokens = base.split(/[,\n;|]+/).map((t) => t.trim()).filter(Boolean);
          return tokens.length ? tokens : ['(Empty)'];
        };

        const isStackedChart = [
          'stacked-column',
          '100-stacked-column',
          'stacked-bar',
          '100-stacked-bar',
          'stacked-area',
          '100-stacked-area',
        ].includes(widget.type);

        const seriesColumn =
          isStackedChart ||
          widget.type === 'multi-line' ||
          widget.type === 'multi-area' ||
          widget.type === 'compare-column' ||
          widget.type === 'compare-bar'
            ? widget.stackBy
            : undefined;
        const seriesLabel = seriesColumn ? String(activeSeries ?? '').trim() : '';
        const normalizeStack = (raw: any) => {
          const s = String(raw ?? '').trim();
          if (s) return s;
          return raw === null || raw === undefined ? '(Other)' : '(Empty)';
        };
        const getSeriesValues = (row: RawRow) => {
          if (!seriesColumn) return [];
          const base = normalizeStack(row[seriesColumn]);
          if (!widget.seriesGroupByString) return [base];
          const tokens = base.split(/[,\n;|]+/).map((t) => t.trim()).filter(Boolean);
          return tokens.length ? tokens : ['(Empty)'];
        };

        const parseDateLabelRange = (raw: string) => {
          const text = raw.trim();
          if (!text) return null;
          const parts = text.split(' - ');
          if (parts.length === 2) {
            const start = toDateValue(parts[0].trim());
            const end = toDateValue(parts[1].trim());
            if (!start || !end) return null;
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { startMs: start.getTime(), endMs: end.getTime() };
          }
          const d = toDateValue(text);
          if (!d) return null;
          d.setHours(0, 0, 0, 0);
          return { startMs: d.getTime(), endMs: d.getTime() + 24 * 60 * 60 * 1000 - 1 };
        };

        const labelRange = parseDateLabelRange(label);
        const matchesDimension = (row: RawRow) => {
          if (labelRange) {
            const d = toDateValue(row[filterColumn]);
            if (!d) return false;
            const ms = d.getTime();
            return ms >= labelRange.startMs && ms <= labelRange.endMs;
          }
          return getDimValues(row).includes(label);
        };

        if (label === 'Others' && widgetForDrill.topN && widgetForDrill.groupOthers !== false) {
          const overflowKeys = getTopNOverflowDimensionValues(widgetForDrill, rowsForWidget);
          const overflowSet = new Set(overflowKeys);
          const clickedData = rowsForWidget.filter((row) => {
            if (!getDimValues(row).some((v) => overflowSet.has(v))) return false;
            if (!seriesColumn) return true;
            if (!seriesLabel) return true;
            return getSeriesValues(row).includes(seriesLabel);
          });

          if (reqId !== drilldownReqRef.current) return;
          setDrillDown({
            isOpen: true,
            title: `${widget.title} - Others`,
            filterCol: seriesColumn ? `${filterColumn} & ${seriesColumn}` : filterColumn,
            filterVal: `${overflowKeys.length ? `Others (${overflowKeys.length})` : 'Others'}${
              seriesColumn ? ` / ${seriesLabel}` : ''
            }`,
            data: clickedData,
            isLoading: false,
            error: undefined,
          });
          return;
        }

        const clickedData = rowsForWidget.filter((row) => {
          if (!matchesDimension(row)) return false;
          if (!seriesColumn) return true;
          if (!seriesLabel) return true;
          return getSeriesValues(row).includes(seriesLabel);
        });

        if (reqId !== drilldownReqRef.current) return;
        setDrillDown({
          isOpen: true,
          title: `${widget.title} - ${label}`,
          filterCol: seriesColumn ? `${filterColumn} & ${seriesColumn}` : filterColumn,
          filterVal: seriesColumn ? `${label} / ${seriesLabel}` : label,
          data: clickedData,
          isLoading: false,
          error: undefined,
        });
      })().catch((e) => {
        console.error('[DashboardMagic] Drilldown failed:', e);
        setDrillDown((prev) => (prev ? { ...prev, isLoading: false, error: 'Drilldown failed' } : prev));
      });
    },
    [
      availableColumns,
      baseData,
      baseDataSourceId,
      filters,
      loadRowsForSource,
      matchesFilterCondition,
      normalizedProject.activeDataSourceId,
      normalizedProject.dataSources,
      workerSource.dataSourceId,
    ]
  );

  const renderListView = () => (
    <div className="h-full flex flex-col px-10 py-8 overflow-y-auto w-full bg-[#F8F9FA]">
      <div className="space-y-8 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard Magic</h1>
            <p className="text-sm text-gray-500 mt-1">
              Create ECharts dashboards that stay compatible with RealPPTX.
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Magic Dashboard</span>
          </button>
        </div>

        {dashboards.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="Start by creating your first Magic dashboard for this project."
            actionLabel="Create Dashboard"
            onAction={() => setIsCreateOpen(true)}
          />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Name</th>
                  <th className="px-6 py-3 text-left font-semibold">Charts</th>
                  <th className="px-6 py-3 text-left font-semibold">Last updated</th>
                  <th className="px-6 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {dashboards.map((dashboard) => (
                  <tr key={dashboard.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{dashboard.name}</div>
                      {dashboard.description && <div className="text-xs text-gray-500">{dashboard.description}</div>}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{dashboard.widgets.length}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(dashboard.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleRenameDashboard(dashboard)}
                          className="inline-flex items-center px-2 py-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md"
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1" />
                          Rename
                        </button>
                        <button
                          onClick={() => handleOpenDashboard(dashboard.id)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleDeleteDashboard(dashboard.id)}
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

      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Create Magic Dashboard</h3>
            <div>
              <label className="text-xs font-semibold text-gray-600">Dashboard Name</label>
              <input
                autoFocus
                value={newDashboardName}
                onChange={(e) => setNewDashboardName(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Executive Summary"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">Data Source</label>
              <button
                type="button"
                onClick={() => setCreateSourcePickerOpen(true)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 flex items-center justify-between gap-3"
              >
                <span className="truncate text-gray-900">
                  {(() => {
                    const src = (normalizedProject.dataSources || []).find((s) => s.id === selectedDataSourceId);
                    return src ? src.name : 'Select Data Source';
                  })()}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {(() => {
                    const src = (normalizedProject.dataSources || []).find((s) => s.id === selectedDataSourceId);
                    return src ? `(${src.kind})` : '';
                  })()}
                </span>
              </button>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setNewDashboardName('');
                  setCreateSourcePickerOpen(false);
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDashboard}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <DataSourcePickerModal
        isOpen={isCreateSourcePickerOpen}
        title="Select Data Source"
        ingestionSources={ingestionSources}
        preparedSources={preparedSources}
        selectedSourceId={selectedDataSourceId}
        onSelect={(src) => {
          setSelectedDataSourceId(src.id);
          setCreateSourcePickerOpen(false);
        }}
        onClose={() => setCreateSourcePickerOpen(false)}
      />
    </div>
  );

  const renderEditorView = () => {
    if (!editingDashboard) {
      return renderListView();
    }

    return (
      <div className="flex flex-col h-full bg-[#F8F9FA]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white shadow-sm z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                setMode('list');
                setSelectedDashboardId(null);
              }}
              className="inline-flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md bg-white"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-2" />
              Back to dashboards
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{editingDashboard.name}</h2>
              <p className="text-xs text-gray-500">
                Last updated {new Date(editingDashboard.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSaveDashboard}
              disabled={isSaving}
              className="inline-flex items-center px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md bg-white disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              Save
            </button>
            <button
              onClick={() => handleRenameDashboard(editingDashboard)}
              className="inline-flex items-center px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md bg-white"
            >
              <Edit3 className="w-3.5 h-3.5 mr-1" />
              Rename
            </button>
            <button
              onClick={() => handleDeleteDashboard(editingDashboard.id)}
              className="inline-flex items-center px-3 py-1.5 text-xs text-red-600 hover:text-red-700 border border-red-100 rounded-md bg-white"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete
            </button>
          </div>
        </div>

        {/* Toolbar & Content */}
        <div ref={editorScrollRef} className="flex-1 overflow-auto p-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                {editingDashboard.name}
                {isPresentationMode && <span className="ml-3 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium flex items-center"><Presentation className="w-3 h-3 mr-1" /> Live Mode</span>}
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                {filteredData.length} rows matching filters
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {/* Data Source Selector */}
              <button
                type="button"
                onClick={() => setEditorSourcePickerOpen(true)}
                className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm hover:bg-gray-100 transition-colors max-w-full"
              >
                <span className="text-xs font-semibold text-gray-500 uppercase">Data Source:</span>
                <span className="text-xs text-gray-900 font-medium truncate">
                  {(() => {
                    const id = editingDashboard.dataSourceId || project.activeDataSourceId || '';
                    const ds = (project.dataSources || []).find((s) => s.id === id);
                    return ds ? ds.name : 'Select Data Source';
                  })()}
                </span>
                <span className="text-[10px] font-semibold tracking-wide uppercase text-gray-400 flex-shrink-0">
                  {(() => {
                    const id = editingDashboard.dataSourceId || project.activeDataSourceId || '';
                    const ds = (project.dataSources || []).find((s) => s.id === id);
                    return ds ? ds.kind : '';
                  })()}
                </span>
              </button>

              {/* Interaction Toggle */}
              <div className="bg-white border border-gray-300 rounded-lg flex p-0.5 shadow-sm">
                <button
                  onClick={() => setInteractionMode('drill')}
                  className="flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-all bg-blue-100 text-blue-700"
                >
                  <MousePointer2 className="w-3 h-3 mr-1.5" />
                  Drill
                </button>
              </div>

              <div className="h-9 w-px bg-gray-300 mx-1 self-center hidden md:block"></div>

              {!isPresentationMode && (
                <button
                  onClick={() => {
                    setEditingWidget(null);
                    setIsBuilderOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Add Chart</span>
                </button>
              )}

              <button
                onClick={() => setIsPresentationMode(!isPresentationMode)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 border rounded-md text-xs font-medium transition-colors shadow-sm ${isPresentationMode ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
              >
                {isPresentationMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{isPresentationMode ? 'Edit' : 'Present'}</span>
              </button>

              <button
                onClick={handleExportPPT}
                disabled={isExporting}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs font-medium rounded-md hover:bg-orange-50 transition-colors shadow-sm"
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5" />}
                <span className="hidden md:inline text-[10px] font-semibold tracking-wide uppercase">PPTX</span>
              </button>
            </div>
          </div>

          {/* Global Filter Bar */}
          {(filters.length > 0 || !isPresentationMode) && (
            <div className={`bg-white border border-gray-200 rounded-xl p-4 mb-8 shadow-sm transition-all ${isPresentationMode ? 'opacity-80 hover:opacity-100' : ''}`}>
              <div className="flex items-center space-x-2 mb-3">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-700">Magic Filters</span>
                <span className="text-xs text-gray-400">(Applies to all charts)</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {filters.map(filter => (
                  filter.dataType === 'date' ? (
                    <div key={filter.id} className="flex flex-wrap items-center bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 animate-in fade-in zoom-in duration-200 gap-2">
                      <span className="text-[11px] font-bold text-indigo-800 uppercase">{filter.column}</span>
                      <select
                        className="bg-transparent text-[11px] font-semibold text-indigo-700 border border-indigo-200 rounded px-1.5 py-1 focus:ring-2 focus:ring-indigo-400 outline-none"
                        value={normalizeDateOperator(filter.operator)}
                        onChange={(e) => updateDateFilterOperator(filter.id, e.target.value as DateFilterOperator)}
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
                          onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                          className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                        />
                        {normalizeDateOperator(filter.operator) === 'between' && (
                          <>
                            <span className="text-[10px] text-indigo-500">to</span>
                            <input
                              type="date"
                              value={filter.endValue || ''}
                              onChange={(e) => updateFilterValue(filter.id, e.target.value, 'endValue')}
                              className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                            />
                          </>
                        )}
                      </div>
                      <button onClick={() => removeFilter(filter.id)} className="text-indigo-400 hover:text-indigo-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div key={filter.id} className="flex items-center bg-blue-50 border border-blue-100 rounded-lg px-2 py-1 animate-in fade-in zoom-in duration-200">
                      <span className="text-[11px] font-bold text-blue-800 mr-2 uppercase">{filter.column}:</span>
                      <select
                        className="bg-transparent text-xs text-blue-900 border-none focus:ring-0 p-0 pr-5 cursor-pointer font-medium outline-none"
                        value={filter.value || ''}
                        onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                      >
                        <option value="">All</option>
                        {getUniqueValues(filter.column).map(val => (
                          <option key={val} value={val}>{val}</option>
                        ))}
                      </select>

                      <button onClick={() => removeFilter(filter.id)} className="ml-2 text-blue-400 hover:text-blue-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                ))}

                {!isPresentationMode && (
                  <div className="flex items-center">
                    <select
                      className="text-xs border border-gray-300 rounded-l-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      value={newFilterCol}
                      onChange={(e) => setNewFilterCol(e.target.value)}
                    >
                      <option value="">+ Add Filter</option>
                      {availableColumns.filter(c => !filters.find(f => f.column === c)).map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                    <button
                      disabled={!newFilterCol}
                      onClick={() => addFilter(newFilterCol)}
                      className="bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg px-2.5 py-1.5 hover:bg-gray-200 disabled:opacity-50 text-xs font-semibold uppercase"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Widgets Grid (Sections) */}
          {widgets.length === 0 ? (
            <EmptyState
              icon={LayoutDashboard}
              title="No charts"
              description="Dashboard is empty."
              actionLabel="Add Chart"
              onAction={() => {
                setEditingWidget(null);
                setIsBuilderOpen(true);
              }}
            />
          ) : (
            <div ref={dashboardRef} className="space-y-8 pb-20">
              {sections.map((sectionIndex) => {
                const sectionWidgets = widgets.filter((w) => (w.sectionIndex ?? 0) === sectionIndex);
                const isDropActive = !!draggedWidget && dragOverSection === sectionIndex;
                const target = dropTarget && dropTarget.sectionIndex === sectionIndex ? dropTarget : null;
                const placeholder =
                  isDropActive && draggedWidget
                    ? {
                        colSpan: draggedWidget.colSpan,
                        heightPx: draggedWidget.heightPx,
                      }
                    : null;

                const renderPlaceholder = (key: string) => (
                  <div
                    key={key}
                    className="rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/50"
                    style={{
                      gridColumn: `span ${placeholder?.colSpan || 2} / span ${placeholder?.colSpan || 2}`,
                      height: placeholder?.heightPx || 240,
                    }}
                  />
                );
                // Only show section if it has widgets OR if it's the next available empty section (to allow dropping)
                // Actually, show all 5 sections to allow dragging freely between them
                // But styling: if empty, maybe show a placeholder "Drop here"
                
                return (
                  <div
                    key={sectionIndex}
                    data-dashboard-section="true"
                    onDragOver={(e) => onDragOverSection(e, sectionIndex)}
                    onDragEnter={() => onDragEnterSection(sectionIndex)}
                    onDrop={() => onDropSection(sectionIndex)}
                    className={`relative rounded-xl border-2 border-dashed transition-colors min-h-[280px] p-4 grid grid-cols-4 gap-6 ${
                      isDropActive
                        ? 'border-blue-300 bg-blue-50/30'
                        : 'border-transparent' // Invisible border when not dragging
                    }`}
                  >
                    {/* Section Label (Optional, for debugging or clarity) */}
                    {isPresentationMode ? null : (
                      <div className="absolute -top-3 left-4 bg-white px-2 text-[10px] font-bold text-gray-300 uppercase tracking-widest pointer-events-none">
                        Section {sectionIndex + 1}
                      </div>
                    )}

                    {(() => {
                      const nodes: React.ReactNode[] = [];
                      const shouldAppendPlaceholderAtEnd = !!placeholder && !target?.beforeId && !target?.afterId;

                      for (const w of sectionWidgets) {
                        if (placeholder && target?.beforeId === w.id) nodes.push(renderPlaceholder(`ph-before-${w.id}`));

                        nodes.push(
                          <div
                            key={w.id}
                            data-widget-id={w.id}
                            onDragOver={(e) => onDragOverWidget(e, sectionIndex, w.id)}
                            className={`group relative flex flex-col rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm p-5 shadow-sm transition-shadow hover:shadow-md ${
                              draggedWidget?.id === w.id ? 'opacity-60' : ''
                            }`}
                            style={{
                              gridColumn: `span ${w.colSpan || 2} / span ${w.colSpan || 2}`,
                              minHeight: '420px',
                              cursor: 'default'
                            }}
                          >
                            {/* Header */}
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center space-x-2 overflow-hidden">
                                  {!isPresentationMode && (
                                    <div
                                      className="flex-shrink-0"
                                      draggable
                                      onDragStart={(e) => onDragStart(e, w.id, sectionIndex)}
                                      onDragEnd={onDragEnd}
                                      title="Move"
                                    >
                                      <GripHorizontal className="w-4 h-4 text-gray-300 cursor-grab active:cursor-grabbing" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <h4 className="widget-title font-bold text-gray-800 truncate">{w.title}</h4>
                                  </div>
                                </div>
                              {!isPresentationMode && (
                                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleDuplicateWidget(w)}
                                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                                    title="Duplicate"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingWidget(w);
                                      setIsBuilderOpen(true);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                    title="Edit"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteWidget(w.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Chart */}
                            <div className="flex-1 min-h-0 relative">
                              <MagicWidgetRenderer
                                widget={w}
                                data={baseData}
                                globalFilters={filters}
                                theme={REALPPTX_CHART_THEME}
                                isEditing={!isPresentationMode}
                                isInteracting={!!draggedWidget || !!resizing}
                                workerClient={magicAggWorker}
                                onValueClick={(val, w2, meta) => handleChartValueSelect(w2, val, meta?.seriesName)}
                              />

                              {/* Resize Handle */}
                              {!isPresentationMode && (
                                <div
                                  className="absolute top-1/2 -right-6 transform -translate-y-1/2 w-4 h-12 flex items-center justify-center cursor-col-resize text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-20"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const sectionEl = (e.currentTarget as HTMLElement).closest('[data-dashboard-section]') as HTMLElement | null;
                                    const width = sectionEl?.getBoundingClientRect().width ?? 1200;
                                    const paddingPx = 16 * 2; // p-4 (left + right)
                                    const gapPx = GRID_GAP_PX * 3; // 4 columns -> 3 gaps
                                    const colPx = Math.max(1, (width - paddingPx - gapPx) / 4);
                                    setResizing({ id: w.id, startX: e.clientX, startSpan: w.colSpan || 2, colPx });
                                  }}
                                  title="Resize"
                                >
                                  <div className="w-1.5 h-8 bg-gray-200 rounded-full hover:bg-blue-400" />
                                </div>
                              )}
                            </div>
                          </div>
                        );

                        if (placeholder && target?.afterId === w.id) nodes.push(renderPlaceholder(`ph-after-${w.id}`));
                      }

                      if (shouldAppendPlaceholderAtEnd) nodes.push(renderPlaceholder('ph-end'));

                      return nodes;
                    })()}
                    
                    {/* Empty state for section (keep minimal; avoid instructional text) */}
                    {sectionWidgets.length === 0 && !placeholder && (
                      <div className="col-span-4 h-32 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-xl text-gray-300 text-sm italic">
                        Empty section
                      </div>
                    )}

                    {sectionWidgets.length > 0 && isDropActive && placeholder && !target?.beforeId && !target?.afterId ? (
                      <div className="col-span-4 h-0" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {mode === 'list' ? renderListView() : renderEditorView()}

      <DataSourcePickerModal
        isOpen={isEditorSourcePickerOpen}
        title="Select Data Source"
        ingestionSources={ingestionSources}
        preparedSources={preparedSources}
        selectedSourceId={editingDashboard?.dataSourceId || normalizedProject.activeDataSourceId || null}
        onSelect={(src) => {
          setEditorSourcePickerOpen(false);
          void handleActiveDataSourceChange(src.id);
        }}
        onClose={() => setEditorSourcePickerOpen(false)}
      />

      <ChartBuilder
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onSave={handleSaveWidget}
        availableColumns={availableColumns}
        initialWidget={editingWidget}
        data={filteredData}
        chartTheme={REALPPTX_CHART_THEME}
        workerSource={workerSource}
      />

      {/* Drill Down Modal */}
      {drillDown && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-5xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="font-bold text-lg text-gray-800 flex items-center">
                  Drill Down: {drillDown.title}
                </h3>
                {drillDown.isLoading ? (
                  <p className="text-xs text-gray-500">Loading...</p>
                ) : drillDown.error ? (
                  <p className="text-xs text-red-600">{drillDown.error}</p>
                ) : (
                  <p className="text-xs text-gray-500">
                    Filtered by <span className="font-semibold">{drillDown.filterCol} = {drillDown.filterVal}</span> ({drillDown.data.length} rows)
                  </p>
                )}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => exportToExcel(drillDown.data, `DrillDown_${drillDown.title}`)}
                  disabled={!!drillDown.isLoading || !!drillDown.error || drillDown.data.length === 0}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-medium hover:bg-green-700 disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" /> <span>Export Excel</span>
                </button>
                <button onClick={() => setDrillDown(null)} className="p-1.5 text-gray-400 hover:bg-gray-200 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-0">
              {drillDown.isLoading ? (
                <div className="h-full flex items-center justify-center text-gray-300">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-white text-gray-500 text-xs uppercase sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-6 py-3 border-b border-gray-200 w-12">#</th>
                        {availableColumns.map(col => (
                          <th key={col} className="px-6 py-3 border-b border-gray-200 font-semibold whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {drillDown.data.slice(0, 200).map((row, idx) => (
                        <tr key={idx} className="hover:bg-blue-50">
                          <td className="px-6 py-3 text-gray-400 font-mono text-xs bg-gray-50/50">{idx + 1}</td>
                          {availableColumns.map(col => (
                            <td key={col} className="px-6 py-3 text-gray-700 truncate max-w-xs" title={String(row[col])}>
                              {String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {drillDown.data.length > 200 && (
                    <div className="p-4 text-center text-gray-500 text-sm bg-gray-50 border-t">
                      Rows: 200 / {drillDown.data.length}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Saving Modal */}
      {isSaving && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-gray-700">Saving...</p>
          </div>
        </div>
      )}
    </>
  );
};

export default DashboardMagic;
