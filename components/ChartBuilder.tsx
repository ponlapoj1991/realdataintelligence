/**
 * ChartBuilder v6.0 - Complete Chart System Redesign
 *
 * NEW FEATURES:
 * - Chart Type Selector Screen (Google Sheets style)
 * - Chart-specific configuration forms
 * - 23 chart types with proper metadata
 * - Stack By field for stacked charts
 * - Bubble chart support (3D scatter)
 * - Pie/Donut specific configs
 * - Line curve types
 *
 * PREVIOUS FIXES (v5.1):
 * 1. Column Field shows in Series Modal
 * 2. Sort Options (5 types)
 * 3. Bar Orientation
 * 4. Category Filter
 * 5. Double-click colors
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Save, ChevronDown, ChevronUp, Palette, Type as TypeIcon, Sliders as SlidersIcon, Plus, Trash2, Edit as EditIcon, Search } from 'lucide-react';
import {
  ChartType,
  DashboardWidget,
  AggregateMethod,
  RawRow,
  DataLabelConfig,
  AxisConfig,
  LegendConfig,
  CategoryConfig,
  SeriesConfig,
  SortOrder
} from '../types';
import { ChartTheme, CLASSIC_ANALYTICS_THEME } from '../constants/chartTheme';
import ChartTypeSelector from './ChartTypeSelector';
import ChartConfigForm from './ChartConfigForm';
import { getChartSupports, getDefaultOrientation, validateChartConfig } from '../utils/chartConfigHelpers';
import MagicWidgetRenderer from './MagicWidgetRenderer';
import { buildColumnProfiles } from '../utils/columnProfiles';
import { buildFieldErrors, getConstraintsForType, hasBlockingErrors } from '../utils/chartValidation';
import { useMagicAggregationWorker } from '../hooks/useMagicAggregationWorker';

interface ChartBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (widget: DashboardWidget) => void;
  availableColumns: string[];
  initialWidget?: DashboardWidget | null;
  data: RawRow[];
  chartTheme?: ChartTheme;
}

const generateId = () => 'w-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1'];
const COLOR_SWATCHES = [
  '#1D4ED8', '#3B82F6', '#06B6D4', '#0EA5E9', '#22C55E', '#16A34A', '#F59E0B', '#F97316',
  '#EF4444', '#DC2626', '#8B5CF6', '#A855F7', '#EC4899', '#DB2777', '#14B8A6', '#0F766E',
  '#111827', '#4B5563', '#9CA3AF', '#D1D5DB'
];

const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Default', value: '' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
];

const createDefaultLegend = (): LegendConfig => ({
  enabled: true,
  position: 'bottom',
  fontSize: 11,
  fontFamily: undefined,
  fontColor: '#666666',
  alignment: 'center'
});

const createDefaultDataLabels = (): DataLabelConfig => ({
  enabled: false,
  position: 'top',
  fontSize: 11,
  fontWeight: 'normal',
  fontFamily: undefined,
  color: '#000000',
  valueFormat: 'auto',
  showCategoryName: false,
  showPercent: false,
  percentPlacement: 'suffix',
  percentDecimals: 1
});

const createDefaultAxis = (overrides: Partial<AxisConfig> = {}): AxisConfig => ({
  title: '',
  min: 'auto',
  max: 'auto',

  show: true,

  fontSize: 11,
  fontFamily: undefined,
  fontColor: '#666666',
  format: '#,##0',

  showGridlines: true,
  gridColor: '#E5E7EB',
  slant: 0,
  ...overrides
});

// Collapsible Section
const Section: React.FC<{
  title: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon, isOpen, onToggle, children }) => (
  <div className="border border-gray-200 rounded-lg mb-2 bg-white">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      style={{ outline: 'none' }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-gray-900">{title}</span>
      </div>
      {isOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
    </button>
    {isOpen && <div className="px-4 pb-4 pt-2">{children}</div>}
  </div>
);

// Category Config Modal (for double-click)
const CategoryConfigModal: React.FC<{
  isOpen: boolean;
  category: string;
  config: CategoryConfig;
  onClose: () => void;
  onSave: (config: CategoryConfig) => void;
}> = ({ isOpen, category, config, onClose, onSave }) => {
  const [color, setColor] = useState(config.color || COLORS[0]);
  const [label, setLabel] = useState(config.label || category);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Edit "{category}"</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="grid grid-cols-10 gap-2 mb-3">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  className={`h-7 w-7 rounded border ${color === swatch ? 'ring-2 ring-blue-500 border-blue-200' : 'border-gray-200'}`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-16 h-10 border border-gray-300 rounded cursor-pointer"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                style={{ outline: 'none' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Custom Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={category}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              style={{ outline: 'none' }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
            style={{ outline: 'none' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave({ color, label: label !== category ? label : undefined });
              onClose();
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            style={{ outline: 'none' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// Series Config Modal (FIXED: Column field shows full width)
const SeriesConfigModal: React.FC<{
  isOpen: boolean;
  series: SeriesConfig | null;
  availableColumns: string[];
  onClose: () => void;
  onSave: (series: SeriesConfig) => void;
}> = ({ isOpen, series, availableColumns, onClose, onSave }) => {
  const [label, setLabel] = useState(series?.label || '');
  const [type, setType] = useState<'bar' | 'line' | 'area'>(series?.type || 'bar');
  const [measure, setMeasure] = useState<AggregateMethod>(series?.measure || 'count');
  const [measureCol, setMeasureCol] = useState(series?.measureCol || '');
  const [yAxis, setYAxis] = useState<'left' | 'right'>(series?.yAxis || 'left');
  const [color, setColor] = useState(series?.color || COLORS[0]);

  useEffect(() => {
    if (!isOpen) return;
    setLabel(series?.label || '');
    setType(series?.type || 'bar');
    setMeasure(series?.measure || 'count');
    setMeasureCol(series?.measureCol || '');
    setYAxis(series?.yAxis || 'left');
    setColor(series?.color || COLORS[0]);
  }, [isOpen, series]);

  const needsColumn = measure === 'sum' || measure === 'avg';

  if (!isOpen) return null;

  const handleSave = () => {
    const newSeries: SeriesConfig = {
      id: series?.id || `s-${Date.now()}`,
      label: label || 'Untitled Series',
      type,
      measure,
      measureCol: needsColumn ? measureCol : undefined,
      yAxis,
      color
    };
    onSave(newSeries);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[500px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">
          {series ? 'Edit Series' : 'Add Series'}
        </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Series Name</label>
          <input
            type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Post Count, Engagement Rate"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              style={{ outline: 'none' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Chart Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                style={{ outline: 'none' }}
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Y-Axis</label>
              <select
                value={yAxis}
                onChange={(e) => setYAxis(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                style={{ outline: 'none' }}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Measure</label>
            <select
              value={measure}
              onChange={(e) => setMeasure(e.target.value as AggregateMethod)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              style={{ outline: 'none' }}
            >
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
            </select>
          </div>

          {/* FIXED: Column field shows full width when needed */}
          {needsColumn && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Column</label>
              <select
                value={measureCol}
                onChange={(e) => setMeasureCol(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                style={{ outline: 'none' }}
              >
                <option value="">Select...</option>
                {availableColumns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>
          )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
          <div className="grid grid-cols-10 gap-2 mb-3">
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className={`h-7 w-7 rounded border ${color === swatch ? 'ring-2 ring-blue-500 border-blue-200' : 'border-gray-200'}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
                className="w-16 h-10 border border-gray-300 rounded cursor-pointer"
                style={{ outline: 'none' }}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                style={{ outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
            style={{ outline: 'none' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            style={{ outline: 'none' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const ChartBuilder: React.FC<ChartBuilderProps> = ({
  isOpen,
  onClose,
  onSave,
  availableColumns,
  initialWidget,
  data,
  chartTheme = CLASSIC_ANALYTICS_THEME
}) => {
  const previewWorker = useMagicAggregationWorker(data, chartTheme);
  // UI State
  const [showTypeSelector, setShowTypeSelector] = useState(true); // Show type selector first
  const [activeTab, setActiveTab] = useState<'setup' | 'customize'>('setup');

  // Widget state
  const [title, setTitle] = useState('New Chart');
  const [type, setType] = useState<ChartType | null>(null); // null until selected
  const [dimension, setDimension] = useState('');
  const [width, setWidth] = useState<'half' | 'full'>('half');

  // Stacked Charts
  const [stackBy, setStackBy] = useState('');

  // Bubble/Scatter
  const [xDimension, setXDimension] = useState('');
  const [yDimension, setYDimension] = useState('');
  const [sizeDimension, setSizeDimension] = useState('');
  const [colorBy, setColorBy] = useState('');

  // Scatter XY (dual aggregation)
  const [xMeasure, setXMeasure] = useState<AggregateMethod>('count');
  const [xMeasureCol, setXMeasureCol] = useState('');
  const [yMeasure, setYMeasure] = useState<AggregateMethod>('sum');
  const [yMeasureCol, setYMeasureCol] = useState('');

  // Pie/Donut
  const [innerRadius, setInnerRadius] = useState(0);
  const [startAngle, setStartAngle] = useState(0);

  // Line
  const [curveType, setCurveType] = useState<'linear' | 'monotone' | 'step'>('linear');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeStyle, setStrokeStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [barSize, setBarSize] = useState(22);
  const [categoryGap, setCategoryGap] = useState(20);

  // Sort & Filter
  const [sortBy, setSortBy] = useState<SortOrder>('value-desc');
  const [topNEnabled, setTopNEnabled] = useState(false);
  const [topNCount, setTopNCount] = useState(5);
  const [groupOthers, setGroupOthers] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState('');

  // Bar Orientation (deprecated - now determined by chart type)
  const [barOrientation, setBarOrientation] = useState<'vertical' | 'horizontal'>('vertical');

  // Multiple Series (for Combo charts)
const [series, setSeries] = useState<SeriesConfig[]>([]);
const [sortSeriesId, setSortSeriesId] = useState('');

  // Legacy single-series (for backward compatibility)
  const [measure, setMeasure] = useState<AggregateMethod>('count');
  const [measureCol, setMeasureCol] = useState('');
  const [kpiCountMode, setKpiCountMode] = useState<'row' | 'group'>('row');
  const [categoryConfig, setCategoryConfig] = useState<Record<string, CategoryConfig>>({});
  const [primaryColor, setPrimaryColor] = useState<string>(CLASSIC_ANALYTICS_THEME.palette[0] || '#3B82F6');

  // Style state
  const [chartTitle, setChartTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [legend, setLegend] = useState<LegendConfig>(createDefaultLegend);
  const [dataLabels, setDataLabels] = useState<DataLabelConfig>(createDefaultDataLabels);

  // Axes state
  const [xAxis, setXAxis] = useState<AxisConfig>(() => createDefaultAxis({ min: undefined, max: undefined, format: undefined }));
  const [leftYAxis, setLeftYAxis] = useState<AxisConfig>(createDefaultAxis);
  const [rightYAxis, setRightYAxis] = useState<AxisConfig>(createDefaultAxis);
  const [valueFormat, setValueFormat] = useState<'number' | 'compact' | 'percent' | 'currency'>('number');

  // Global grid toggle (applies to all axes/gridlines)
  const [showGrid, setShowGrid] = useState(true);

  // UI state
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [seriesModal, setSeriesModal] = useState<{ isOpen: boolean; series: SeriesConfig | null }>({ isOpen: false, series: null });
  const [categoryModal, setCategoryModal] = useState<{ isOpen: boolean; category: string } | null>(null);
  // Active series tab for multi-series customization
  const [activeSeriesTab, setActiveSeriesTab] = useState<string | null>(null);

  const resetBuilderState = useCallback(() => {
    setShowTypeSelector(true);
    setActiveTab('setup');
    setTitle('New Chart');
    setType(null);
    setDimension(availableColumns[0] || '');
    setWidth('half');
    setStackBy('');
    setXDimension('');
    setYDimension('');
    setSizeDimension('');
    setColorBy('');
    setXMeasure('count');
    setXMeasureCol('');
    setYMeasure('sum');
    setYMeasureCol('');
    setInnerRadius(0);
    setStartAngle(0);
    setCurveType('linear');
    setStrokeWidth(2);
    setStrokeStyle('solid');
    setPrimaryColor(COLORS[0]);
    setBarSize(22);
    setCategoryGap(20);
    setSortBy('value-desc');
    setTopNEnabled(false);
    setTopNCount(5);
    setGroupOthers(true);
    setCategoryFilter([]);
    setCategorySearch('');
    setBarOrientation('vertical');
    setSeries([]);
    setSortSeriesId('');
    setMeasure('count');
    setMeasureCol('');
    setKpiCountMode('row');
    setCategoryConfig({});
    setPrimaryColor(CLASSIC_ANALYTICS_THEME.palette[0] || '#3B82F6');
    setChartTitle('');
    setSubtitle('');
    setLegend(createDefaultLegend());
    setDataLabels(createDefaultDataLabels());
    setXAxis(createDefaultAxis({ min: undefined, max: undefined, format: undefined }));
    setLeftYAxis(createDefaultAxis());
    setRightYAxis(createDefaultAxis());
    setValueFormat('number');
    setShowGrid(true);
    setOpenSections(new Set());
    setSeriesModal({ isOpen: false, series: null });
    setCategoryModal(null);
  }, [availableColumns]);

  // Initialize
  useEffect(() => {
    if (!isOpen) return;

    if (initialWidget) {
      setShowTypeSelector(false);
      setActiveTab('setup');
      setTitle(initialWidget.title);
      setType(initialWidget.type);
      setDimension(initialWidget.dimension);
      setWidth(initialWidget.width);
      setSortBy(initialWidget.sortBy || 'value-desc');
      if (typeof initialWidget.topN === 'number' && initialWidget.topN > 0) {
        setTopNEnabled(true);
        setTopNCount(initialWidget.topN);
        setGroupOthers(initialWidget.groupOthers !== false);
      } else {
        setTopNEnabled(false);
        setTopNCount(5);
        setGroupOthers(true);
      }
      setBarOrientation(initialWidget.barOrientation || 'vertical');
      setCategoryFilter(initialWidget.categoryFilter || []);
      setChartTitle(initialWidget.chartTitle || initialWidget.title);
      setSubtitle(initialWidget.subtitle || '');
      setKpiCountMode(initialWidget.kpiCountMode || 'row');

      if (initialWidget.series && initialWidget.series.length > 0) {
        setSeries(initialWidget.series);
        setSortSeriesId(initialWidget.sortSeriesId || initialWidget.series[0]?.id || '');
      } else {
        setMeasure(initialWidget.measure || 'count');
        setMeasureCol(initialWidget.measureCol || '');
        setSortSeriesId('');
      }

      setCategoryConfig(initialWidget.categoryConfig || {});
      setPrimaryColor(initialWidget.color || CLASSIC_ANALYTICS_THEME.palette[0] || '#3B82F6');

      // Scatter XY (dual aggregation)
      setXMeasure(initialWidget.xMeasure || 'count');
      setXMeasureCol(initialWidget.xMeasureCol || '');
      setYMeasure(initialWidget.yMeasure || 'sum');
      setYMeasureCol(initialWidget.yMeasureCol || '');

      // Pie/Donut (edit-mode persistence)
      setInnerRadius(
        typeof initialWidget.innerRadius === 'number'
          ? initialWidget.innerRadius
          : initialWidget.type === 'donut'
            ? 50
            : 0
      );
      setStartAngle(typeof initialWidget.startAngle === 'number' ? initialWidget.startAngle : 0);

      // Line/Area styling
      setCurveType(initialWidget.curveType || (initialWidget.type === 'smooth-line' ? 'monotone' : 'linear'));
      setStrokeWidth(typeof initialWidget.strokeWidth === 'number' ? initialWidget.strokeWidth : 2);
      setStrokeStyle(initialWidget.strokeStyle || 'solid');
      setPrimaryColor(initialWidget.color || COLORS[0]);

      setLegend(initialWidget.legend || createDefaultLegend());
      const nextLabels = initialWidget.dataLabels || createDefaultDataLabels();
      if (initialWidget.type === 'kpi' && !initialWidget.dataLabels) {
        nextLabels.enabled = true;
        nextLabels.position = 'center';
        nextLabels.fontSize = 72;
        nextLabels.fontWeight = 'bold';
        nextLabels.color = initialWidget.color || CLASSIC_ANALYTICS_THEME.palette[0] || nextLabels.color;
      }
      setDataLabels(nextLabels);
      setXAxis(initialWidget.xAxis || createDefaultAxis({ min: undefined, max: undefined, format: undefined }));
      setLeftYAxis(initialWidget.leftYAxis || createDefaultAxis());
      setRightYAxis(initialWidget.rightYAxis || createDefaultAxis());
      setShowGrid(initialWidget.showGrid !== false);
      setBarSize(initialWidget.barSize || 22);
      setCategoryGap(initialWidget.categoryGap ?? 20);
      if (initialWidget.valueFormat) {
        setValueFormat(initialWidget.valueFormat);
      } else if (['100-stacked-column', '100-stacked-bar', '100-stacked-area'].includes(initialWidget.type)) {
        setValueFormat('percent');
      } else {
        setValueFormat('number');
      }
    } else {
      resetBuilderState();
    }
  }, [isOpen, initialWidget, availableColumns, resetBuilderState]);

  // Sorting function (must be declared before useMemo that uses it)
  const applySorting = (data: any[], order: SortOrder, valueKey: string) => {
    switch (order) {
      case 'value-desc':
        return [...data].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
      case 'value-asc':
        return [...data].sort((a, b) => (a[valueKey] || 0) - (b[valueKey] || 0));
      case 'name-asc':
        return [...data].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      case 'name-desc':
        return [...data].sort((a, b) => String(b.name).localeCompare(String(a.name)));
      case 'original':
      default:
        return data; // No sorting
    }
  };

  const sortByTotals = (rows: any[], order: SortOrder) => {
    const withTotals = rows.map((row) => ({
      ...row,
      __total: Object.keys(row)
        .filter((k) => k !== 'name')
        .reduce((sum, key) => sum + (row[key] || 0), 0)
    }));

    const sorted = applySorting(withTotals, order, '__total');
    return sorted.map(({ __total, ...rest }) => rest);
  };

  const supports = useMemo(() => (type ? getChartSupports(type) : null), [type]);

  // Get all unique categories from data
  const allCategories = useMemo(() => {
    if (!dimension || data.length === 0) return [];
    const unique = new Set<string>();
    data.forEach(row => {
      const val = String(row[dimension] || 'N/A');
      unique.add(val);
    });
    return Array.from(unique).sort();
  }, [dimension, data]);

  const stackKeys = useMemo(() => {
    if (!supports?.stackBy) return [];
    if (!stackBy) return [];
    if (data.length === 0) return [];
    const unique = new Set<string>();
    data.forEach((row) => {
      const raw = row[stackBy];
      const s = String(raw ?? '(Other)').trim();
      unique.add(s || '(Empty)');
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [supports?.stackBy, stackBy, data]);

  const kpiCategories = useMemo(() => {
    if (type !== 'kpi') return [];
    if (measure !== 'count') return [];
    if (!measureCol) return [];
    const unique = new Set<string>();
    data.forEach((row) => {
      const raw = row[measureCol];
      if (raw === null || raw === undefined) return;
      const s = String(raw).trim();
      if (!s) return;
      unique.add(s);
    });
    return Array.from(unique).sort();
  }, [type, measure, measureCol, data]);

  const prevKpiColRef = useRef<string>('');
  useEffect(() => {
    if (type !== 'kpi') return;
    if (measure !== 'count') return;
    if (kpiCountMode !== 'group') return;
    const prev = prevKpiColRef.current;
    if (prev && prev !== measureCol) {
      setCategoryFilter([]);
      setCategorySearch('');
    }
    prevKpiColRef.current = measureCol;
  }, [type, measure, kpiCountMode, measureCol]);

  const toggleSection = (section: string) => {
    const newSections = new Set(openSections);
    if (newSections.has(section)) {
      newSections.delete(section);
    } else {
      newSections.add(section);
    }
    setOpenSections(newSections);
  };

  const handleSave = () => {
    if (!type) return;

    if (blockingErrors) {
      setActiveTab('setup');
      alert('Please fix the highlighted fields before saving.');
      return;
    }
    const errors = validateChartConfig(type, {
      dimension,
      stackBy,
      measure,
      measureCol,
      series,
      xDimension,
      yDimension,
      sizeDimension,
      xMeasure,
      xMeasureCol,
      yMeasure,
      yMeasureCol
    });

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    const widget: DashboardWidget = {
      ...initialWidget, // preserve layout fields (e.g., colSpan/sectionIndex) and any legacy props
      id: initialWidget?.id || generateId(),
      title,
      type: type!,
      color: primaryColor,
      dimension: supports?.dimension ? dimension : '',
      width,
      sortBy,
      barOrientation,
      categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
      sortSeriesId: sortSeriesId || undefined,
      chartTitle,
      subtitle,
      legend,
      dataLabels,
      xAxis,
      leftYAxis,
      rightYAxis,
      showGrid,
      barSize,
      categoryGap,
      topN: topNEnabled ? Math.max(1, topNCount) : undefined,
      groupOthers: topNEnabled ? groupOthers : undefined,
      valueFormat,
      categoryConfig,

      // Preserve layout fields when editing
      colSpan: initialWidget?.colSpan ?? initialWidget?.colSpan,
      sectionIndex: initialWidget?.sectionIndex ?? initialWidget?.sectionIndex,

      // Stacked charts
      stackBy: stackBy || undefined,

      // Bubble/Scatter
      xDimension: xDimension || undefined,
      yDimension: yDimension || undefined,
      sizeDimension: sizeDimension || undefined,
      colorBy: colorBy || undefined,

      // Scatter XY (dual aggregation)
      xMeasure: (type === 'scatter' || type === 'bubble') ? xMeasure : undefined,
      xMeasureCol: (type === 'scatter' || type === 'bubble') && (xMeasure === 'sum' || xMeasure === 'avg') ? xMeasureCol : undefined,
      yMeasure: (type === 'scatter' || type === 'bubble') ? yMeasure : undefined,
      yMeasureCol: (type === 'scatter' || type === 'bubble') && (yMeasure === 'sum' || yMeasure === 'avg') ? yMeasureCol : undefined,

      // Pie/Donut
      innerRadius: type === 'donut' ? innerRadius : undefined,
      startAngle: (type === 'pie' || type === 'donut') ? startAngle : undefined,

      // Line
      curveType: (type === 'line' || type === 'smooth-line' || type?.includes('area')) ? curveType : undefined,
      strokeWidth: (type === 'line' || type === 'smooth-line' || type?.includes('area')) ? strokeWidth : undefined,
      strokeStyle: (type === 'line' || type === 'smooth-line' || type?.includes('area')) ? strokeStyle : undefined,

      // KPI
      kpiCountMode: type === 'kpi' ? kpiCountMode : undefined
    };

    // Add series for multi-series charts
    if (supports?.multiSeries && series.length > 0) {
      widget.series = series;
    } else {
      // Single-series
      widget.measure = measure;
      widget.measureCol = measureCol || undefined;
    }

    onSave(widget);
    onClose();
  };

  const handleAddSeries = () => {
    setSeriesModal({ isOpen: true, series: null });
  };

  const handleEditSeries = (s: SeriesConfig) => {
    setSeriesModal({ isOpen: true, series: s });
  };

  const handleDeleteSeries = (id: string) => {
    setSeries(series.filter(s => s.id !== id));
  };

  const handleSaveSeries = (newSeries: SeriesConfig) => {
    setSeries((prev) => {
      const existing = prev.find(s => s.id === newSeries.id);
      if (existing) {
        return prev.map(s => s.id === newSeries.id ? newSeries : s);
      }
      return [...prev, newSeries];
    });
    setSortSeriesId((prev) => prev || newSeries.id);
  };

  const handleSeriesChange = (id: string, changes: Partial<SeriesConfig>) => {
    setSeries(prev =>
      prev.map(s => (s.id === id ? { ...s, ...changes } : s))
    );
  };

  useEffect(() => {
    if (sortSeriesId && !series.find(s => s.id === sortSeriesId)) {
      setSortSeriesId(series[0]?.id || '');
    }
  }, [series, sortSeriesId]);

  const handleCategoryToggle = (cat: string) => {
    if (categoryFilter.includes(cat)) {
      setCategoryFilter(categoryFilter.filter(c => c !== cat));
    } else {
      setCategoryFilter([...categoryFilter, cat]);
    }
  };

  const handleSelectAllCategories = () => {
    if (type === 'kpi' && measure === 'count' && kpiCountMode === 'group') {
      setCategoryFilter([...kpiCategories]);
      return;
    }
    setCategoryFilter([...allCategories]);
  };

  const handleClearAllCategories = () => {
    setCategoryFilter([]);
  };

  const handlePreviewCategoryClick = (category: string) => {
    if (!category) return;
    setActiveTab('customize');
    setCategoryModal({ isOpen: true, category });
  };

  // Handle chart type selection
  const handleChartTypeSelect = (selectedType: ChartType) => {
    setType(selectedType);
    setShowTypeSelector(false);
    setActiveTab('setup');

    // Set default orientation based on chart type
    const defaultOrientation = getDefaultOrientation(selectedType);
    setBarOrientation(defaultOrientation);

    const supports = getChartSupports(selectedType);

    // Reset fields based on type
    setDimension(supports.dimension ? (availableColumns[0] || '') : '');
    setStackBy('');
    setSeries([]);
    setSortSeriesId('');
    setMeasure('count');
    setMeasureCol('');
    setKpiCountMode('row');
    setCategoryFilter([]);
    setCategoryConfig({});
    setPrimaryColor(CLASSIC_ANALYTICS_THEME.palette[0] || '#3B82F6');
    setXDimension('');
    setYDimension('');
    setSizeDimension('');
    setColorBy('');
    setXMeasure('count');
    setXMeasureCol('');
    setYMeasure('sum');
    setYMeasureCol('');
    setInnerRadius(selectedType === 'donut' ? 50 : 0);
    setStartAngle(0);
    setCurveType(selectedType === 'smooth-line' ? 'monotone' : 'linear');
    setStrokeWidth(2);
    setStrokeStyle('solid');
    setBarSize(22);
    setCategoryGap(20);
    setLegend(createDefaultLegend());
    if (selectedType === 'kpi') {
      const accent = CLASSIC_ANALYTICS_THEME.palette[0] || '#3B82F6';
      setDataLabels({
        ...createDefaultDataLabels(),
        enabled: true,
        position: 'center',
        fontSize: 72,
        fontWeight: 'bold',
        color: accent,
      });
    } else {
      setDataLabels(createDefaultDataLabels());
    }
    setXAxis(createDefaultAxis({ min: undefined, max: undefined, format: undefined }));

    if (['100-stacked-column', '100-stacked-bar', '100-stacked-area'].includes(selectedType)) {
      setLeftYAxis(createDefaultAxis({ min: 0, max: 1, format: '0%' }));
      setValueFormat('percent');
    } else {
      setLeftYAxis(createDefaultAxis());
      setValueFormat('number');
    }

    setRightYAxis(createDefaultAxis());
  };

  const handleCloseTypeSelector = () => {
    if (!type) {
      onClose();
      return;
    }

    setShowTypeSelector(false);
  };

  const columnProfiles = useMemo(() => buildColumnProfiles(data), [data]);
  const showMajorControl = useMemo(() => {
    if (!type || !dimension) return false;
    const eligibleType =
      type === 'combo' ||
      type === 'line' ||
      type === 'smooth-line' ||
      type === 'area' ||
      type === 'stacked-area' ||
      type === '100-stacked-area';
    if (!eligibleType) return false;
    const colType = columnProfiles[dimension]?.type;
    return colType === 'date' || colType === 'number';
  }, [type, dimension, columnProfiles]);
  const fieldConstraints = useMemo(() => getConstraintsForType(type ?? null), [type]);
  const fieldState = useMemo(
    () => ({
      dimension,
      stackBy,
      measure,
      measureCol,
      xMeasure,
      xMeasureCol,
      yMeasure,
      yMeasureCol,
      xDimension,
      yDimension,
      sizeDimension,
      colorBy
    }),
    [
      dimension,
      stackBy,
      measure,
      measureCol,
      xMeasure,
      xMeasureCol,
      yMeasure,
      yMeasureCol,
      xDimension,
      yDimension,
      sizeDimension,
      colorBy
    ]
  );
  const fieldErrors = useMemo(
    () => buildFieldErrors(type, fieldState, columnProfiles),
    [type, fieldState, columnProfiles]
  );
  const blockingErrors = hasBlockingErrors(fieldErrors);
  const previewWidget = useMemo<DashboardWidget | null>(() => {
    if (!type) return null;
    return {
      id: initialWidget?.id || 'preview',
      title: title || 'Untitled',
      type,
      color: primaryColor,
      width,
      dimension: supports?.dimension ? dimension : '',
      stackBy: stackBy || undefined,
      measure,
      measureCol: measureCol || undefined,
      series: series.length > 0 ? series : undefined,
      sortSeriesId: sortSeriesId || undefined,
      xDimension: xDimension || undefined,
      yDimension: yDimension || undefined,
      sizeDimension: sizeDimension || undefined,
      colorBy: colorBy || undefined,
      xMeasure: (type === 'scatter' || type === 'bubble') ? xMeasure : undefined,
      xMeasureCol: (type === 'scatter' || type === 'bubble') && (xMeasure === 'sum' || xMeasure === 'avg') ? xMeasureCol : undefined,
      yMeasure: (type === 'scatter' || type === 'bubble') ? yMeasure : undefined,
      yMeasureCol: (type === 'scatter' || type === 'bubble') && (yMeasure === 'sum' || yMeasure === 'avg') ? yMeasureCol : undefined,
      chartTitle: chartTitle || title,
      subtitle,
      legend,
      dataLabels,
      innerRadius: type === 'donut' ? innerRadius : undefined,
      startAngle: (type === 'pie' || type === 'donut') ? startAngle : undefined,
      curveType,
      strokeWidth,
      strokeStyle,
      categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
      sortBy,
      barOrientation,
      barSize,
      categoryGap,
      topN: topNEnabled ? Math.max(1, topNCount) : undefined,
      groupOthers: topNEnabled ? groupOthers : undefined,
      categoryConfig,
      filters: [],
      xAxis,
      leftYAxis,
      rightYAxis,
      showGrid,
      valueFormat,
      kpiCountMode: type === 'kpi' ? kpiCountMode : undefined
    } as DashboardWidget;
  }, [
    type,
    initialWidget?.id,
    title,
    width,
    dimension,
    stackBy,
    measure,
    measureCol,
    series,
    xDimension,
    yDimension,
    sizeDimension,
    colorBy,
    primaryColor,
    xMeasure,
    xMeasureCol,
    yMeasure,
    yMeasureCol,
    chartTitle,
    subtitle,
    legend,
    dataLabels,
    innerRadius,
    startAngle,
    curveType,
    strokeWidth,
    strokeStyle,
    categoryFilter,
    sortBy,
    barOrientation,
    barSize,
    categoryGap,
    topNEnabled,
    topNCount,
    groupOthers,
    categoryConfig,
    xAxis,
    leftYAxis,
    rightYAxis,
    showGrid,
    valueFormat,
    sortSeriesId,
    kpiCountMode
  ]);
  const showAxes = Boolean(supports?.axes);
  const isComboChart = type === 'combo';
  const isMultiSeriesChart = supports?.multiSeries;

  const filteredCategories = allCategories.filter(cat =>
    cat.toLowerCase().includes(categorySearch.toLowerCase())
  );

  if (!isOpen) return null;

  // Show ChartTypeSelector if no type selected
  if (showTypeSelector || type === null) {
    return (
      <ChartTypeSelector
        isOpen={true}
        onSelect={handleChartTypeSelect}
        onClose={handleCloseTypeSelector}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-white">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {initialWidget ? 'Edit Chart' : 'Create Chart'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">Configure your visualization</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" style={{ outline: 'none' }}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 2-Column Layout */}
        <div className="flex-1 grid grid-cols-2 gap-6 p-6 overflow-hidden">
          {/* LEFT: Preview */}
          <div className="flex flex-col bg-gray-50 rounded-lg border-2 border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-white border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Live Preview</h3>
              <p className="text-xs text-gray-500 mt-1">
                {previewWidget ? 'Preview matches what will appear on the dashboard' : 'Pick a chart type to start configuring'}
              </p>
            </div>
            <div className="flex-1 bg-white">
              {previewWidget ? (
                <div className="h-full relative">
                  <MagicWidgetRenderer
                    widget={previewWidget}
                    data={data}
                    onValueClick={handlePreviewCategoryClick}
                    theme={chartTheme}
                    isEditing={true}
                    eager
                    workerClient={previewWorker}
                  />
                  {/* Interactive overlay for quick access to panels - only show buttons relevant to chart type */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                    {supports?.legend && (
                      <div className="flex justify-end p-2">
                        <button
                          type="button"
                          className="pointer-events-auto px-2 py-1 text-[11px] rounded bg-white/80 border border-gray-300 text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setActiveTab('customize');
                            toggleSection('legend');
                          }}
                          style={{ outline: 'none' }}
                        >
                          Legend
                        </button>
                      </div>
                    )}
                    {supports?.axes && (
                      <div className="flex justify-end items-end px-2 pb-2">
                        <button
                          type="button"
                          className="pointer-events-auto px-2 py-1 text-[11px] rounded bg-white/80 border border-gray-300 text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setActiveTab('customize');
                            toggleSection('axis');
                          }}
                          style={{ outline: 'none' }}
                        >
                          Axis
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  Select chart settings to see preview
                </div>
              )}
            </div>
          </div>
          {/* RIGHT: Config */}
          <div className="flex flex-col bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <button
                onClick={() => setActiveTab('setup')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'setup'
                    ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{ outline: 'none' }}
              >
                Setup
              </button>
              <button
                onClick={() => setActiveTab('customize')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'customize'
                    ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{ outline: 'none' }}
              >
                Customize
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'setup' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Widget Title</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        placeholder="e.g., Top Posts by Channel"
                        style={{ outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Dashboard Width</label>
                      <select
                        value={width}
                        onChange={(e) => setWidth(e.target.value as 'half' | 'full')}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        style={{ outline: 'none' }}
                      >
                        <option value="half">Half (1 column)</option>
                        <option value="full">Full (2 columns)</option>
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1">Full width spans the entire dashboard row.</p>
                    </div>
                  </div>

                  {/* Chart Type Info with Change Button */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-600">Chart Type</p>
                        <p className="text-base font-semibold text-gray-900 mt-1">
                          {type === 'kpi'
                            ? 'Number'
                            : type && type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowTypeSelector(true)}
                        className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
                      >
                        Change Type
                      </button>
                    </div>
                  </div>

                  {/* Chart Config Form */}
                  <ChartConfigForm
                    chartType={type!}
                    availableColumns={availableColumns}
                    columnProfiles={columnProfiles}
                    fieldConstraints={fieldConstraints}
                    fieldErrors={fieldErrors}
                    dimension={dimension}
                    setDimension={setDimension}
                    stackBy={stackBy}
                    setStackBy={setStackBy}
                    measure={measure}
                    setMeasure={setMeasure}
                    measureCol={measureCol}
                    setMeasureCol={setMeasureCol}
                    primaryColor={primaryColor}
                    setPrimaryColor={setPrimaryColor}
                    series={series}
                    sortSeriesId={sortSeriesId}
                    setSortSeriesId={setSortSeriesId}
                    onAddSeries={handleAddSeries}
                    onEditSeries={handleEditSeries}
                    onDeleteSeries={handleDeleteSeries}
                    xDimension={xDimension}
                    setXDimension={setXDimension}
                    yDimension={yDimension}
                    setYDimension={setYDimension}
                    sizeDimension={sizeDimension}
                    setSizeDimension={setSizeDimension}
                    colorBy={colorBy}
                    setColorBy={setColorBy}
                    xMeasure={xMeasure}
                    setXMeasure={setXMeasure}
                    xMeasureCol={xMeasureCol}
                    setXMeasureCol={setXMeasureCol}
                    yMeasure={yMeasure}
                    setYMeasure={setYMeasure}
                    yMeasureCol={yMeasureCol}
                    setYMeasureCol={setYMeasureCol}
                    innerRadius={innerRadius}
                    setInnerRadius={setInnerRadius}
                    startAngle={startAngle}
                    setStartAngle={setStartAngle}
                    curveType={curveType}
                    setCurveType={setCurveType}
                    strokeWidth={strokeWidth}
                    setStrokeWidth={setStrokeWidth}
                    strokeStyle={strokeStyle}
                    setStrokeStyle={setStrokeStyle}
                    barSize={barSize}
                    setBarSize={setBarSize}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    topNEnabled={topNEnabled}
                    setTopNEnabled={setTopNEnabled}
                    topNCount={topNCount}
                    setTopNCount={setTopNCount}
                    groupOthers={groupOthers}
                    setGroupOthers={setGroupOthers}
                    categoryFilter={categoryFilter}
                    setCategoryFilter={setCategoryFilter}
                    allCategories={allCategories}
                    categorySearch={categorySearch}
                    setCategorySearch={setCategorySearch}
                    onCategoryToggle={handleCategoryToggle}
                    onSelectAllCategories={handleSelectAllCategories}
                    onClearAllCategories={handleClearAllCategories}
                    onSeriesChange={handleSeriesChange}
                    xAxisMajor={typeof xAxis.major === 'number' ? xAxis.major : 0}
                    setXAxisMajor={(val) => setXAxis({ ...xAxis, major: val > 0 ? val : undefined })}
                    kpiCountMode={kpiCountMode}
                    setKpiCountMode={setKpiCountMode}
                    kpiCategories={kpiCategories}
                  />
                </div>
              )}


              {activeTab === 'customize' && (
                <div className="space-y-2">
                  {/* Series Customization - For multi-series charts (Combo, etc.) */}
                  {series.length > 1 && (
                    <Section
                      title="Series Customization"
                      icon={<Palette className="w-4 h-4 text-gray-600" />}
                      isOpen={openSections.has('series-customize')}
                      onToggle={() => toggleSection('series-customize')}
                    >
                      <div className="space-y-4">
                        {/* Series Tabs */}
                        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
                          {series.map((s, idx) => (
                            <button
                              key={s.id}
                              onClick={() => setActiveSeriesTab(s.id)}
                              className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                                (activeSeriesTab === s.id || (!activeSeriesTab && idx === 0))
                                  ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                              }`}
                            >
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-1.5"
                                style={{ backgroundColor: s.color }}
                              />
                              {s.label || `Series ${idx + 1}`}
                            </button>
                          ))}
                        </div>

                        {/* Active Series Config */}
                        {series.map((s, idx) => {
                          const isActive = activeSeriesTab === s.id || (!activeSeriesTab && idx === 0);
                          if (!isActive) return null;

                          return (
                            <div key={s.id} className="space-y-4">
                              {/* Series Type */}
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Chart Type</label>
                                  <select
                                    value={s.type}
                                    onChange={(e) => handleSeriesChange(s.id, { type: e.target.value as 'bar' | 'line' | 'area' })}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  >
                                    <option value="bar">Bar</option>
                                    <option value="line">Line</option>
                                    <option value="area">Area</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Y-Axis</label>
                                  <select
                                    value={s.yAxis}
                                    onChange={(e) => handleSeriesChange(s.id, { yAxis: e.target.value as 'left' | 'right' })}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  >
                                    <option value="left">Left</option>
                                    <option value="right">Right</option>
                                  </select>
                                </div>
                              </div>

                              {/* Series Color */}
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-2">Color</label>
                                <div className="grid grid-cols-10 gap-1.5 mb-2">
                                  {COLOR_SWATCHES.map((swatch) => (
                                    <button
                                      key={swatch}
                                      type="button"
                                      onClick={() => handleSeriesChange(s.id, { color: swatch })}
                                      className={`h-6 w-6 rounded border ${s.color === swatch ? 'ring-2 ring-blue-500 border-blue-200' : 'border-gray-200'}`}
                                      style={{ backgroundColor: swatch }}
                                    />
                                  ))}
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={s.color}
                                    onChange={(e) => handleSeriesChange(s.id, { color: e.target.value })}
                                    className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                                  />
                                  <input
                                    type="text"
                                    value={s.color}
                                    onChange={(e) => handleSeriesChange(s.id, { color: e.target.value })}
                                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
                                  />
                                </div>
                              </div>

                              {/* Series Label */}
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
                                <input
                                  type="text"
                                  value={s.label || ''}
                                  onChange={(e) => handleSeriesChange(s.id, { label: e.target.value })}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  placeholder={`Series ${idx + 1}`}
                                />
                              </div>

                              {/* Measure Config */}
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Measure</label>
                                  <select
                                    value={s.measure}
                                    onChange={(e) => {
                                      const next = e.target.value as AggregateMethod;
                                      handleSeriesChange(s.id, {
                                        measure: next,
                                        measureCol: next === 'count' ? undefined : s.measureCol
                                      });
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  >
                                    <option value="count">Count</option>
                                    <option value="sum">Sum</option>
                                    <option value="avg">Average</option>
                                  </select>
                                </div>
                                {(s.measure === 'sum' || s.measure === 'avg') && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Column</label>
                                    <select
                                      value={s.measureCol || ''}
                                      onChange={(e) => handleSeriesChange(s.id, { measureCol: e.target.value || undefined })}
                                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                    >
                                      <option value="">Select...</option>
                                      {availableColumns.map((col) => (
                                        <option key={col} value={col}>{col}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>

                              {/* Line/Area Style */}
                              {(s.type === 'line' || s.type === 'area') && (
                                <div className="border-t border-gray-200 pt-3 space-y-3">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={s.smooth ?? false}
                                      onChange={(e) => handleSeriesChange(s.id, { smooth: e.target.checked })}
                                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                                    />
                                    <span className="text-xs font-medium text-gray-700">Smooth Line</span>
                                  </label>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      Stroke Width: {s.strokeWidth ?? 2}px
                                    </label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={s.strokeWidth ?? 2}
                                      onChange={(e) => handleSeriesChange(s.id, { strokeWidth: parseInt(e.target.value) })}
                                      className="w-full"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Stroke Style</label>
                                    <select
                                      value={s.strokeStyle || 'solid'}
                                      onChange={(e) => handleSeriesChange(s.id, { strokeStyle: e.target.value as any })}
                                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                    >
                                      <option value="solid">Solid</option>
                                      <option value="dashed">Dashed</option>
                                      <option value="dotted">Dotted</option>
                                    </select>
                                  </div>
                                </div>
                              )}

                              {/* Data Labels per Series */}
                              <div className="border-t border-gray-200 pt-3 space-y-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={s.dataLabels?.enabled ?? false}
                                    onChange={(e) => handleSeriesChange(s.id, {
                                      dataLabels: { ...(s.dataLabels ?? createDefaultDataLabels()), enabled: e.target.checked }
                                    })}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                                  />
                                  <span className="text-xs font-medium text-gray-700">Show Data Labels</span>
                                </label>
                                {s.dataLabels?.enabled && (
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Position</label>
                                      <select
                                        value={s.dataLabels?.position || 'top'}
                                        onChange={(e) => handleSeriesChange(s.id, {
                                          dataLabels: { ...(s.dataLabels ?? createDefaultDataLabels()), enabled: true, position: e.target.value as any }
                                        })}
                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                      >
                                        <option value="top">Top</option>
                                        <option value="inside">Inside</option>
                                        <option value="outside">Outside</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Font Size</label>
                                      <input
                                        type="number"
                                        min={8}
                                        max={20}
                                        value={s.dataLabels?.fontSize ?? 11}
                                        onChange={(e) => handleSeriesChange(s.id, {
                                          dataLabels: { ...(s.dataLabels ?? createDefaultDataLabels()), enabled: true, fontSize: parseInt(e.target.value) || 11 }
                                        })}
                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                      />
                                    </div>
                                    <div className="col-span-2">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Value Format</label>
                                      <select
                                        value={s.dataLabels?.valueFormat || 'auto'}
                                        onChange={(e) => handleSeriesChange(s.id, {
                                          dataLabels: { ...(s.dataLabels ?? createDefaultDataLabels()), enabled: true, valueFormat: e.target.value as any }
                                        })}
                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                      >
                                        <option value="auto">Auto</option>
                                        <option value="text">Text</option>
                                        <option value="number">Number (1,000)</option>
                                        <option value="compact">Compact (1.2k)</option>
                                        <option value="accounting">Accounting (2 decimals)</option>
                                      </select>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  {/* Stack colors (for stacked charts) */}
                  {supports?.stackBy && !!stackBy && stackKeys.length > 0 && (
                    <Section
                      title="Stack Colors"
                      icon={<Palette className="w-4 h-4 text-gray-600" />}
                      isOpen={openSections.has('stack-colors')}
                      onToggle={() => toggleSection('stack-colors')}
                    >
                      <div className="space-y-2">
                        {stackKeys.map((key, idx) => {
                          const fallback =
                            chartTheme.palette[idx % chartTheme.palette.length] ||
                            COLORS[idx % COLORS.length] ||
                            '#3B82F6';
                          const color = categoryConfig[key]?.color || fallback;
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <button
                                type="button"
                                className="w-6 h-6 rounded border border-gray-300"
                                style={{ backgroundColor: color }}
                                onClick={() => setCategoryModal({ isOpen: true, category: key })}
                                aria-label={`Edit ${key}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-800 truncate">{key}</div>
                              </div>
                              <input
                                type="color"
                                value={color}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setCategoryConfig((prev) => ({
                                    ...prev,
                                    [key]: { ...(prev[key] || {}), color: next },
                                  }));
                                }}
                                className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                                style={{ outline: 'none' }}
                              />
                              <input
                                type="text"
                                value={color}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setCategoryConfig((prev) => ({
                                    ...prev,
                                    [key]: { ...(prev[key] || {}), color: next },
                                  }));
                                }}
                                className="w-28 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
                                style={{ outline: 'none' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  <Section
                    title="Titles"
                    icon={<TypeIcon className="w-4 h-4 text-gray-600" />}
                    isOpen={openSections.has('titles')}
                    onToggle={() => toggleSection('titles')}
                  >
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Chart Title</label>
                        <input
                          type="text"
                          value={chartTitle}
                          onChange={(e) => setChartTitle(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          style={{ outline: 'none' }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Subtitle</label>
                        <input
                          type="text"
                          value={subtitle}
                          onChange={(e) => setSubtitle(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          style={{ outline: 'none' }}
                        />
                      </div>
                    </div>
                  </Section>

                  <Section
                    title="Font"
                    icon={<TypeIcon className="w-4 h-4 text-gray-700" />}
                    isOpen={openSections.has('font')}
                    onToggle={() => toggleSection('font')}
                  >
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Legend Font</label>
                          <select
                            value={legend.fontFamily || ''}
                            onChange={(e) => setLegend({ ...legend, fontFamily: e.target.value || undefined })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            style={{ outline: 'none' }}
                          >
                            {FONT_OPTIONS.map((opt) => (
                              <option key={opt.value || 'default'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Data Labels Font</label>
                          <select
                            value={dataLabels.fontFamily || ''}
                            onChange={(e) => setDataLabels({ ...dataLabels, fontFamily: e.target.value || undefined })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            style={{ outline: 'none' }}
                          >
                            {FONT_OPTIONS.map((opt) => (
                              <option key={opt.value || 'default'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">X Axis Font</label>
                          <select
                            value={xAxis.fontFamily || ''}
                            onChange={(e) => setXAxis({ ...xAxis, fontFamily: e.target.value || undefined })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            style={{ outline: 'none' }}
                          >
                            {FONT_OPTIONS.map((opt) => (
                              <option key={opt.value || 'default'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Y Axis Font</label>
                          <select
                            value={leftYAxis.fontFamily || ''}
                            onChange={(e) => setLeftYAxis({ ...leftYAxis, fontFamily: e.target.value || undefined })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            style={{ outline: 'none' }}
                          >
                            {FONT_OPTIONS.map((opt) => (
                              <option key={opt.value || 'default'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {isComboChart && (
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Right Y Axis Font</label>
                            <select
                              value={rightYAxis.fontFamily || ''}
                              onChange={(e) => setRightYAxis({ ...rightYAxis, fontFamily: e.target.value || undefined })}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              style={{ outline: 'none' }}
                            >
                              {FONT_OPTIONS.map((opt) => (
                                <option key={opt.value || 'default'} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </Section>

                  {supports?.dataLabels && (
                    <Section
                      title="Data Labels"
                      icon={<TypeIcon className="w-4 h-4 text-gray-600" />}
                      isOpen={openSections.has('data-labels')}
                      onToggle={() => toggleSection('data-labels')}
                    >
                      <div className="space-y-3">
                        <label className="flex items-center text-sm">
                          <input
                            type="checkbox"
                            checked={dataLabels.enabled}
                            onChange={(e) => setDataLabels({ ...dataLabels, enabled: e.target.checked })}
                            className="mr-2"
                            style={{ outline: 'none' }}
                          />
                          Show Data Labels
                        </label>

                        {dataLabels.enabled && (
                          <div className="grid grid-cols-2 gap-3 ml-6">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Position</label>
                              <select
                                value={dataLabels.position}
                                onChange={(e) => setDataLabels({ ...dataLabels, position: e.target.value as any })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                {supports?.pie ? (
                                  <>
                                    <option value="inside">Inside</option>
                                    <option value="outside">Outside</option>
                                    <option value="center">Center</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="top">Top</option>
                                    <option value="center">Center</option>
                                    <option value="bottom">Bottom</option>
                                    <option value="inside">Inside Bar</option>
                                  </>
                                )}
                              </select>
                            </div>

                            {supports?.pie && (
                              <div className="col-span-2">
                                <label className="flex items-center text-sm">
                                  <input
                                    type="checkbox"
                                    checked={dataLabels.showCategoryName ?? false}
                                    onChange={(e) => setDataLabels({ ...dataLabels, showCategoryName: e.target.checked })}
                                    className="mr-2"
                                    style={{ outline: 'none' }}
                                  />
                                  Category Name
                                </label>
                              </div>
                            )}

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Font Size: {dataLabels.fontSize}px</label>
                              <input
                                type="range"
                                min="8"
                                max={type === 'kpi' ? 96 : 24}
                                value={dataLabels.fontSize}
                                onChange={(e) => setDataLabels({ ...dataLabels, fontSize: parseInt(e.target.value) })}
                                className="w-full"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Font Weight</label>
                              <select
                                value={dataLabels.fontWeight}
                                onChange={(e) => setDataLabels({ ...dataLabels, fontWeight: e.target.value as 'normal' | 'bold' })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                <option value="normal">Regular</option>
                                <option value="bold">Bold</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Text Color</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={dataLabels.color}
                                  onChange={(e) => setDataLabels({ ...dataLabels, color: e.target.value })}
                                  className="h-8 w-8 rounded border border-gray-200"
                                  style={{ outline: 'none' }}
                                />
                                <input
                                  type="text"
                                  value={dataLabels.color}
                                  onChange={(e) => setDataLabels({ ...dataLabels, color: e.target.value })}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>

                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Value Format</label>
                              <select
                                value={dataLabels.valueFormat || 'auto'}
                                onChange={(e) => setDataLabels({ ...dataLabels, valueFormat: e.target.value as any })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                <option value="auto">Auto</option>
                                <option value="text">Text</option>
                                <option value="number">Number (1,000)</option>
                                <option value="compact">Compact (1.2k)</option>
                                <option value="accounting">Accounting (2 decimals)</option>
                              </select>
                            </div>

                            <div className="col-span-2">
                              <label className="flex items-center text-sm mb-2">
                                <input
                                  type="checkbox"
                                  checked={dataLabels.showPercent ?? false}
                                  onChange={(e) => setDataLabels({ ...dataLabels, showPercent: e.target.checked })}
                                  className="mr-2"
                                  style={{ outline: 'none' }}
                                />
                                Append Percent Share
                              </label>
                              {dataLabels.showPercent && (
                                <div className="grid grid-cols-2 gap-3 pl-4">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Placement</label>
                                    <select
                                      value={dataLabels.percentPlacement || 'suffix'}
                                      onChange={(e) => setDataLabels({ ...dataLabels, percentPlacement: e.target.value as 'prefix' | 'suffix' })}
                                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                      style={{ outline: 'none' }}
                                    >
                                      <option value="prefix">% before value</option>
                                      <option value="suffix">% after value</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      Decimal Places: {dataLabels.percentDecimals ?? 1}
                                    </label>
                                    <input
                                      type="range"
                                      min="0"
                                      max="4"
                                      value={dataLabels.percentDecimals ?? 1}
                                      onChange={(e) => setDataLabels({ ...dataLabels, percentDecimals: parseInt(e.target.value, 10) })}
                                      className="w-full"
                                      style={{ outline: 'none' }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </Section>
                  )}

                  {supports?.legend && (
                    <Section
                      title="Legend"
                      icon={<Palette className="w-4 h-4 text-gray-600" />}
                      isOpen={openSections.has('legend')}
                      onToggle={() => toggleSection('legend')}
                    >
                      <div className="space-y-3">
                        <label className="flex items-center text-sm">
                          <input
                            type="checkbox"
                            checked={legend.enabled}
                            onChange={(e) => setLegend({ ...legend, enabled: e.target.checked })}
                            className="mr-2"
                            style={{ outline: 'none' }}
                          />
                          Show Legend
                        </label>

                        {legend.enabled && (
                          <div className="grid grid-cols-2 gap-3 ml-6">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Position</label>
                            <select
                              value={legend.position}
                              onChange={(e) => setLegend({ ...legend, position: e.target.value as any })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Font Size: {legend.fontSize}px</label>
                              <input
                                type="range"
                                min="1"
                                max="24"
                                value={legend.fontSize}
                                onChange={(e) => setLegend({ ...legend, fontSize: parseInt(e.target.value) })}
                                className="w-full"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Alignment</label>
                              <select
                                value={legend.alignment || 'center'}
                                onChange={(e) => setLegend({ ...legend, alignment: e.target.value as 'left' | 'center' | 'right' })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                <option value="left">Left</option>
                                <option value="center">Center</option>
                                <option value="right">Right</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Text Color</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={legend.fontColor || '#666666'}
                                  onChange={(e) => setLegend({ ...legend, fontColor: e.target.value })}
                                  className="h-8 w-8 rounded border border-gray-200"
                                  style={{ outline: 'none' }}
                                />
                                <input
                                  type="text"
                                  value={legend.fontColor || '#666666'}
                                  onChange={(e) => setLegend({ ...legend, fontColor: e.target.value })}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </Section>
                  )}

                  {/* Layout Section - Only for Bar/Column charts */}
                  {(type === 'combo' ||
                    type === 'column' ||
                    type === 'stacked-column' ||
                    type === '100-stacked-column' ||
                    type === 'bar' ||
                    type === 'stacked-bar' ||
                    type === '100-stacked-bar') && (
                    <Section
                      title="Layout"
                      icon={<SlidersIcon className="w-4 h-4 text-gray-700" />}
                      isOpen={openSections.has('layout')}
                      onToggle={() => toggleSection('layout')}
                    >
                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-700">
                              Bar Thickness
                            </label>
                            <span className="text-[11px] text-gray-500">{barSize}px</span>
                          </div>
                          <input
                            type="range"
                            min={4}
                            max={120}
                            step={2}
                            value={barSize}
                            onChange={(e) => setBarSize(parseInt(e.target.value, 10))}
                            className="w-full mt-1"
                            style={{ outline: 'none' }}
                          />
                          <p className="text-[11px] text-gray-500 mt-1">
                            Lower = thin columns, Higher = solid blocks (applies to dashboard & preview)
                          </p>
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-700">
                              Category Spacing
                            </label>
                            <span className="text-[11px] text-gray-500">{categoryGap}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={60}
                            value={categoryGap}
                            onChange={(e) => setCategoryGap(parseInt(e.target.value, 10))}
                            className="w-full mt-1"
                            style={{ outline: 'none' }}
                          />
                          <p className="text-[11px] text-gray-500 mt-1">
                            Adjusts spacing between category groups (0 = packed, 60 = airy).
                          </p>
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Axis Section - Only for charts with axes */}
                  {showAxes && (
                    <Section
                      title="Axis"
                      icon={<SlidersIcon className="w-4 h-4 text-gray-600" />}
                      isOpen={openSections.has('axis')}
                      onToggle={() => toggleSection('axis')}
                    >
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center text-sm">
                            <input
                              type="checkbox"
                              checked={showGrid}
                              onChange={(e) => setShowGrid(e.target.checked)}
                              className="mr-2"
                              style={{ outline: 'none' }}
                            />
                            Show Grid (All)
                          </label>
                          {!showGrid && <span className="text-[11px] text-gray-500">Grid is disabled</span>}
                        </div>

                        <div className="border-t border-gray-200 pt-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">X Axis</span>
                            <label className="flex items-center text-xs font-medium text-gray-700">
                              <input
                                type="checkbox"
                                className="mr-2"
                                checked={xAxis.show !== false}
                                onChange={(e) => setXAxis({ ...xAxis, show: e.target.checked })}
                                style={{ outline: 'none' }}
                              />
                              Show
                            </label>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                            <input
                              type="text"
                              value={xAxis.title || ''}
                              onChange={(e) => setXAxis({ ...xAxis, title: e.target.value })}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              style={{ outline: 'none' }}
                            />
                          </div>

                          {showMajorControl && (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Major (แบ่งช่วงแกน X)</label>
                              <input
                                type="number"
                                min={0}
                                max={500}
                                value={xAxis.major ?? 0}
                                onChange={(e) => setXAxis({ ...xAxis, major: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                placeholder="0"
                                style={{ outline: 'none' }}
                              />
                              <p className="text-[11px] text-gray-500 mt-1">
                                ใส่ 0 = แสดงทั้งหมด (ไม่แบ่งช่วง) เช่น 7 = แบ่งเป็น 1-7, 8-14...
                              </p>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Font Size: {xAxis.fontSize ?? 11}px</label>
                              <input
                                type="range"
                                min="8"
                                max="16"
                                value={xAxis.fontSize || 11}
                                onChange={(e) => setXAxis({ ...xAxis, fontSize: parseInt(e.target.value) })}
                                className="w-full"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Label Slant</label>
                              <select
                                value={xAxis.slant || 0}
                                onChange={(e) => setXAxis({ ...xAxis, slant: parseInt(e.target.value) as any })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              >
                                <option value={0}>0°</option>
                                <option value={45}>45°</option>
                                <option value={90}>90°</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Min</label>
                              <input
                                type="text"
                                value={xAxis.min === 'auto' || xAxis.min === undefined || xAxis.min === null ? '' : xAxis.min}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (val === '') {
                                    setXAxis({ ...xAxis, min: 'auto' });
                                  } else if (!Number.isNaN(Number(val))) {
                                    setXAxis({ ...xAxis, min: Number(val) });
                                  }
                                }}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                placeholder="auto"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Max</label>
                              <input
                                type="text"
                                value={xAxis.max === 'auto' || xAxis.max === undefined || xAxis.max === null ? '' : xAxis.max}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (val === '') {
                                    setXAxis({ ...xAxis, max: 'auto' });
                                  } else if (!Number.isNaN(Number(val))) {
                                    setXAxis({ ...xAxis, max: Number(val) });
                                  }
                                }}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                placeholder="auto"
                                style={{ outline: 'none' }}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Label Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={xAxis.fontColor || '#666666'}
                                onChange={(e) => setXAxis({ ...xAxis, fontColor: e.target.value })}
                                className="h-8 w-8 rounded border border-gray-200"
                                style={{ outline: 'none' }}
                              />
                              <input
                                type="text"
                                value={xAxis.fontColor || '#666666'}
                                onChange={(e) => setXAxis({ ...xAxis, fontColor: e.target.value })}
                                className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                style={{ outline: 'none' }}
                              />
                            </div>
                          </div>

                          <label className={`flex items-center text-xs font-medium ${showGrid ? 'text-gray-700' : 'text-gray-400'}`}>
                            <input
                              type="checkbox"
                              className="mr-2"
                              checked={xAxis.showGridlines !== false}
                              disabled={!showGrid}
                              onChange={(e) => setXAxis({ ...xAxis, showGridlines: e.target.checked })}
                              style={{ outline: 'none' }}
                            />
                            Show Gridlines
                          </label>

                          {xAxis.showGridlines !== false && (
                            <div className={showGrid ? '' : 'opacity-50'}>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Gridline Color</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={xAxis.gridColor || '#E5E7EB'}
                                  disabled={!showGrid}
                                  onChange={(e) => setXAxis({ ...xAxis, gridColor: e.target.value })}
                                  className="h-8 w-8 rounded border border-gray-200"
                                  style={{ outline: 'none' }}
                                />
                                <input
                                  type="text"
                                  value={xAxis.gridColor || '#E5E7EB'}
                                  disabled={!showGrid}
                                  onChange={(e) => setXAxis({ ...xAxis, gridColor: e.target.value })}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-gray-200 pt-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Y Axis</span>
                            <label className="flex items-center text-xs font-medium text-gray-700">
                              <input
                                type="checkbox"
                                className="mr-2"
                                checked={leftYAxis.show !== false}
                                onChange={(e) => setLeftYAxis({ ...leftYAxis, show: e.target.checked })}
                                style={{ outline: 'none' }}
                              />
                              Show
                            </label>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                            <input
                              type="text"
                              value={leftYAxis.title || ''}
                              onChange={(e) => setLeftYAxis({ ...leftYAxis, title: e.target.value })}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              style={{ outline: 'none' }}
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Font Size: {leftYAxis.fontSize ?? 11}px</label>
                            <input
                              type="range"
                              min="8"
                              max="18"
                              value={leftYAxis.fontSize || 11}
                              onChange={(e) => setLeftYAxis({ ...leftYAxis, fontSize: parseInt(e.target.value) })}
                              className="w-full"
                              style={{ outline: 'none' }}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Min</label>
                              <input
                                type="text"
                                value={leftYAxis.min === 'auto' || leftYAxis.min === undefined || leftYAxis.min === null ? '' : leftYAxis.min}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (val === '') {
                                    setLeftYAxis({ ...leftYAxis, min: 'auto' });
                                  } else if (!Number.isNaN(Number(val))) {
                                    setLeftYAxis({ ...leftYAxis, min: Number(val) });
                                  }
                                }}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                placeholder="auto"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Max</label>
                              <input
                                type="text"
                                value={leftYAxis.max === 'auto' || leftYAxis.max === undefined || leftYAxis.max === null ? '' : leftYAxis.max}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (val === '') {
                                    setLeftYAxis({ ...leftYAxis, max: 'auto' });
                                  } else if (!Number.isNaN(Number(val))) {
                                    setLeftYAxis({ ...leftYAxis, max: Number(val) });
                                  }
                                }}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                placeholder="auto"
                                style={{ outline: 'none' }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Number Format</label>
                              <input
                                type="text"
                                value={leftYAxis.format || '#,##0'}
                                onChange={(e) => setLeftYAxis({ ...leftYAxis, format: e.target.value })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                placeholder="#,##0.0 | percent | currency"
                                style={{ outline: 'none' }}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Label Color</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={leftYAxis.fontColor || '#666666'}
                                  onChange={(e) => setLeftYAxis({ ...leftYAxis, fontColor: e.target.value })}
                                  className="h-8 w-8 rounded border border-gray-200"
                                  style={{ outline: 'none' }}
                                />
                                <input
                                  type="text"
                                  value={leftYAxis.fontColor || '#666666'}
                                  onChange={(e) => setLeftYAxis({ ...leftYAxis, fontColor: e.target.value })}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>
                          </div>

                          <label className={`flex items-center text-xs font-medium ${showGrid ? 'text-gray-700' : 'text-gray-400'}`}>
                            <input
                              type="checkbox"
                              className="mr-2"
                              checked={leftYAxis.showGridlines !== false}
                              disabled={!showGrid}
                              onChange={(e) => setLeftYAxis({ ...leftYAxis, showGridlines: e.target.checked })}
                              style={{ outline: 'none' }}
                            />
                            Show Gridlines
                          </label>

                          {leftYAxis.showGridlines !== false && (
                            <div className={showGrid ? '' : 'opacity-50'}>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Gridline Color</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={leftYAxis.gridColor || '#E5E7EB'}
                                  disabled={!showGrid}
                                  onChange={(e) => setLeftYAxis({ ...leftYAxis, gridColor: e.target.value })}
                                  className="h-8 w-8 rounded border border-gray-200"
                                  style={{ outline: 'none' }}
                                />
                                <input
                                  type="text"
                                  value={leftYAxis.gridColor || '#E5E7EB'}
                                  disabled={!showGrid}
                                  onChange={(e) => setLeftYAxis({ ...leftYAxis, gridColor: e.target.value })}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {isComboChart && (
                          <div className="border-t border-gray-200 pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Right Y Axis</span>
                              <label className="flex items-center text-xs font-medium text-gray-700">
                                <input
                                  type="checkbox"
                                  className="mr-2"
                                  checked={rightYAxis.show !== false}
                                  onChange={(e) => setRightYAxis({ ...rightYAxis, show: e.target.checked })}
                                  style={{ outline: 'none' }}
                                />
                                Show
                              </label>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                              <input
                                type="text"
                                value={rightYAxis.title || ''}
                                onChange={(e) => setRightYAxis({ ...rightYAxis, title: e.target.value })}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Font Size: {rightYAxis.fontSize ?? 11}px</label>
                              <input
                                type="range"
                                min="8"
                                max="18"
                                value={rightYAxis.fontSize || 11}
                                onChange={(e) => setRightYAxis({ ...rightYAxis, fontSize: parseInt(e.target.value) })}
                                className="w-full"
                                style={{ outline: 'none' }}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Min</label>
                                <input
                                  type="text"
                                  value={rightYAxis.min === 'auto' || rightYAxis.min === undefined || rightYAxis.min === null ? '' : rightYAxis.min}
                                  onChange={(e) => {
                                    const val = e.target.value.trim();
                                    if (val === '') {
                                      setRightYAxis({ ...rightYAxis, min: 'auto' });
                                    } else if (!Number.isNaN(Number(val))) {
                                      setRightYAxis({ ...rightYAxis, min: Number(val) });
                                    }
                                  }}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  placeholder="auto"
                                  style={{ outline: 'none' }}
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Max</label>
                                <input
                                  type="text"
                                  value={rightYAxis.max === 'auto' || rightYAxis.max === undefined || rightYAxis.max === null ? '' : rightYAxis.max}
                                  onChange={(e) => {
                                    const val = e.target.value.trim();
                                    if (val === '') {
                                      setRightYAxis({ ...rightYAxis, max: 'auto' });
                                    } else if (!Number.isNaN(Number(val))) {
                                      setRightYAxis({ ...rightYAxis, max: Number(val) });
                                    }
                                  }}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  placeholder="auto"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Number Format</label>
                                <input
                                  type="text"
                                  value={rightYAxis.format || '#,##0'}
                                  onChange={(e) => setRightYAxis({ ...rightYAxis, format: e.target.value })}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                  placeholder="#,##0.0 | percent | currency"
                                  style={{ outline: 'none' }}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Label Color</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={rightYAxis.fontColor || '#666666'}
                                    onChange={(e) => setRightYAxis({ ...rightYAxis, fontColor: e.target.value })}
                                    className="h-8 w-8 rounded border border-gray-200"
                                    style={{ outline: 'none' }}
                                  />
                                  <input
                                    type="text"
                                    value={rightYAxis.fontColor || '#666666'}
                                    onChange={(e) => setRightYAxis({ ...rightYAxis, fontColor: e.target.value })}
                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                    style={{ outline: 'none' }}
                                  />
                                </div>
                              </div>
                            </div>

                            <label className={`flex items-center text-xs font-medium ${showGrid ? 'text-gray-700' : 'text-gray-400'}`}>
                              <input
                                type="checkbox"
                                className="mr-2"
                                checked={rightYAxis.showGridlines !== false}
                                disabled={!showGrid}
                                onChange={(e) => setRightYAxis({ ...rightYAxis, showGridlines: e.target.checked })}
                                style={{ outline: 'none' }}
                              />
                              Show Gridlines
                            </label>

                            {rightYAxis.showGridlines !== false && (
                              <div className={showGrid ? '' : 'opacity-50'}>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Gridline Color</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={rightYAxis.gridColor || '#E5E7EB'}
                                    disabled={!showGrid}
                                    onChange={(e) => setRightYAxis({ ...rightYAxis, gridColor: e.target.value })}
                                    className="h-8 w-8 rounded border border-gray-200"
                                    style={{ outline: 'none' }}
                                  />
                                  <input
                                    type="text"
                                    value={rightYAxis.gridColor || '#E5E7EB'}
                                    disabled={!showGrid}
                                    onChange={(e) => setRightYAxis({ ...rightYAxis, gridColor: e.target.value })}
                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                                    style={{ outline: 'none' }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          {blockingErrors && (
            <span className="text-xs text-red-500 mr-auto">
              Fix the highlighted fields before saving.
            </span>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
            style={{ outline: 'none' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={blockingErrors}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              blockingErrors
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            style={{ outline: 'none' }}
          >
            <Save className="w-4 h-4" />
            Save Chart
          </button>
        </div>
      </div>

      {seriesModal.isOpen && (
        <SeriesConfigModal
          isOpen={seriesModal.isOpen}
          series={seriesModal.series}
          availableColumns={availableColumns}
          onClose={() => setSeriesModal({ isOpen: false, series: null })}
          onSave={handleSaveSeries}
        />
      )}

      {categoryModal && (
        <CategoryConfigModal
          isOpen={categoryModal.isOpen}
          category={categoryModal.category}
          config={categoryConfig[categoryModal.category] || {}}
          onClose={() => setCategoryModal(null)}
          onSave={(config) => {
            setCategoryConfig({
              ...categoryConfig,
              [categoryModal.category]: config
            });
          }}
        />
      )}
    </div>
  );
};

export default ChartBuilder;
