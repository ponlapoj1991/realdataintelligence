import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { DashboardWidget, RawRow } from '../types';
import { ChartTheme, CLASSIC_ANALYTICS_THEME } from '../constants/chartTheme';
import { buildMagicEchartsOption } from '../utils/magicOptionBuilder';
import { applyWidgetFilters } from '../utils/widgetData';
import { buildMagicChartPayload, MagicChartPayload } from '../utils/magicChartPayload';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  SVGRenderer,
]);

interface MagicWidgetRendererProps {
  widget: DashboardWidget;
  data: RawRow[];
  filters?: any[];
  theme?: ChartTheme;
  onValueClick?: (value: string, widget: DashboardWidget) => void;
  /** Disable animation during editing to prevent distracting re-renders */
  isEditing?: boolean;
}

const buildOption = (payload: MagicChartPayload | null) => {
  if (!payload) return null;
  const { type, data, options, textColor, lineColor, themeColors } = payload;
  const axisRange = options?.axisRange || {};
  const xMin = axisRange?.xMin;
  const xMax = axisRange?.xMax;
  const yLeftMin = axisRange?.yLeftMin;
  const yLeftMax = axisRange?.yLeftMax;
  const yRightMin = axisRange?.yRightMin;
  const yRightMax = axisRange?.yRightMax;

  const baseAxis = {
    axisLine: textColor ? { lineStyle: { color: textColor } } : undefined,
    axisLabel: textColor ? { color: textColor } : undefined,
    splitLine: lineColor ? { lineStyle: { color: lineColor } } : undefined,
  };

  const legendPosition = options?.legendPosition || 'bottom';
  const legend =
    data.legends.length > 1
      ? {
          textStyle: textColor ? { color: textColor } : undefined,
          orient: legendPosition === 'left' || legendPosition === 'right' ? 'vertical' : 'horizontal',
          top: legendPosition === 'top' ? 10 : legendPosition === 'left' || legendPosition === 'right' ? 'middle' : undefined,
          bottom: legendPosition === 'bottom' ? 10 : undefined,
          left: legendPosition === 'left' ? 10 : undefined,
          right: legendPosition === 'right' ? 10 : undefined,
        }
      : undefined;

  if (type === 'bar' || type === 'column') {
    const isVertical = (options?.orientation || (type === 'column' ? 'vertical' : 'horizontal')) === 'vertical';
    const valueAxisBase = {
      ...baseAxis,
      name: isVertical ? options?.axisTitle?.yLeft : options?.axisTitle?.x,
      min: options?.percentStack ? 0 : undefined,
      max: options?.percentStack ? 1 : undefined,
    };
    const resolvedColor = data.seriesColors?.length
      ? data.seriesColors
      : data.dataColors?.length
        ? data.dataColors
        : themeColors;
    const usePointColors = data.dataColors?.length && data.series.length === 1 && !options?.stack && !options?.percentStack;
    return {
      color: resolvedColor,
      legend,
      xAxis: isVertical
        ? { type: 'category', data: data.labels, ...baseAxis, name: options?.axisTitle?.x }
        : {
            type: 'value',
            ...valueAxisBase,
            min: xMin ?? valueAxisBase.min,
            max: xMax ?? valueAxisBase.max,
          },
      yAxis: isVertical
        ? {
            type: 'value',
            ...valueAxisBase,
            min: yLeftMin ?? valueAxisBase.min,
            max: yLeftMax ?? valueAxisBase.max,
          }
        : { type: 'category', data: data.labels, ...baseAxis, name: options?.axisTitle?.yLeft },
      series: data.series.map((s, idx) => {
        const seriesData = usePointColors
          ? s.map((v, i) => ({
              value: v,
              itemStyle: data.dataColors?.[i]
                ? { color: data.dataColors[i] }
                : undefined,
            }))
          : s;
        const itemStyle = !usePointColors && data.seriesColors?.[idx] ? { color: data.seriesColors[idx] } : undefined;
        return {
          type: 'bar',
          name: data.legends[idx],
          data: seriesData,
          stack: options?.stack ? 'A' : undefined,
          barWidth: options?.barWidth,
          barCategoryGap: options?.barCategoryGap,
          itemStyle,
          label: options?.showDataLabels
            ? {
                show: true,
                position: options?.dataLabelPosition || (isVertical ? 'top' : 'right'),
              }
            : undefined,
        };
      }),
    };
  }

  if (type === 'line') {
    return {
      color: data.seriesColors?.length ? data.seriesColors : themeColors,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        ...baseAxis,
        name: options?.axisTitle?.x,
        min: xMin,
        max: xMax,
      },
      yAxis: {
        type: 'value',
        ...baseAxis,
        name: options?.axisTitle?.yLeft,
        min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
        max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
      },
      series: data.series.map((s, idx) => ({
        type: 'line',
        name: data.legends[idx],
        data: s,
        smooth: options?.lineSmooth,
        label: options?.showDataLabels
          ? {
              show: true,
              position: options?.dataLabelPosition || 'top',
            }
          : undefined,
      })),
    };
  }

  if (type === 'area') {
    return {
      color: data.seriesColors?.length ? data.seriesColors : themeColors,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        ...baseAxis,
        name: options?.axisTitle?.x,
        min: xMin,
        max: xMax,
      },
      yAxis: {
        type: 'value',
        ...baseAxis,
        name: options?.axisTitle?.yLeft,
        min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
        max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
      },
      series: data.series.map((s, idx) => ({
        type: 'line',
        name: data.legends[idx],
        data: s,
        smooth: options?.lineSmooth,
        areaStyle: {},
        stack: options?.stack ? 'A' : undefined,
        label: options?.showDataLabels
          ? {
              show: true,
              position: options?.dataLabelPosition || 'top',
            }
          : undefined,
      })),
    };
  }

  if (type === 'pie' || type === 'ring') {
    const isRing = type === 'ring';
    const seriesData = data.series[0]?.map((v, idx) => ({
      value: v,
      name: data.labels[idx],
      itemStyle: {
        color: (data.dataColors && data.dataColors[idx]) || themeColors[idx % themeColors.length],
      },
    }));
    return {
      color: themeColors,
      legend: legend ?? { top: 'bottom' },
      series: [
        {
          type: 'pie',
          radius: isRing ? ['40%', '70%'] : '70%',
          data: seriesData,
          label: options?.showDataLabels
            ? { show: true, position: options?.dataLabelPosition || (isRing ? 'center' : 'outside') }
            : undefined,
        },
      ],
    };
  }

  if (type === 'scatter') {
    return {
      color: themeColors,
      legend,
      xAxis: {
        type: 'value',
        ...baseAxis,
        name: options?.axisTitle?.x,
        min: xMin,
        max: xMax,
      },
      yAxis: {
        type: 'value',
        ...baseAxis,
        name: options?.axisTitle?.yLeft,
        min: yLeftMin,
        max: yLeftMax,
      },
      series: [
        {
          type: 'scatter',
          data: data.series[0].map((x, idx) => [x, data.series[1]?.[idx] ?? x]),
          symbolSize: (options?.pointSizes && options.pointSizes[0]) || 12,
        },
      ],
    };
  }

  if (type === 'combo') {
    const resolvedTypes = options?.seriesTypes && options.seriesTypes.length === data.series.length
      ? options.seriesTypes
      : data.series.map(() => 'bar');
    return {
      color: data.seriesColors?.length ? data.seriesColors : themeColors,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        ...baseAxis,
        name: options?.axisTitle?.x,
        min: xMin,
        max: xMax,
      },
      yAxis: [
        {
          type: 'value',
          ...baseAxis,
          name: options?.axisTitle?.yLeft,
          min: yLeftMin,
          max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
        },
        {
          type: 'value',
          ...baseAxis,
          name: options?.axisTitle?.yRight,
          min: yRightMin,
          max: yRightMax,
        },
      ],
      series: data.series.map((s, idx) => {
        const t = resolvedTypes[idx];
        const resolvedLabelPos = options?.dataLabelPosition === 'outside' ? 'top' : options?.dataLabelPosition;
        if (t === 'line') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: options?.lineSmooth,
            yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
            label: options?.showDataLabels ? { show: true, position: resolvedLabelPos || 'top' } : undefined,
          };
        }
        if (t === 'area') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: options?.lineSmooth,
            areaStyle: {},
            yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
            label: options?.showDataLabels ? { show: true, position: resolvedLabelPos || 'top' } : undefined,
          };
        }
        return {
          type: 'bar',
          name: data.legends[idx],
          data: s,
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
          label: options?.showDataLabels ? { show: true, position: resolvedLabelPos || 'top' } : undefined,
        };
      }),
    };
  }

  return null;
};

const MagicWidgetRenderer: React.FC<MagicWidgetRendererProps> = ({
  widget,
  data,
  filters,
  theme,
  onValueClick,
  isEditing = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const activeTheme = theme ?? CLASSIC_ANALYTICS_THEME;

  const filteredRows = useMemo(() => applyWidgetFilters(data, filters), [data, filters]);

  const payload = useMemo(
    () => buildMagicChartPayload(widget, filteredRows, { theme: activeTheme }),
    [widget, filteredRows, activeTheme]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
    }

    const chart = chartRef.current;
    const option = buildMagicEchartsOption(payload, widget.colSpan || 2, isEditing);
    if (option) {
      chart.setOption(option as any, true);
    }

    const handleResize = () => {
      chart?.resize();
    };

    window.addEventListener('resize', handleResize);

    if (onValueClick) {
      chart.off('click');
      chart.on('click', (params: any) => {
        const rawLabel =
          params.name ??
          params.axisValue ??
          (Array.isArray(params.value) ? params.value[0] : params.value);
        if (rawLabel === undefined || rawLabel === null) return;
        onValueClick(String(rawLabel), widget);
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chart) {
        chart.off('click');
        chart.dispose();
      }
      chartRef.current = null;
    };
  }, [payload, onValueClick, widget]);

  if (!payload) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        No data
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
};

export default MagicWidgetRenderer;
