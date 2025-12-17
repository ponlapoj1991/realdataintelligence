import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { saveAs } from 'file-saver';
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
  Download,
  Presentation,
  GripHorizontal,
  Move,
  Save
} from 'lucide-react';
import EmptyState from '../components/EmptyState';
import ChartBuilder from '../components/ChartBuilder';
import MagicWidgetRenderer from '../components/MagicWidgetRenderer';
import { Project, ProjectDashboard, DashboardWidget, DashboardFilter, DrillDownState, RawRow, FilterDataType } from '../types';
import {
  ensureMagicDashboards,
  addMagicDashboard,
  removeMagicDashboard,
  setActiveMagicDashboard,
  setMagicDashboardDataSource,
  updateMagicDashboardWidgets,
  renameMagicDashboard,
} from '../utils/dashboards';
import { ensureDataSources } from '../utils/dataSources';
import { resolveDashboardBaseData } from '../utils/dashboardData';
import { saveProject } from '../utils/storage-compat';
import { REALPPTX_CHART_THEME } from '../constants/chartTheme';
import { buildMagicChartPayload } from '../utils/magicChartPayload';
import { buildMagicEchartsOption } from '../utils/magicOptionBuilder';
import { exportToExcel } from '../utils/excel';
import { generatePowerPoint } from '../utils/report';

// --- Helper Functions (Ported from Analytics.tsx) ---
const SAMPLE_SIZE = 50;

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

  // Grid State
  const [draggedWidget, setDraggedWidget] = useState<{ id: string; sectionIndex: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startSpan: number } | null>(null);

  // Migration: Auto-assign sections and colSpan
  useEffect(() => {
    if (widgets.length > 0 && widgets.some((w) => w.sectionIndex === undefined || w.colSpan === undefined)) {
      const updated = widgets.map((w, idx) => {
        // Default logic: 2 widgets per section, max 5 sections
        const defaultSection = Math.min(Math.floor(idx / 2), 4);
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

  // --- Data Logic (Moved from Analytics.tsx) ---
  const { rows: baseData, availableColumns } = useMemo(
    () => resolveDashboardBaseData(normalizedProject, editingDashboard ?? null),
    [normalizedProject, editingDashboard]
  );

  const columnTypeMap = useMemo(() => {
    const sampleRows = baseData.slice(0, SAMPLE_SIZE);
    const map: Record<string, FilterDataType> = {};
    availableColumns.forEach(col => {
      map[col] = inferColumnType(col, sampleRows);
    });
    return map;
  }, [availableColumns, baseData]);

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
      const start = normalizeRangeStart(filter.value);
      const end = normalizeRangeEnd(filter.endValue);
      if (start && rowDate < start) return false;
      if (end && rowDate > end) return false;
      if (!start && !end) return true;
      return true;
    }
    if (!filter.value) return true;
    return String(value ?? '').toLowerCase() === filter.value.toLowerCase();
  }, []);

  const filteredData = useMemo(() => {
    if (filters.length === 0) return baseData;
    return baseData.filter(row => filters.every(f => matchesFilterCondition(row, f)));
  }, [baseData, filters, matchesFilterCondition]);

  const persistProject = useCallback(
    async (updated: Project) => {
      onUpdateProject?.(updated);
      await saveProject(updated);
    },
    [onUpdateProject]
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

    if (dataType === 'date') {
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
      dataType
    };
    setFilters([...filters, newFilter]);
    setNewFilterCol('');
  };

  const removeFilter = (id: string) => {
    setFilters(filters.filter(f => f.id !== id));
  };

  const updateFilterValue = (id: string, val: string, field: 'value' | 'endValue' = 'value') => {
    setFilters(filters.map(f => f.id === id ? { ...f, [field]: val } : f));
  };

  const getUniqueValues = (col: string) => {
    const unique = new Set(baseData.map(row => String(row[col] || '')));
    return Array.from(unique).filter(Boolean).sort().slice(0, 100);
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

  const handleExportWidget = (widget: DashboardWidget) => {
    const payload = buildMagicChartPayload(widget, filteredData, {
      theme: REALPPTX_CHART_THEME,
      sourceDashboardId: editingDashboard?.id,
    });
    if (!payload) {
      alert('No data to export');
      return;
    }
    const optionRaw = buildMagicEchartsOption(payload);
    const blob = new Blob([JSON.stringify({ ...payload, optionRaw }, null, 2)], { type: 'application/json' });
    saveAs(blob, `${widget.title || 'chart'}.magic-echarts.json`);
  };

  const handleActiveDataSourceChange = async (id: string) => {
    if (!editingDashboard) return;
    const updated = setMagicDashboardDataSource(normalizedProject, editingDashboard.id, id);
    await persistProject(updated);
  };

  const dashboardRef = useRef<HTMLDivElement>(null);

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
    setDraggedWidget({ id, sectionIndex });
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag image if needed, or default
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Allow drop
    e.dataTransfer.dropEffect = 'move';
  };

  const onDropSection = async (targetSection: number) => {
    if (!draggedWidget) return;
    const { id, sectionIndex: sourceSection } = draggedWidget;

    // Constraint: Can only move 1 step (e.g. 1->2 or 1->0, NOT 1->3)
    // Exception: Moving within same section is always allowed (reorder?)
    // But requirement says "ขยับข้าม section จะต้องทำได้ทีละ step"
    const diff = Math.abs(targetSection - sourceSection);
    
    if (sourceSection !== targetSection && diff > 1) {
      alert('Can only move widgets one section at a time (e.g. Section 1 to 2).');
      setDraggedWidget(null);
      return;
    }

    const updated = widgets.map((w) => {
      if (w.id === id) {
        return { ...w, sectionIndex: targetSection };
      }
      return w;
    });
    
    setWidgets(updated);
    setDraggedWidget(null);
    await handleSaveWidgets(updated);
  };

  // Resize Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      const { id, startX, startSpan } = resizing;
      
      // Calculate delta cells (1 cell approx 25% of container)
      // We assume container width ~1200px or relative
      // Easier: Use pixels. 1 Grid col ~ 300px?
      // Let's use simple threshold: every 200px = 1 col change
      const diff = e.clientX - startX;
      const step = 150; // Sensitivity
      const deltaCols = Math.round(diff / step);
      
      if (deltaCols === 0) return;

      const newSpan = Math.max(1, Math.min(4, startSpan + deltaCols));
      
      setWidgets((prev) =>
        prev.map((w) => (w.id === id ? { ...w, colSpan: newSpan } : w))
      );
    };

    const handleMouseUp = async () => {
      if (resizing) {
        // Save final state
        await handleSaveWidgets(widgets); // widgets state is updated via mousemove locally?
        // Note: 'widgets' in this closure might be stale if we rely on it for saving.
        // But setState callback uses latest.
        // For saving, we should trigger a save effect or use a ref.
        // For simplicity in this structure, we'll save on mouse up using the CURRENT widgets state?
        // Actually, listeners close over old scope.
        setResizing(null);
      }
    };

    if (resizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]); // Re-bind when resizing state changes? No, widgets state updates might be lost.
  
  // FIX: MouseMove needs latest state or functional updates. Functional updates work for UI.
  // But Saving needs latest data.
  // We will save in a separate effect that detects changes? No, too many saves.
  // Better: save on MouseUp logic needs access to latest widgets.
  // We can use a ref to track widgets.
  const widgetsRef = useRef(widgets);
  useEffect(() => { widgetsRef.current = widgets; }, [widgets]);

  useEffect(() => {
    const handleMouseUpGlobal = async () => {
        if (resizing) {
            setResizing(null);
            await handleSaveWidgets(widgetsRef.current);
        }
    };
    if (resizing) {
        window.addEventListener('mouseup', handleMouseUpGlobal);
    }
    return () => {
        window.removeEventListener('mouseup', handleMouseUpGlobal);
    }
  }, [resizing]); // Only bind/unbind when drag status changes


  // --- Interaction Handler (Filter vs Drill) ---
  const handleChartValueSelect = (widget: DashboardWidget, activeLabel?: string) => {
    if (!activeLabel) return;

    const filterColumn = widget.dimension;
    if (!filterColumn) return;

    const clickedData = filteredData.filter((row) => String(row[filterColumn] ?? '').includes(activeLabel));

    setDrillDown({
      isOpen: true,
      title: `${widget.title} - ${activeLabel}`,
      filterCol: filterColumn,
      filterVal: activeLabel,
      data: clickedData,
    });
  };

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
            <p className="text-sm text-gray-500">
              Organize charts for RealPPTX-compatible rendering.
            </p>
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
              <select
                value={selectedDataSourceId}
                onChange={(e) => setSelectedDataSourceId(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {(project.dataSources || []).map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} ({ds.kind})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setNewDashboardName('');
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
        <div className="flex-1 overflow-auto p-8">
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
              <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
                <span className="text-xs font-semibold text-gray-500 uppercase">Data Source:</span>
                <select
                  value={editingDashboard.dataSourceId || project.activeDataSourceId || ''}
                  onChange={(e) => handleActiveDataSourceChange(e.target.value)}
                  className="text-xs text-gray-900 bg-transparent border-none focus:ring-0 cursor-pointer outline-none"
                >
                  {(project.dataSources || []).map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.kind})
                    </option>
                  ))}
                </select>
              </div>

              {/* Interaction Toggle */}
              <div className="bg-white border border-gray-300 rounded-lg flex p-0.5 shadow-sm">
                <button
                  onClick={() => setInteractionMode('drill')}
                  className="flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-all bg-blue-100 text-blue-700"
                  title="Click charts to see data rows"
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
                      <div className="flex items-center gap-1">
                        <input
                          type="date"
                          value={filter.value || ''}
                          onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                          className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                        />
                        <span className="text-[10px] text-indigo-500">to</span>
                        <input
                          type="date"
                          value={filter.endValue || ''}
                          onChange={(e) => updateFilterValue(filter.id, e.target.value, 'endValue')}
                          className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-400 outline-none"
                        />
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
              title="No charts yet"
              description="Click Add Chart to create your first ECharts visualization."
              actionLabel="Add Chart"
              onAction={() => {
                setEditingWidget(null);
                setIsBuilderOpen(true);
              }}
            />
          ) : (
            <div ref={dashboardRef} className="space-y-8 pb-20">
              {[0, 1, 2, 3, 4].map((sectionIndex) => {
                const sectionWidgets = widgets.filter((w) => (w.sectionIndex ?? 0) === sectionIndex);
                // Only show section if it has widgets OR if it's the next available empty section (to allow dropping)
                // Actually, show all 5 sections to allow dragging freely between them
                // But styling: if empty, maybe show a placeholder "Drop here"
                
                return (
                  <div
                    key={sectionIndex}
                    onDragOver={onDragOver}
                    onDrop={() => onDropSection(sectionIndex)}
                    className={`relative rounded-xl border-2 border-dashed transition-colors min-h-[150px] p-4 grid grid-cols-4 gap-6 ${
                      draggedWidget && Math.abs(draggedWidget.sectionIndex - sectionIndex) <= 1
                        ? 'border-blue-300 bg-blue-50/30'
                        : 'border-transparent' // Invisible border when not dragging
                    } ${sectionWidgets.length === 0 && !draggedWidget ? 'hidden' : ''} ${
                      // Always show at least first 2 sections or if it has widgets
                      sectionIndex < 2 ? 'block' : ''
                    }`}
                  >
                    {/* Section Label (Optional, for debugging or clarity) */}
                    {isPresentationMode ? null : (
                      <div className="absolute -top-3 left-4 bg-white px-2 text-[10px] font-bold text-gray-300 uppercase tracking-widest pointer-events-none">
                        Section {sectionIndex + 1}
                      </div>
                    )}

                    {sectionWidgets.map((widget) => (
                      <div
                        key={widget.id}
                        draggable={!isPresentationMode}
                        onDragStart={(e) => onDragStart(e, widget.id, sectionIndex)}
                        className={`group relative flex flex-col rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm p-5 shadow-sm transition-shadow hover:shadow-md`}
                        style={{
                          gridColumn: `span ${widget.colSpan || 2} / span ${widget.colSpan || 2}`,
                          minHeight: '300px',
                          cursor: isPresentationMode ? 'default' : 'grab'
                        }}
                      >
                        {/* Header */}
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center space-x-2 overflow-hidden">
                            {!isPresentationMode && <GripHorizontal className="w-4 h-4 text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0" />}
                            <div className="min-w-0">
                              <h4 className="widget-title font-bold text-gray-800 truncate">{widget.title}</h4>
                              <p className="widget-meta text-xs text-gray-500 capitalize truncate">
                                {widget.type} {widget.dimension ? `by ${widget.dimension}` : ''}
                              </p>
                            </div>
                          </div>
                          {!isPresentationMode && (
                            <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleExportWidget(widget)}
                                className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                                title="Export JSON"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingWidget(widget);
                                  setIsBuilderOpen(true);
                                }}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                title="Edit"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteWidget(widget.id)}
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
                            widget={widget}
                            data={filteredData}
                            filters={widget.filters}
                            theme={REALPPTX_CHART_THEME}
                          />
                          
                          {/* Resize Handle */}
                          {!isPresentationMode && (
                            <div
                              className="absolute top-1/2 -right-6 transform -translate-y-1/2 w-4 h-12 flex items-center justify-center cursor-col-resize text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-20"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setResizing({ id: widget.id, startX: e.clientX, startSpan: widget.colSpan || 2 });
                              }}
                              title="Drag to resize width"
                            >
                              <div className="w-1.5 h-8 bg-gray-200 rounded-full hover:bg-blue-400" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Placeholder for empty section to maintain height/dropzone */}
                    {sectionWidgets.length === 0 && (
                      <div className="col-span-4 h-24 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-xl text-gray-300 text-sm italic">
                        Empty Section (Drop charts here)
                      </div>
                    )}
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

      <ChartBuilder
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onSave={handleSaveWidget}
        availableColumns={availableColumns}
        initialWidget={editingWidget}
        data={filteredData}
        chartTheme={REALPPTX_CHART_THEME}
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
                <p className="text-xs text-gray-500">
                  Filtered by <span className="font-semibold">{drillDown.filterCol} = {drillDown.filterVal}</span> ({drillDown.data.length} rows)
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => exportToExcel(drillDown.data, `DrillDown_${drillDown.title}`)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-medium hover:bg-green-700"
                >
                  <Download className="w-3.5 h-3.5" /> <span>Export Excel</span>
                </button>
                <button onClick={() => setDrillDown(null)} className="p-1.5 text-gray-400 hover:bg-gray-200 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-0">
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
                  Showing first 200 rows. Export to see all {drillDown.data.length} rows.
                </div>
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
