import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import type { MagicAggregationWorkerClient } from '../hooks/useMagicAggregationWorker';

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
  /** UI is being dragged/resized; defer heavy work until it stops */
  isInteracting?: boolean;
  workerClient?: MagicAggregationWorkerClient;
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
  isInteracting = false,
  workerClient,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const disposeTimerRef = useRef<number | null>(null);
  const activeTheme = theme ?? CLASSIC_ANALYTICS_THEME;

  const [isInView, setIsInView] = useState(false);
  const [payload, setPayload] = useState<MagicChartPayload | null>(null);
  const [didCompute, setDidCompute] = useState(false);
  const isKpiWidget = widget.type === 'kpi';

  const cancelDispose = useCallback(() => {
    if (disposeTimerRef.current) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
  }, []);

  const scheduleDispose = useCallback((ms: number) => {
    cancelDispose();
    disposeTimerRef.current = window.setTimeout(() => {
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
      disposeTimerRef.current = null;
    }, ms);
  }, [cancelDispose]);

  // IntersectionObserver: lazy init + dispose when out-of-view
  useEffect(() => {
    if (isKpiWidget) {
      setIsInView(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const next = !!entry?.isIntersecting;
        setIsInView(next);
      },
      { root: null, rootMargin: '400px 0px', threshold: 0.01 }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [isKpiWidget]);

  // Build payload (heavy): run only when visible and not interacting
  useEffect(() => {
    if (!isInView && !isKpiWidget) return;
    if (isInteracting) return;

    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      try {
        if (isEditing) setDidCompute(false);
        const next = workerClient?.isSupported
          ? await workerClient.requestPayload({ widget, filters, theme: activeTheme })
          : buildMagicChartPayload(widget, applyWidgetFilters(data, filters), { theme: activeTheme });
        if (cancelled) return;
        setPayload(next);
        setDidCompute(true);
      } catch (e) {
        console.error('[MagicWidgetRenderer] payload build failed:', e);
        setPayload(null);
        setDidCompute(true);
      }
    };

    // In ChartBuilder we want reactive preview; keep a tiny debounce.
    // In Dashboard, prefer idle scheduling to protect the main thread.
    const ric = (window as any).requestIdleCallback as
      | undefined
      | ((cb: () => void, opts?: { timeout: number }) => number);
    const cancelRic = (window as any).cancelIdleCallback as undefined | ((id: number) => void);
    let handle: number | null = null;

    if (isEditing) {
      handle = window.setTimeout(() => void run(), 120);
    } else if (ric) {
      handle = ric(() => void run(), { timeout: 800 });
    } else {
      handle = window.setTimeout(() => void run(), 0);
    }

    return () => {
      cancelled = true;
      if (handle !== null) {
        if (!isEditing && ric && cancelRic) cancelRic(handle);
        else window.clearTimeout(handle);
      }
    };
  }, [isInView, isInteracting, widget, data, filters, activeTheme, workerClient, isEditing, isKpiWidget]);

  // Init chart only when visible
  useEffect(() => {
    if (isKpiWidget) {
      cancelDispose();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    if (!isInView) {
      // Allow small hysteresis to avoid thrashing during fast scroll
      scheduleDispose(1500);
      return;
    }

    cancelDispose();
    if (!chartRef.current) {
      chartRef.current = echarts.init(el, undefined, { renderer: 'svg' });
    }

    const chart = chartRef.current;

    if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserverRef.current.observe(el);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [isInView, scheduleDispose, cancelDispose, isKpiWidget]);

  // Update option when payload ready and chart is alive
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!isInView) return;
    if (!payload) return;

    // KPI is rendered as a card (no ECharts)
    if (payload.type === 'kpi') return;

    const option = buildMagicEchartsOption(payload, widget.colSpan || 2, isEditing);
    if (!option) return;
    chart.setOption(option as any, { notMerge: true, lazyUpdate: true } as any);
  }, [payload, isInView, widget.colSpan, isEditing]);

  // Click binding (doesn't need to re-init chart)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!onValueClick) return;
    if (payload?.type === 'kpi') return;

    const handler = (params: any) => {
      const rawLabel =
        params.name ??
        params.axisValue ??
        (Array.isArray(params.value) ? params.value[0] : params.value);
      if (rawLabel === undefined || rawLabel === null) return;
      onValueClick(String(rawLabel), widget);
    };

    chart.off('click');
    chart.on('click', handler);
    return () => {
      chart.off('click');
    };
  }, [onValueClick, widget, payload?.type]);

  // Final cleanup
  useEffect(() => {
    return () => {
      cancelDispose();
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [cancelDispose]);

  if (didCompute && !payload) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        No data
      </div>
    );
  }

  if (payload?.type === 'kpi') {
    const value = payload.data?.series?.[0]?.[0] ?? 0;
    const formatter = new Intl.NumberFormat(undefined, {
      notation: widget.valueFormat === 'compact' ? 'compact' : 'standard',
      maximumFractionDigits: widget.valueFormat === 'percent' ? 2 : 2,
    });
    const textColor = payload.textColor || '#111827';
    const lineColor = payload.lineColor || '#E5E7EB';
    const accent = payload.themeColors?.[0] || '#111827';
    const titleText = widget.chartTitle || widget.title || 'Number';

    return (
      <div className="w-full h-full flex items-center justify-center">
        <div
          className="w-full h-full rounded-xl border bg-white flex flex-col justify-center px-6"
          style={{ borderColor: lineColor }}
        >
          <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: textColor, opacity: 0.7 }}>
            {titleText}
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums" style={{ color: accent }}>
            {formatter.format(value)}
          </div>
          {widget.subtitle ? (
            <div className="mt-1 text-xs" style={{ color: textColor, opacity: 0.65 }}>
              {widget.subtitle}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-busy={!didCompute && isInView}
      />
      {isEditing && isInView && !didCompute ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
          Updating…
        </div>
      ) : null}
    </div>
  );
};

export default React.memo(MagicWidgetRenderer);
