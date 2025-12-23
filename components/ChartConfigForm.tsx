import React, { useMemo } from 'react';
import { Plus, Trash2, Edit as EditIcon } from 'lucide-react';
import { ChartType, AggregateMethod, SeriesConfig, SortOrder } from '../types';
import {
  getChartSupports,
  isPieChart,
  isLineChart,
  isAreaChart,
  getDefaultOrientation
} from '../utils/chartConfigHelpers';
import { ColumnProfileMap, describeColumnType } from '../utils/columnProfiles';
import { FieldConstraint, ChartFieldKey } from '../constants/chartFieldConstraints';
import { FieldErrorMap } from '../utils/chartValidation';

interface ChartConfigFormProps {
  chartType: ChartType;
  availableColumns: string[];
  columnProfiles: ColumnProfileMap;
  fieldConstraints: FieldConstraint[];
  fieldErrors: FieldErrorMap;

  // Basic fields
  dimension: string;
  setDimension: (val: string) => void;

  // Stacking
  stackBy: string;
  setStackBy: (val: string) => void;

  // Single measure
  measure: AggregateMethod;
  setMeasure: (val: AggregateMethod) => void;
  measureCol: string;
  setMeasureCol: (val: string) => void;
  primaryColor: string;
  setPrimaryColor: (val: string) => void;

  // Multi-series
  series: SeriesConfig[];
  sortSeriesId: string;
  setSortSeriesId: (val: string) => void;
  onAddSeries: () => void;
  onEditSeries: (s: SeriesConfig) => void;
  onDeleteSeries: (id: string) => void;

  // Bubble/Scatter
  xDimension: string;
  setXDimension: (val: string) => void;
  yDimension: string;
  setYDimension: (val: string) => void;
  sizeDimension: string;
  setSizeDimension: (val: string) => void;
  colorBy: string;
  setColorBy: (val: string) => void;

  // Scatter XY (dual aggregation)
  xMeasure: AggregateMethod;
  setXMeasure: (val: AggregateMethod) => void;
  xMeasureCol: string;
  setXMeasureCol: (val: string) => void;
  yMeasure: AggregateMethod;
  setYMeasure: (val: AggregateMethod) => void;
  yMeasureCol: string;
  setYMeasureCol: (val: string) => void;

  // Pie/Donut
  innerRadius: number;
  setInnerRadius: (val: number) => void;
  startAngle: number;
  setStartAngle: (val: number) => void;

  // Line
  curveType: 'linear' | 'monotone' | 'step';
  setCurveType: (val: 'linear' | 'monotone' | 'step') => void;
  strokeWidth: number;
  setStrokeWidth: (val: number) => void;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  setStrokeStyle: (val: 'solid' | 'dashed' | 'dotted') => void;
  barSize: number;
  setBarSize: (val: number) => void;

  // Sort & Filter
  sortBy: SortOrder;
  setSortBy: (val: SortOrder) => void;
  topNEnabled: boolean;
  setTopNEnabled: (val: boolean) => void;
  topNCount: number;
  setTopNCount: (val: number) => void;
  groupOthers: boolean;
  setGroupOthers: (val: boolean) => void;
  groupByString: boolean;
  setGroupByString: (val: boolean) => void;
  categoryFilter: string[];
  setCategoryFilter: (val: string[]) => void;
  allCategories: string[];
  categorySearch: string;
  setCategorySearch: (val: string) => void;
  onCategoryToggle: (cat: string) => void;
  onSelectAllCategories: () => void;
  onClearAllCategories: () => void;
  // Series (for multi-series widgets)
  seriesCategories: string[];
  seriesFilter: string[];
  seriesSearch: string;
  setSeriesSearch: (val: string) => void;
  onSeriesToggle: (cat: string) => void;
  onSelectAllSeries: () => void;
  onClearAllSeries: () => void;
  seriesGroupByString: boolean;
  setSeriesGroupByString: (val: boolean) => void;
  onSeriesChange: (id: string, changes: Partial<SeriesConfig>) => void;

  // Line chart grouping (Major interval) - stored on X axis
  xAxisMajor: number;
  setXAxisMajor: (val: number) => void;
  fillMode: 'gaps' | 'zero' | 'connect';
  setFillMode: (val: 'gaps' | 'zero' | 'connect') => void;

  // KPI (Number)
  kpiCountMode: 'row' | 'group';
  setKpiCountMode: (val: 'row' | 'group') => void;
  kpiCategories: string[];
}

const ChartConfigForm: React.FC<ChartConfigFormProps> = ({
  chartType,
  availableColumns,
  columnProfiles,
  fieldConstraints,
  fieldErrors,
  dimension,
  setDimension,
  stackBy,
  setStackBy,
  measure,
  setMeasure,
  measureCol,
  setMeasureCol,
  primaryColor,
  setPrimaryColor,
  series,
  sortSeriesId,
  setSortSeriesId,
  onAddSeries,
  onEditSeries,
  onDeleteSeries,
  xDimension,
  setXDimension,
  yDimension,
  setYDimension,
  sizeDimension,
  setSizeDimension,
  colorBy,
  setColorBy,
  xMeasure,
  setXMeasure,
  xMeasureCol,
  setXMeasureCol,
  yMeasure,
  setYMeasure,
  yMeasureCol,
  setYMeasureCol,
  innerRadius,
  setInnerRadius,
  startAngle,
  setStartAngle,
  curveType,
  setCurveType,
  strokeWidth,
  setStrokeWidth,
  strokeStyle,
  setStrokeStyle,
  barSize,
  setBarSize,
  sortBy,
  setSortBy,
  topNEnabled,
  setTopNEnabled,
  topNCount,
  setTopNCount,
  groupOthers,
  setGroupOthers,
  groupByString,
  setGroupByString,
  categoryFilter,
  setCategoryFilter,
  allCategories,
  categorySearch,
  setCategorySearch,
  onCategoryToggle,
  onSelectAllCategories,
  onClearAllCategories,
  seriesCategories,
  seriesFilter,
  seriesSearch,
  setSeriesSearch,
  onSeriesToggle,
  onSelectAllSeries,
  onClearAllSeries,
  seriesGroupByString,
  setSeriesGroupByString,
  onSeriesChange,
  xAxisMajor,
  setXAxisMajor,
  fillMode,
  setFillMode,
  kpiCountMode,
  setKpiCountMode,
  kpiCategories
}) => {
  const supports = getChartSupports(chartType);
  const showStackBy = supports.stackBy;
  const showMeasure = supports.measure;
  const showMultiSeries = supports.multiSeries;
  const showBubble = supports.bubble;
  const showScatterXY = supports.scatterXY;
  const showPie = isPieChart(chartType);
  const showLine = isLineChart(chartType);
  const showArea = isAreaChart(chartType);
  const canShowCategoryFilter =
    supports.categoryFilter &&
    chartType !== 'table' &&
    chartType !== 'kpi' &&
    allCategories.length > 0;
  const dimensionIsText = dimension ? columnProfiles[dimension]?.type === 'text' : false;
  const seriesIsText = stackBy ? columnProfiles[stackBy]?.type === 'text' : false;
  const showGroupByStringInSetup = supports.dimension && !canShowCategoryFilter && dimensionIsText;
  const canShowSeriesFilter =
    supports.stackBy &&
    !!stackBy &&
    seriesCategories.length > 0;
  const showBarSizeControl = useMemo(() => {
    const BAR_TYPES = new Set<ChartType>([
      'column',
      'stacked-column',
      '100-stacked-column',
      'bar',
      'stacked-bar',
      '100-stacked-bar'
    ]);
    return BAR_TYPES.has(chartType) || chartType === 'combo';
  }, [chartType]);

  const filteredCategories = allCategories.filter(cat =>
    cat.toLowerCase().includes(categorySearch.toLowerCase())
  );
  const constraintMap = useMemo(() => {
    const map: Partial<Record<ChartFieldKey, FieldConstraint>> = {};
    fieldConstraints.forEach((constraint) => {
      map[constraint.key] = constraint;
    });
    return map;
  }, [fieldConstraints]);

  const formatOptionLabel = (col: string) => {
    const profile = columnProfiles[col];
    const typeLabel = describeColumnType(profile?.type || 'text');
    return `[${typeLabel}] ${col}`;
  };

  const renderColumnSelect = (
    key: ChartFieldKey,
    value: string,
    setter: (val: string) => void,
    fallbackLabel: string,
    allowEmpty = false
  ) => {
    const meta = constraintMap[key];
    const error = fieldErrors[key];
    const label = meta?.label || fallbackLabel;
    const helper = meta?.helper;
    const required = meta?.required && !allowEmpty;
    const emptyLabel = allowEmpty ? 'None' : 'Select...';

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {meta?.required && <span className="ml-1 text-red-500">*</span>}
        </label>
        <select
          value={value}
          onChange={(e) => setter(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        >
          <option value="">{emptyLabel}</option>
          {availableColumns.map(col => (
            <option key={col} value={col}>
              {formatOptionLabel(col)}
            </option>
          ))}
        </select>
        {(helper || value) && (
          <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
            <span>{helper}</span>
            {value && (
              <span className="text-gray-600 font-semibold">
                {describeColumnType(columnProfiles[value]?.type || 'text')}
              </span>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  };

  const showMajorControl = useMemo(() => {
    if (!(showLine || showArea)) return false;
    if (!dimension) return false;
    const dtype = columnProfiles[dimension]?.type;
    return dtype === 'date' || dtype === 'number';
  }, [showLine, showArea, dimension, columnProfiles]);

  const kpiColumnOptions = useMemo(() => {
    if (chartType !== 'kpi') return [];
    if (measure === 'sum' || measure === 'avg') {
      return availableColumns.filter((col) => columnProfiles[col]?.type === 'number');
    }
    return availableColumns;
  }, [chartType, measure, availableColumns, columnProfiles]);

  const filteredKpiCategories = useMemo(() => {
    return kpiCategories.filter((cat) => cat.toLowerCase().includes(categorySearch.toLowerCase()));
  }, [kpiCategories, categorySearch]);

  return (
    <div className="space-y-4">
      {/* ========================================
          KPI (Number)
          ======================================== */}
      {chartType === 'kpi' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Measure</label>
            <select
              value={measure}
              onChange={(e) => {
                const next = e.target.value as AggregateMethod;
                setMeasure(next);
                if ((next === 'sum' || next === 'avg') && measureCol && columnProfiles[measureCol]?.type !== 'number') {
                  setMeasureCol('');
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Column</label>
            <select
              value={measureCol}
              onChange={(e) => setMeasureCol(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="">Select...</option>
              {kpiColumnOptions.map((col) => (
                <option key={col} value={col}>
                  {formatOptionLabel(col)}
                </option>
              ))}
            </select>
            {fieldErrors.measureCol && <p className="text-xs text-red-500 mt-1">{fieldErrors.measureCol}</p>}
          </div>

          {measure === 'count' && measureCol && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Mode</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="kpi-count-mode"
                    checked={kpiCountMode === 'row'}
                    onChange={() => setKpiCountMode('row')}
                  />
                  Row
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="kpi-count-mode"
                    checked={kpiCountMode === 'group'}
                    onChange={() => setKpiCountMode('group')}
                  />
                  Group
                </label>
              </div>
            </div>
          )}

          {measure === 'count' && measureCol && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={groupByString}
                  onChange={(e) => setGroupByString(e.target.checked)}
                  className="rounded"
                />
                By String
              </label>
            </div>
          )}

          {measure === 'count' && measureCol && kpiCountMode === 'group' && kpiCategories.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Categories ({kpiCategories.length - categoryFilter.length} of {kpiCategories.length} visible)
                </label>
                <div className="flex gap-2">
                  <button onClick={onClearAllCategories} className="text-xs text-blue-600 hover:text-blue-800">
                    Show All
                  </button>
                  <button onClick={onSelectAllCategories} className="text-xs text-gray-600 hover:text-gray-800">
                    Hide All
                  </button>
                </div>
              </div>

              {kpiCategories.length > 5 && (
                <div className="mb-2">
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Search categories..."
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                </div>
              )}

              <div className="border border-gray-200 rounded p-3 max-h-48 overflow-y-auto bg-gray-50">
                {filteredKpiCategories.map((cat, idx) => (
                  <label
                    key={idx}
                    className="flex items-center py-1.5 px-2 hover:bg-gray-100 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!categoryFilter.includes(cat)}
                      onChange={() => onCategoryToggle(cat)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-900">{cat}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {categoryFilter.length === 0 ? 'All categories visible' : `${categoryFilter.length} hidden`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ========================================
          BUBBLE / SCATTER - Special Dimensions
          ======================================== */}
      {showBubble && !showScatterXY && (
        <>
          {renderColumnSelect('xDimension', xDimension, setXDimension, 'X-Axis Dimension')}

          {renderColumnSelect('yDimension', yDimension, setYDimension, 'Y-Axis Dimension')}

          {chartType === 'bubble' && (
            <>
              {renderColumnSelect('sizeDimension', sizeDimension, setSizeDimension, 'Bubble Size')}
            </>
          )}

          {renderColumnSelect('colorBy', colorBy, setColorBy, 'Color By (Optional)', true)}
        </>
      )}

      {/* ========================================
          SCATTER XY - Dual Aggregation Config
          ======================================== */}
      {showScatterXY && (
        <>
          {renderColumnSelect('dimension', dimension, setDimension, 'Group By (Color)')}

          <div className="space-y-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
            <label className="block text-sm font-medium text-gray-700">X-Axis Value</label>
            <div className="space-y-2">
              <select
                value={xMeasure}
                onChange={(e) => setXMeasure(e.target.value as AggregateMethod)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="count">Count (จำนวนแถว)</option>
                <option value="sum">Sum (รวมค่า)</option>
                <option value="avg">Average (เฉลี่ย)</option>
              </select>
              {(xMeasure === 'sum' || xMeasure === 'avg') && (
                renderColumnSelect('xMeasureCol', xMeasureCol, setXMeasureCol, 'X Value Column')
              )}
            </div>
          </div>

          <div className="space-y-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
            <label className="block text-sm font-medium text-gray-700">Y-Axis Value</label>
            <div className="space-y-2">
              <select
                value={yMeasure}
                onChange={(e) => setYMeasure(e.target.value as AggregateMethod)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="count">Count (จำนวนแถว)</option>
                <option value="sum">Sum (รวมค่า)</option>
                <option value="avg">Average (เฉลี่ย)</option>
              </select>
              {(yMeasure === 'sum' || yMeasure === 'avg') && (
                renderColumnSelect('yMeasureCol', yMeasureCol, setYMeasureCol, 'Y Value Column')
              )}
            </div>
          </div>

          {chartType === 'bubble' && (
            <div className="pt-2">
              {renderColumnSelect('sizeDimension', sizeDimension, setSizeDimension, 'Bubble Size')}
            </div>
          )}
        </>
      )}

      {/* ========================================
          STANDARD DIMENSION (for non-bubble charts)
          ======================================== */}
      {!showBubble && !showScatterXY && !showPie && chartType !== 'kpi' && chartType !== 'table' && supports.dimension && (
        <div className="space-y-2">
          {renderColumnSelect(
            'dimension',
            dimension,
            setDimension,
            chartType === 'multi-line'
              ? 'Date'
              : chartType === 'compare-column'
                ? 'Category'
              : `Dimension (${getDefaultOrientation(chartType) === 'vertical' ? 'X' : 'Y'}-Axis)`
          )}
          {showGroupByStringInSetup && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={groupByString}
                onChange={(e) => setGroupByString(e.target.checked)}
                className="rounded"
              />
              By String
            </label>
          )}
        </div>
      )}

      {/* ========================================
          PIE CHART - Category
          ======================================== */}
      {showPie && (
        <div className="space-y-2">
          {renderColumnSelect('dimension', dimension, setDimension, 'Category')}
          {showGroupByStringInSetup && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={groupByString}
                onChange={(e) => setGroupByString(e.target.checked)}
                className="rounded"
              />
              By String
            </label>
          )}
        </div>
      )}

      {/* ========================================
          STACKED CHARTS - Stack By
          ======================================== */}
      {showStackBy && (
        <div className="space-y-2">
          {renderColumnSelect(
            'stackBy',
            stackBy,
            setStackBy,
            chartType === 'multi-line' || chartType === 'compare-column'
              ? 'Series By'
              : 'Stack By (Breakdown Dimension)'
          )}
        </div>
      )}

      {/* ========================================
          MULTI-SERIES (Combo Chart)
          ======================================== */}
      {showMultiSeries && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              Series ({series.length})
            </label>
            <button
              onClick={onAddSeries}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
            >
              <Plus className="w-3 h-3" />
              Add Series
            </button>
          </div>

          {series.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Measure</th>
                    <th className="px-3 py-2 text-left">Column</th>
                    <th className="px-3 py-2 text-left">Axis</th>
                    <th className="px-3 py-2 text-left">Color</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {series.map((s) => {
                    const needsColumn = s.measure === 'sum' || s.measure === 'avg';
                    return (
                      <tr key={s.id} className="align-middle">
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={s.label || ''}
                            onChange={(e) => onSeriesChange(s.id, { label: e.target.value })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={s.type}
                            onChange={(e) => onSeriesChange(s.id, { type: e.target.value as 'bar' | 'line' | 'area' })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          >
                            <option value="bar">Bar</option>
                            <option value="line">Line</option>
                            <option value="area">Area</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={s.measure}
                            onChange={(e) => {
                              const next = e.target.value as AggregateMethod;
                              onSeriesChange(s.id, {
                                measure: next,
                                measureCol: next === 'count' ? undefined : s.measureCol
                              });
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          >
                            <option value="count">Count</option>
                            <option value="sum">Sum</option>
                            <option value="avg">Average</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {needsColumn ? (
                            <select
                              value={s.measureCol || ''}
                              onChange={(e) =>
                                onSeriesChange(s.id, { measureCol: e.target.value || undefined })
                              }
                              className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                            >
                              <option value="">Select column…</option>
                              {availableColumns.map((col) => (
                                <option key={col} value={col}>
                                  {col}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[11px] text-gray-400">Not required</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={s.yAxis}
                            onChange={(e) =>
                              onSeriesChange(s.id, { yAxis: e.target.value as 'left' | 'right' })
                            }
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={s.color}
                              onChange={(e) => onSeriesChange(s.id, { color: e.target.value })}
                              className="h-7 w-7 rounded border border-gray-200"
                            />
                            <input
                              type="text"
                              value={s.color}
                              onChange={(e) => onSeriesChange(s.id, { color: e.target.value })}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-[11px] font-mono"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => onEditSeries(s)}
                              className="p-1 hover:bg-gray-100 rounded"
                            >
                              <EditIcon className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                              onClick={() => onDeleteSeries(s.id)}
                              className="p-1 hover:bg-red-100 rounded"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-gray-500 border border-dashed border-gray-300 rounded">
              No series added. Click "Add Series" to start.
            </div>
          )}

          {series.length > 0 && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Sort bars based on
              </label>
              <select
                value={sortSeriesId || series[0].id}
                onChange={(e) => setSortSeriesId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                {series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || s.id}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                This series controls the category order when sorting (High → Low).
              </p>
            </div>
          )}
        </div>
      )}

      {/* ========================================
          SINGLE MEASURE (for non-combo, non-bubble)
          ======================================== */}
      {showMeasure && !showMultiSeries && !showBubble && chartType !== 'kpi' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Measure</label>
            <select
              value={measure}
              onChange={(e) => setMeasure(e.target.value as AggregateMethod)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
            </select>
          </div>

          {(measure === 'sum' || measure === 'avg') && renderColumnSelect('measureCol', measureCol, setMeasureCol, 'Value Column')}
        </div>
      )}

      {/* ========================================
          PIE/DONUT SPECIFIC
          ======================================== */}
      {chartType === 'donut' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Inner Radius: {innerRadius}%
          </label>
          <input
            type="range"
            min="0"
            max="80"
            value={innerRadius}
            onChange={(e) => setInnerRadius(parseInt(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">
            Controls the donut hole size (0% = pie chart, 80% = thin ring)
          </p>
        </div>
      )}

      {showPie && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Start Angle: {startAngle}°
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={startAngle}
            onChange={(e) => setStartAngle(parseInt(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {/* ========================================
          LINE SPECIFIC
          ======================================== */}
      {(showLine || showArea) && (
        <>
          {/* Smooth Line Checkbox - Easy toggle */}
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={curveType === 'monotone'}
                onChange={(e) => setCurveType(e.target.checked ? 'monotone' : 'linear')}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Smooth Line</span>
                <p className="text-xs text-gray-500">Draw curved lines instead of straight lines</p>
              </div>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Stroke Width: {strokeWidth}px
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Stroke Style</label>
            <select
              value={strokeStyle}
              onChange={(e) => setStrokeStyle(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>

          {!supports.stackBy && !supports.multiSeries && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Line Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor || '#3B82F6'}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-12 rounded border border-gray-200 bg-white"
                />
                <input
                  type="text"
                  value={primaryColor || ''}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
            </div>
          )}

          {showMajorControl && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Major (Group Interval)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={xAxisMajor}
                  onChange={(e) => setXAxisMajor(parseInt(e.target.value || '0', 10) || 0)}
                  className="w-28 px-3 py-2 border border-gray-300 rounded text-sm bg-white"
                />
              </div>
            </div>
          )}

          {showMajorControl && !['stacked-area', '100-stacked-area'].includes(chartType) && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fill Mode
              </label>
              <select
                value={fillMode}
                onChange={(e) => setFillMode(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="gaps">Gaps</option>
                <option value="zero">Zero</option>
                <option value="connect">Connect</option>
              </select>
            </div>
          )}
        </>
      )}

      {/* ========================================
          SORT OPTIONS (all charts except Table)
          ======================================== */}
      {supports.sort && chartType !== 'table' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOrder)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="value-desc">Value (High to Low)</option>
              <option value="value-asc">Value (Low to High)</option>
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="date-desc">Date (Newest to Oldest)</option>
              <option value="date-asc">Date (Oldest to Newest)</option>
            </select>
          </div>
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
            <label className="flex items-center text-xs text-gray-700 gap-2">
              <input
                type="checkbox"
                checked={topNEnabled}
                onChange={(e) => setTopNEnabled(e.target.checked)}
                className="rounded"
              />
              Limit to Top N categories
            </label>
            {topNEnabled && (
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={topNCount}
                    onChange={(e) => {
                      const next = parseInt(e.target.value, 10);
                      setTopNCount(Number.isNaN(next) ? 1 : Math.max(1, next));
                    }}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <span className="text-xs text-gray-500">categories</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={groupOthers}
                    onChange={(e) => setGroupOthers(e.target.checked)}
                  />
                  Combine remaining categories as &ldquo;Others&rdquo;
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================
          CATEGORY FILTER (for dimension-based charts)
          ======================================== */}
      {canShowCategoryFilter && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Categories ({allCategories.length - categoryFilter.length} of {allCategories.length} visible)
            </label>
            <div className="flex items-center gap-3">
              {dimensionIsText && (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={groupByString}
                    onChange={(e) => setGroupByString(e.target.checked)}
                    className="rounded"
                  />
                  By String
                </label>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClearAllCategories}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Show All
                </button>
                <button
                  onClick={onSelectAllCategories}
                  className="text-xs text-gray-600 hover:text-gray-800"
                >
                  Hide All
                </button>
              </div>
            </div>
          </div>

          {allCategories.length > 5 && (
            <div className="mb-2">
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          )}

          <div className="border border-gray-200 rounded p-3 max-h-48 overflow-y-auto bg-gray-50">
            {filteredCategories.map((cat, idx) => (
              <label
                key={idx}
                className="flex items-center py-1.5 px-2 hover:bg-gray-100 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!categoryFilter.includes(cat)}
                  onChange={() => onCategoryToggle(cat)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-900">{cat}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {categoryFilter.length === 0 ? 'All categories visible' : `${categoryFilter.length} hidden`}
          </p>
        </div>
      )}

      {/* ========================================
          SERIES FILTER (for multi-series widgets)
          ======================================== */}
      {canShowSeriesFilter && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Series ({seriesCategories.length - seriesFilter.length} of {seriesCategories.length} visible)
            </label>
            <div className="flex items-center gap-3">
              {seriesIsText && (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={seriesGroupByString}
                    onChange={(e) => setSeriesGroupByString(e.target.checked)}
                    className="rounded"
                  />
                  By String
                </label>
              )}
              <div className="flex gap-2">
                <button onClick={onClearAllSeries} className="text-xs text-blue-600 hover:text-blue-800">
                  Show All
                </button>
                <button onClick={onSelectAllSeries} className="text-xs text-gray-600 hover:text-gray-800">
                  Hide All
                </button>
              </div>
            </div>
          </div>

          {seriesCategories.length > 5 && (
            <div className="mb-2">
              <input
                type="text"
                value={seriesSearch}
                onChange={(e) => setSeriesSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          )}

          <div className="border border-gray-200 rounded p-3 max-h-48 overflow-y-auto bg-gray-50">
            {seriesCategories
              .filter((cat) => cat.toLowerCase().includes(seriesSearch.toLowerCase()))
              .map((cat, idx) => (
                <label
                  key={idx}
                  className="flex items-center py-1.5 px-2 hover:bg-gray-100 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!seriesFilter.includes(cat)}
                    onChange={() => onSeriesToggle(cat)}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-900">{cat}</span>
                </label>
              ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {seriesFilter.length === 0 ? 'All series visible' : `${seriesFilter.length} hidden`}
          </p>
        </div>
      )}
    </div>
  );
};

export default ChartConfigForm;
