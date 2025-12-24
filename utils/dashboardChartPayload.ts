import { DashboardWidget, RawRow } from '../types';
import { applyWidgetFilters, aggregateWidgetData, processMultiSeriesData } from './widgetData';
import { ChartTheme, CLASSIC_ANALYTICS_THEME } from '../constants/chartTheme';
import { getCategoryColor, getPalette, getWidgetColor } from './chartStyling';

type PptChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter' | 'combo' | 'kpi';
type SeriesVisualType = 'bar' | 'line' | 'area';
type Orientation = 'vertical' | 'horizontal';

export interface DashboardChartInsertPayload {
  chartType: PptChartType;
  data: {
    labels: string[];
    legends: string[];
    series: unknown[][];
    seriesColors?: string[];
    dataColors?: string[];
  };
  options?: {
    // Series/stack
    stack?: boolean;
    lineSmooth?: boolean;
    connectNulls?: boolean;
    lineStrokeWidth?: number;
    lineStrokeStyle?: 'solid' | 'dashed' | 'dotted';
    seriesTypes?: SeriesVisualType[];
    yAxisIndexes?: number[];
    percentStack?: boolean;
    seriesSmoothList?: boolean[];
    seriesStrokeWidths?: number[];
    seriesDataLabels?: any[];

    // Bar/column layout
    orientation?: Orientation;
    barWidth?: number;
    barCategoryGap?: string;

    // Scatter/Bubble
    pointSizes?: number[];

    // Data labels
    showDataLabels?: boolean;
    dataLabelPosition?: 'top' | 'inside' | 'outside' | 'center';
    dataLabelFontSize?: number;
    dataLabelFontWeight?: 'normal' | 'bold';
    dataLabelFontFamily?: string;
    dataLabelColor?: string;
    dataLabelValueFormat?: 'auto' | 'text' | 'number' | 'compact' | 'accounting';
    dataLabelShowCategoryName?: boolean;
    dataLabelShowPercent?: boolean;
    dataLabelPercentDecimals?: number;
    dataLabelPercentPlacement?: 'prefix' | 'suffix';

    // Axis titles + ranges
    axisTitle?: { x?: string; yLeft?: string; yRight?: string };
    axisRange?: { xMin?: number; xMax?: number; yLeftMin?: number; yLeftMax?: number; yRightMin?: number; yRightMax?: number };
    axisMajor?: number;

    // Legend
    legendEnabled?: boolean;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right';
    legendAlign?: 'left' | 'center' | 'right';
    legendFontSize?: number;
    legendFontFamily?: string;
    legendFontColor?: string;

    // Axis visibility
    axisShowX?: boolean;
    axisShowYLeft?: boolean;
    axisShowYRight?: boolean;

    // Axis styles (separate for X / Y-left / Y-right)
    axisLabelFontSizeX?: number;
    axisLabelFontFamilyX?: string;
    axisLabelColorX?: string;
    axisLabelSlantX?: 0 | 45 | 90;
    axisGridShowX?: boolean;
    axisGridColorX?: string;

    axisLabelFontSizeYLeft?: number;
    axisLabelFontFamilyYLeft?: string;
    axisLabelColorYLeft?: string;
    axisGridShowYLeft?: boolean;
    axisGridColorYLeft?: string;

    axisLabelFontSizeYRight?: number;
    axisLabelFontFamilyYRight?: string;
    axisLabelColorYRight?: string;
    axisGridShowYRight?: boolean;
    axisGridColorYRight?: string;

    // Pie/Ring
    pieInnerRadius?: number; // 0-100 (%)
    pieStartAngle?: number; // degrees

    // Combo per-series line styles
    seriesStrokeStyles?: Array<'solid' | 'dashed' | 'dotted' | undefined>;
  };
  theme: {
    colors: string[];
    textColor?: string;
    lineColor?: string;
  };
  meta: {
    widgetId: string;
    widgetType: DashboardWidget['type'];
    widgetTitle?: string;
    sourceDashboardId?: string;
  };
}

const normalizeDataLabelPosition = (
  pos?: DashboardWidget['dataLabels'] extends infer D
    ? D extends { position?: infer P } ? P : undefined
    : undefined
): 'top' | 'inside' | 'outside' | 'center' | undefined => {
  if (!pos) return undefined;
  if (pos === 'inside' || pos === 'outside' || pos === 'top' || pos === 'center') return pos;
  if (pos === 'bottom' || pos === 'end') return 'inside';
  return 'top';
};

const mapWidgetType = (widget: DashboardWidget): PptChartType | null => {
  switch (widget.type) {
    case 'column':
    case 'stacked-column':
    case '100-stacked-column':
    case 'compare-column':
      return 'column';
    case 'compare-bar':
    case 'bar':
    case 'stacked-bar':
    case '100-stacked-bar':
      return 'bar';
    case 'line':
    case 'smooth-line':
    case 'multi-line':
      return 'line';
    case 'area':
    case 'multi-area':
    case 'stacked-area':
    case '100-stacked-area':
      return 'area';
    case 'pie':
      return 'pie';
    case 'donut':
      return 'ring';
    case 'scatter':
    case 'bubble':
      return 'scatter';
    case 'combo':
      return 'combo';
    case 'kpi':
      return 'kpi';
    default:
      return null;
  }
};

const resolveBarOrientation = (widget: DashboardWidget): Orientation => {
  if (widget.barOrientation) return widget.barOrientation;
  const isBarFamily = widget.type.includes('bar') && !widget.type.includes('column');
  return isBarFamily ? 'horizontal' : 'vertical';
};

const clampBarSize = (value?: number) => {
  if (typeof value !== 'number') return undefined;
  return Math.max(4, Math.min(value, 120));
};

const toCategoryGap = (value?: number) => {
  if (typeof value !== 'number') return undefined;
  const normalized = Math.max(0, Math.min(value, 80));
  return `${normalized}%`;
};

const buildStackedSeries = (rows: any[], stackKeys: string[]) => {
  const legends = stackKeys;
  const series = stackKeys.map(key => rows.map(row => Number(row[key]) || 0));
  const labels = rows.map(row => String(row.name ?? row.label ?? ''));
  return { labels, legends, series };
};

const buildMultiValueSeries = (rows: any[], seriesKeys: string[]) => {
  const legends = seriesKeys;
  const series = seriesKeys.map((key) =>
    rows.map((row) => (row[key] === undefined ? null : row[key]))
  );
  const labels = rows.map((row) => String(row.name ?? row.label ?? ''));
  return { labels, legends, series };
};

const buildSingleSeries = (rows: any[], title?: string) => {
  const labels = rows.map(row => String(row.name ?? row.label ?? ''));
  const legends = [title || 'Values'];
  const series = [rows.map(row => Number(row.value) || 0)];
  return { labels, legends, series };
};

const buildScatterSeries = (rows: any[], widget: DashboardWidget, theme: ChartTheme) => {
  const labels = rows.map(row => row.name || '');
  const legends = ['X', 'Y'];
  const xSeries = rows.map(row => Number(row.x) || 0);
  const ySeries = rows.map(row => Number(row.y) || 0);
  const pointSizes = rows.map(row => Number(row.size) || 10);
  // Generate colors for each point based on categoryConfig or palette
  const palette = getPalette(widget, theme);
  const dataColors = rows.map((row, idx) =>
    getCategoryColor(widget, String(row.name || idx), idx, theme)
  );
  return { labels, legends, series: [xSeries, ySeries], pointSizes, dataColors };
};

const buildComboSeries = (widget: DashboardWidget, rows: any[], theme: ChartTheme) => {
  if (!widget.series || widget.series.length === 0) return null;
  const labels = rows.map(row => String(row.name ?? row[widget.dimension!] ?? ''));
  const legends = widget.series.map(series => series.label || series.id);
  const palette = getPalette(widget, theme);
  const colors = widget.series.map((series, idx) => series.color || palette[idx % palette.length]);
  const seriesData = widget.series.map(series => rows.map(row => Number(row[series.id]) || 0));
  const seriesTypes = widget.series.map(series => series.type) as SeriesVisualType[];
  // Build yAxisIndexes for dual axis support (0 = left, 1 = right)
  const yAxisIndexes = widget.series.map(series => series.yAxis === 'right' ? 1 : 0);
  // Per-series line settings
  const seriesSmoothList = widget.series.map(series => series.smooth ?? false);
  const seriesStrokeWidths = widget.series.map(series => series.strokeWidth ?? 2);
  const seriesStrokeStyles = widget.series.map(series => series.strokeStyle);
  // Per-series data labels
  const seriesDataLabels = widget.series.map(series => series.dataLabels);
  return { labels, legends, series: seriesData, colors, seriesTypes, yAxisIndexes, seriesSmoothList, seriesStrokeWidths, seriesStrokeStyles, seriesDataLabels };
};

export const buildDashboardChartPayload = (
  widget: DashboardWidget,
  rows: RawRow[],
  opts?: {
    theme?: ChartTheme;
    sourceDashboardId?: string;
  }
): DashboardChartInsertPayload | null => {
  const chartType = mapWidgetType(widget);
  if (!chartType) return null;

  const theme = opts?.theme ?? CLASSIC_ANALYTICS_THEME;
  const palette = getPalette(widget, theme);
  const filteredRows = applyWidgetFilters(rows, widget.filters);
  if (!filteredRows.length) return null;

  if (chartType === 'combo') {
    // If no series defined yet, fallback to single-series bar chart (like other charts)
    const hasSeries = widget.series && widget.series.length > 0 && widget.dimension;
    if (!hasSeries) {
      // Fallback: treat as column chart with default aggregation
      const aggregated = aggregateWidgetData(widget, filteredRows);
      if (!aggregated.data || aggregated.data.length === 0) return null;
      const single = buildSingleSeries(aggregated.data, widget.title || widget.chartTitle);
      const dataColors = aggregated.data.map((row: any, idx: number) =>
        getCategoryColor(widget, String(row.name ?? row.label ?? idx), idx, theme)
      );
      return {
        chartType: 'combo',
        data: {
          labels: single.labels,
          legends: single.legends,
          series: single.series,
          dataColors,
        },
        options: {
          seriesTypes: ['bar'],
          legendEnabled: widget.legend?.enabled ?? widget.showLegend !== false,
          legendPosition: widget.legend?.position,
        },
        theme: {
          colors: palette,
          textColor: theme.typography.axisColor,
          lineColor: theme.background.grid
        },
        meta: {
          widgetId: widget.id,
          widgetTitle: widget.title,
          widgetType: widget.type,
          sourceDashboardId: opts?.sourceDashboardId
        }
      };
    }

    const multiSeriesData = processMultiSeriesData(widget, filteredRows);
    if (!multiSeriesData.length) return null;
    const combo = buildComboSeries(widget, multiSeriesData, theme);
    if (!combo) return null;
    const barSeriesCount = (widget.series || []).filter(s => s.type === 'bar').length;
    const comboCategoryColors =
      barSeriesCount === 1
        ? combo.labels.map((label, idx) => getCategoryColor(widget, String(label ?? idx), idx, theme))
        : undefined;

    const dataLabelPosition = normalizeDataLabelPosition(widget.dataLabels?.position as any);
    const percentStack = widget.barMode === 'percent';
    const globalGridEnabled = widget.showGrid !== false;

    const axisTitle = {
      x: widget.xAxis?.title,
      yLeft: widget.leftYAxis?.title,
      yRight: widget.rightYAxis?.title,
    };
    const axisRange = {
      xMin: typeof widget.xAxis?.min === 'number' ? widget.xAxis.min : undefined,
      xMax: typeof widget.xAxis?.max === 'number' ? widget.xAxis.max : undefined,
      yLeftMin: typeof widget.leftYAxis?.min === 'number' ? widget.leftYAxis.min : undefined,
      yLeftMax: typeof widget.leftYAxis?.max === 'number' ? widget.leftYAxis.max : undefined,
      yRightMin: typeof widget.rightYAxis?.min === 'number' ? widget.rightYAxis.min : undefined,
      yRightMax: typeof widget.rightYAxis?.max === 'number' ? widget.rightYAxis.max : undefined,
    };

    return {
      chartType: 'combo',
      data: {
        labels: combo.labels,
        legends: combo.legends,
        series: combo.series,
        seriesColors: combo.colors,
        dataColors: comboCategoryColors,
      },
      options: {
        seriesTypes: combo.seriesTypes,
        lineSmooth: widget.curveType === 'monotone' || widget.type === 'smooth-line',
        lineStrokeWidth: widget.strokeWidth,
        lineStrokeStyle: widget.strokeStyle,
        stack: widget.barMode === 'stacked' || widget.barMode === 'percent',
        percentStack,
        yAxisIndexes: combo.yAxisIndexes,
        barWidth: clampBarSize(widget.barSize),
        barCategoryGap: toCategoryGap(widget.categoryGap),
        // Per-series settings
        seriesSmoothList: combo.seriesSmoothList,
        seriesStrokeWidths: combo.seriesStrokeWidths,
        seriesStrokeStyles: combo.seriesStrokeStyles,
        seriesDataLabels: combo.seriesDataLabels,

        showDataLabels: widget.dataLabels?.enabled,
        dataLabelPosition,
        dataLabelFontSize: widget.dataLabels?.fontSize,
        dataLabelFontWeight: widget.dataLabels?.fontWeight,
        dataLabelFontFamily: widget.dataLabels?.fontFamily,
        dataLabelColor: widget.dataLabels?.color,
        dataLabelValueFormat: widget.dataLabels?.valueFormat,
        dataLabelShowCategoryName: widget.dataLabels?.showCategoryName,
        dataLabelShowPercent: widget.dataLabels?.showPercent,
        dataLabelPercentDecimals: widget.dataLabels?.percentDecimals,
        dataLabelPercentPlacement: widget.dataLabels?.percentPlacement,

        axisTitle,
        axisRange,
        axisMajor: widget.xAxis?.major,

        legendEnabled: widget.legend?.enabled ?? widget.showLegend !== false,
        legendPosition: widget.legend?.position,
        legendAlign: widget.legend?.alignment,
        legendFontSize: widget.legend?.fontSize,
        legendFontFamily: widget.legend?.fontFamily,
        legendFontColor: widget.legend?.fontColor,

        axisShowX: widget.xAxis?.show !== false,
        axisShowYLeft: widget.leftYAxis?.show !== false,
        axisShowYRight: widget.rightYAxis?.show !== false,

        axisLabelFontSizeX: widget.xAxis?.fontSize ?? 11,
        axisLabelFontFamilyX: widget.xAxis?.fontFamily,
        axisLabelColorX: widget.xAxis?.fontColor ?? theme.typography.axisColor,
        axisLabelSlantX: widget.xAxis?.slant ?? 0,
        axisGridShowX: globalGridEnabled && widget.xAxis?.showGridlines !== false,
        axisGridColorX: widget.xAxis?.gridColor ?? theme.background.grid,

        axisLabelFontSizeYLeft: widget.leftYAxis?.fontSize ?? 11,
        axisLabelFontFamilyYLeft: widget.leftYAxis?.fontFamily,
        axisLabelColorYLeft: widget.leftYAxis?.fontColor ?? theme.typography.axisColor,
        axisGridShowYLeft: globalGridEnabled && widget.leftYAxis?.showGridlines !== false,
        axisGridColorYLeft: widget.leftYAxis?.gridColor ?? theme.background.grid,

        axisLabelFontSizeYRight: widget.rightYAxis?.fontSize ?? 11,
        axisLabelFontFamilyYRight: widget.rightYAxis?.fontFamily,
        axisLabelColorYRight: widget.rightYAxis?.fontColor ?? theme.typography.axisColor,
        axisGridShowYRight: globalGridEnabled && widget.rightYAxis?.showGridlines !== false,
        axisGridColorYRight: widget.rightYAxis?.gridColor ?? theme.background.grid,

        pieInnerRadius: widget.innerRadius,
        pieStartAngle: widget.startAngle,
      },
      theme: {
        colors: combo.colors || getPalette(widget, theme),
        textColor: theme.typography.axisColor,
        lineColor: theme.background.grid
      },
      meta: {
        widgetId: widget.id,
        widgetTitle: widget.title,
        widgetType: widget.type,
        sourceDashboardId: opts?.sourceDashboardId
      }
    };
  }

  const aggregated = aggregateWidgetData(widget, filteredRows);
  if (!aggregated.data || aggregated.data.length === 0) return null;

  let labels: string[] = [];
  let legends: string[] = [];
  let series: unknown[][] = [];
  let pointSizes: number[] | undefined;
  let seriesColors: string[] | undefined;
  let dataColors: string[] | undefined;

  if (chartType === 'scatter') {
    const scatter = buildScatterSeries(aggregated.data, widget, theme);
    labels = scatter.labels;
    legends = scatter.legends;
    series = scatter.series;
    pointSizes = scatter.pointSizes;
    dataColors = scatter.dataColors;
  } else if (aggregated.stackKeys && aggregated.stackKeys.length) {
    const result =
      widget.type === 'multi-line' || widget.type === 'multi-area'
        ? buildMultiValueSeries(aggregated.data, aggregated.stackKeys)
        : buildStackedSeries(aggregated.data, aggregated.stackKeys);
    labels = result.labels;
    legends = result.legends;
    series = result.series;
  } else {
    const single = buildSingleSeries(aggregated.data, widget.title || widget.chartTitle);
    labels = single.labels;
    legends = single.legends;
    series = single.series;
  }

  if (aggregated.stackKeys && aggregated.stackKeys.length) {
    seriesColors = aggregated.stackKeys.map((key, idx) =>
      getWidgetColor(widget, key, idx, theme)
    );
  } else if (widget.series && widget.series.length > 0) {
    const palette = getPalette(widget, theme);
    seriesColors = widget.series.map((seriesCfg, idx) => seriesCfg.color || palette[idx % palette.length]);
  } else if ((chartType === 'line' || chartType === 'area') && widget.color) {
    seriesColors = [widget.color];
  } else if (chartType !== 'pie' && chartType !== 'ring') {
    dataColors = aggregated.data.map((row: any, idx: number) =>
      getCategoryColor(widget, String(row.name ?? row.label ?? idx), idx, theme)
    );
  } else {
    dataColors = aggregated.data.map((row: any, idx: number) =>
      getCategoryColor(widget, String(row.name ?? row.label ?? idx), idx, theme)
    );
  }

  if ((chartType === 'line' || chartType === 'area') && !seriesColors && widget.color) {
    seriesColors = [widget.color];
  }

  const orientation =
    chartType === 'bar' || chartType === 'column' ? resolveBarOrientation(widget) : undefined;
  const barWidth = clampBarSize(widget.barSize);
  const barCategoryGap = toCategoryGap(widget.categoryGap);

  const percentStack =
    ['100-stacked-column', '100-stacked-bar', '100-stacked-area'].includes(widget.type) ||
    widget.barMode === 'percent';

  const dataLabelPosition = normalizeDataLabelPosition(widget.dataLabels?.position as any);

  const axisTitle = {
    x: widget.xAxis?.title,
    yLeft: widget.leftYAxis?.title,
  };
  const axisRange = {
    xMin: typeof widget.xAxis?.min === 'number' ? widget.xAxis.min : undefined,
    xMax: typeof widget.xAxis?.max === 'number' ? widget.xAxis.max : undefined,
    yLeftMin: typeof widget.leftYAxis?.min === 'number' ? widget.leftYAxis.min : undefined,
    yLeftMax: typeof widget.leftYAxis?.max === 'number' ? widget.leftYAxis.max : undefined,
  };

  const globalGridEnabled = widget.showGrid !== false;

  return {
    chartType,
    data: { labels, legends, series, seriesColors, dataColors },
    options: {
      stack: aggregated.isStack,
      lineSmooth: widget.type === 'smooth-line' || widget.curveType === 'monotone',
      connectNulls: widget.fillMode === 'connect',
      pointSizes,
      orientation,
      barWidth,
      barCategoryGap,

      showDataLabels: widget.dataLabels?.enabled,
      dataLabelPosition,
      dataLabelFontSize: widget.dataLabels?.fontSize,
      dataLabelFontWeight: widget.dataLabels?.fontWeight,
      dataLabelFontFamily: widget.dataLabels?.fontFamily,
      dataLabelColor: widget.dataLabels?.color,
      dataLabelValueFormat: widget.dataLabels?.valueFormat,
      dataLabelShowCategoryName: widget.dataLabels?.showCategoryName,
      dataLabelShowPercent: widget.dataLabels?.showPercent,
      dataLabelPercentDecimals: widget.dataLabels?.percentDecimals,
      dataLabelPercentPlacement: widget.dataLabels?.percentPlacement,

      percentStack,
      axisTitle,
      axisRange,
      axisMajor: widget.xAxis?.major,
      lineStrokeWidth: widget.strokeWidth,
      lineStrokeStyle: widget.strokeStyle,

      legendEnabled: widget.legend?.enabled ?? widget.showLegend !== false,
      legendPosition: widget.legend?.position,
      legendAlign: widget.legend?.alignment,
      legendFontSize: widget.legend?.fontSize,
      legendFontFamily: widget.legend?.fontFamily,
      legendFontColor: widget.legend?.fontColor,

      axisShowX: widget.xAxis?.show !== false,
      axisShowYLeft: widget.leftYAxis?.show !== false,
      axisShowYRight: widget.rightYAxis?.show !== false,

      axisLabelFontSizeX: widget.xAxis?.fontSize ?? 11,
      axisLabelFontFamilyX: widget.xAxis?.fontFamily,
      axisLabelColorX: widget.xAxis?.fontColor ?? theme.typography.axisColor,
      axisLabelSlantX: widget.xAxis?.slant ?? 0,
      axisGridShowX: globalGridEnabled && widget.xAxis?.showGridlines !== false,
      axisGridColorX: widget.xAxis?.gridColor ?? theme.background.grid,

      axisLabelFontSizeYLeft: widget.leftYAxis?.fontSize ?? 11,
      axisLabelFontFamilyYLeft: widget.leftYAxis?.fontFamily,
      axisLabelColorYLeft: widget.leftYAxis?.fontColor ?? theme.typography.axisColor,
      axisGridShowYLeft: globalGridEnabled && widget.leftYAxis?.showGridlines !== false,
      axisGridColorYLeft: widget.leftYAxis?.gridColor ?? theme.background.grid,

      axisLabelFontSizeYRight: widget.rightYAxis?.fontSize ?? 11,
      axisLabelFontFamilyYRight: widget.rightYAxis?.fontFamily,
      axisLabelColorYRight: widget.rightYAxis?.fontColor ?? theme.typography.axisColor,
      axisGridShowYRight: globalGridEnabled && widget.rightYAxis?.showGridlines !== false,
      axisGridColorYRight: widget.rightYAxis?.gridColor ?? theme.background.grid,

      pieInnerRadius: widget.innerRadius,
      pieStartAngle: widget.startAngle,
    },
    theme: {
      colors: palette,
      textColor: theme.typography.axisColor,
      lineColor: theme.background.grid
    },
    meta: {
      widgetId: widget.id,
      widgetType: widget.type,
      widgetTitle: widget.title,
      sourceDashboardId: opts?.sourceDashboardId
    }
  };
};
