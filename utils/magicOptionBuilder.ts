import type { MagicChartPayload } from './magicChartPayload';
import { buildEChartsOption } from '@shared/chartSpec';

/**
 * Build ECharts option from MagicChartPayload (pixel-perfect).
 * Keeps parity with MagicWidgetRenderer logic.
 * @param isEditing - When true, disables animation to prevent distracting re-renders during editing
 */
export const buildMagicEchartsOption = (payload: MagicChartPayload | null, colSpan: number = 2, isEditing: boolean = false) => {
  if (!payload) return null;

  // Animation settings - disabled during editing to prevent distracting re-renders
  const animationSettings = isEditing
    ? ({ animation: false } as const)
    : ({ animation: true, animationDuration: 300, animationEasing: 'cubicOut' as const } as const);

  // Responsive Scale Factors
  const isCompact = colSpan <= 1;
  const baseFontSize = isCompact ? 10 : 12;
  const smallFontSize = isCompact ? 9 : 11;
  const gridContainLabel = true;
  const gridPadding = isCompact ? { top: 20, bottom: 20, left: 5, right: 5 } : { top: 30, bottom: 30, left: 10, right: 10 };

  const { type, data, options, textColor, lineColor, themeColors } = payload;
  const axisRange = options?.axisRange || {};
  const xMin = (axisRange as any)?.xMin;
  const xMax = (axisRange as any)?.xMax;
  const yLeftMin = axisRange?.yLeftMin;
  const yLeftMax = axisRange?.yLeftMax;
  const yRightMin = (axisRange as any)?.yRightMin;
  const yRightMax = (axisRange as any)?.yRightMax;

  const buildAxisLine = (color?: string) => (color ? { lineStyle: { color } } : undefined);

  const buildAxisLabel = (cfg: { fontSize?: number; fontFamily?: string; color?: string; rotate?: number }) => ({
    ...(cfg.color || textColor ? { color: cfg.color ?? textColor } : {}),
    // Scale font size if not explicit, or if explicit but we are compact mode (maybe reduce slightly?)
    // For now, if user set explicit size, respect it. If default, use scaled.
    fontSize: typeof cfg.fontSize === 'number' ? (isCompact ? Math.max(8, cfg.fontSize - 2) : cfg.fontSize) : baseFontSize,
    ...(cfg.fontFamily ? { fontFamily: cfg.fontFamily } : {}),
    ...(typeof cfg.rotate === 'number' && cfg.rotate !== 0 ? { rotate: cfg.rotate } : {}),
    // Compact mode: truncate labels? ECharts does this automatically mostly.
    overflow: 'truncate',
    width: isCompact ? 60 : undefined,
  });

  const buildSplitLine = (cfg: { show?: boolean; color?: string }) => ({
    ...(typeof cfg.show === 'boolean' ? { show: cfg.show } : {}),
    ...(cfg.color || lineColor ? { lineStyle: { color: cfg.color ?? lineColor } } : {}),
  });

  const applyAxisVisibility = (axis: any, show?: boolean) => {
    if (show === false) {
      return {
        ...axis,
        name: undefined,
        nameTextStyle: undefined,
        axisLine: { ...(axis?.axisLine ?? {}), show: false },
        axisTick: { show: false },
        axisLabel: { ...(axis?.axisLabel ?? {}), show: false },
      };
    }
    return axis;
  };

  const normalizeBarLabelPosition = (
    pos: any,
    isVertical: boolean
  ): 'top' | 'right' | 'inside' => {
    if (!pos) return isVertical ? 'top' : 'right';
    if (pos === 'center') return 'inside';
    if (pos === 'outside') return isVertical ? 'top' : 'right';
    if (pos === 'inside') return 'inside';
    return isVertical ? 'top' : 'right';
  };

  const normalizeLineLabelPosition = (pos: any): 'top' | 'inside' => {
    if (!pos) return 'top';
    if (pos === 'inside') return 'inside';
    return 'top';
  };

  const getNumericValue = (value: any): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'object' && (value as any).value !== undefined) {
      const n = Number((value as any).value);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const formatPercentText = (fraction: number, decimals: number) =>
    `${(fraction * 100).toFixed(decimals)}%`;

  const formatNumericText = (
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
      default:
        return String(value);
    }
  };

  const formatValueWithPercent = (
    baseValue: string,
    fraction: number | null | undefined,
    placement: 'prefix' | 'suffix' | undefined,
    decimals: number | undefined
  ) => {
    if (fraction === null || fraction === undefined) return baseValue;
    const pct = formatPercentText(fraction, decimals ?? 1);
    return placement === 'prefix' ? `${pct} ${baseValue}`.trim() : `${baseValue} (${pct})`;
  };

  const legendEnabled = options?.legendEnabled !== false;
  // Legend Scaling
  let legendPosition = options?.legendPosition || 'bottom';
  // Force bottom or scrollable legend for compact mode if it was left/right (too wide)
  if (isCompact && (legendPosition === 'left' || legendPosition === 'right')) {
      legendPosition = 'bottom';
  }

  const legend =
    !legendEnabled || data.series.length <= 1
      ? undefined
      : {
          type: isCompact ? 'scroll' : 'plain', // Use scroll for compact
          textStyle: {
            fontSize: typeof options?.legendFontSize === 'number' ? (isCompact ? Math.max(9, options.legendFontSize - 2) : options.legendFontSize) : baseFontSize,
            ...(options?.legendFontFamily ? { fontFamily: options.legendFontFamily } : {}),
            ...(options?.legendFontColor
              ? { color: options.legendFontColor }
              : textColor
                ? { color: textColor }
                : {}),
          },
          orient: legendPosition === 'left' || legendPosition === 'right' ? 'vertical' : 'horizontal',
          top:
            legendPosition === 'top'
              ? (isCompact ? 0 : 10)
              : legendPosition === 'left' || legendPosition === 'right'
                ? 'middle'
                : undefined,
          bottom: legendPosition === 'bottom' ? (isCompact ? 0 : 10) : undefined,
          left:
            legendPosition === 'left'
              ? (isCompact ? 0 : 10)
              : legendPosition === 'top' || legendPosition === 'bottom'
                ? options?.legendAlign || 'center'
                : undefined,
          right: legendPosition === 'right' ? (isCompact ? 0 : 10) : undefined,
          itemWidth: isCompact ? 15 : 25,
          itemHeight: isCompact ? 10 : 14,
          padding: isCompact ? 2 : 5
        };

  if (type === 'kpi') {
    const raw = data.series?.[0]?.[0];
    const n = getNumericValue(raw);
    const text = formatNumericText(n, options?.dataLabelValueFormat);
    const fontSize =
      typeof options?.dataLabelFontSize === 'number'
        ? options.dataLabelFontSize
        : isCompact
          ? 28
          : 42;
    const color = options?.dataLabelColor || textColor || '#111827';
    const fontFamily = options?.dataLabelFontFamily;
    const fontWeight = options?.dataLabelFontWeight || 'bold';

    return {
      ...animationSettings,
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text,
            fill: color,
            fontSize,
            ...(fontFamily ? { fontFamily } : {}),
            fontWeight,
          },
        },
      ],
    };
  }

  if (type === 'bar' || type === 'column') {
    const isVertical = (options?.orientation || (type === 'column' ? 'vertical' : 'horizontal')) === 'vertical';

    const resolvedColor = data.seriesColors?.length
      ? data.seriesColors
      : data.dataColors?.length
        ? data.dataColors
        : themeColors;

    // Use point colors for single series charts (allows per-category coloring from categoryConfig)
    const usePointColors = data.dataColors?.length && data.series.length === 1;

    const categoryAxis = {
      type: 'category',
      data: data.labels,
      name: options?.axisTitle?.x,
      axisLine: buildAxisLine(textColor),
      axisLabel: buildAxisLabel({
        fontSize: options?.axisLabelFontSizeX,
        fontFamily: options?.axisLabelFontFamilyX,
        color: options?.axisLabelColorX,
        rotate: options?.axisLabelSlantX,
      }),
      splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
      triggerEvent: true,
    };

    const valueAxis = {
      type: 'value',
      name: options?.axisTitle?.yLeft,
      axisLine: buildAxisLine(textColor),
      axisLabel: buildAxisLabel({
        fontSize: options?.axisLabelFontSizeYLeft,
        fontFamily: options?.axisLabelFontFamilyYLeft,
        color: options?.axisLabelColorYLeft,
      }),
      splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
      min: options?.percentStack ? 0 : yLeftMin,
      max: options?.percentStack ? 1 : yLeftMax,
      triggerEvent: true,
    };

    const seriesTotals = data.series.map((s) => s.reduce((sum, v) => sum + (Number(v) || 0), 0));
    const stackedIndexTotals =
      options?.stack || options?.percentStack
        ? data.labels.map((_, i) =>
            data.series.reduce((sum, s) => sum + (Number(s[i]) || 0), 0)
          )
        : [];

    const seriesLabelBase = options?.showDataLabels
      ? {
          show: true,
          position: normalizeBarLabelPosition(options?.dataLabelPosition, isVertical),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter: (params: any) =>
            formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
        }
      : undefined;

    return {
      ...animationSettings,
      color: resolvedColor,
      legend,
      grid: { containLabel: gridContainLabel, ...gridPadding },
      xAxis: applyAxisVisibility(
        isVertical
          ? categoryAxis
          : {
              ...valueAxis,
              name: options?.axisTitle?.x,
              min: xMin ?? valueAxis.min,
              max: xMax ?? valueAxis.max,
            },
        options?.axisShowX
      ),
      yAxis: applyAxisVisibility(
        isVertical ? valueAxis : { ...categoryAxis, name: options?.axisTitle?.yLeft },
        options?.axisShowYLeft
      ),
      series: data.series.map((s, idx) => {
        const seriesData = usePointColors
          ? s.map((v, i) => ({
              value: v,
              itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
            }))
          : s;

        const itemStyle =
          !usePointColors && data.seriesColors?.[idx] ? { color: data.seriesColors[idx] } : undefined;

        const label =
          seriesLabelBase && options?.dataLabelShowPercent
            ? {
                ...seriesLabelBase,
                formatter: (params: any) => {
                  const n = getNumericValue(params?.value);
                  let percent: number | null = null;

                  if (options?.percentStack) {
                    percent = n; // already 0..1
                  } else if (options?.stack) {
                    const total = stackedIndexTotals[params?.dataIndex] || 0;
                    percent = total > 0 ? n / total : null;
                  } else {
                    const total = seriesTotals[idx] || 0;
                    percent = total > 0 ? n / total : null;
                  }

                  return formatValueWithPercent(
                    formatNumericText(n, options?.dataLabelValueFormat),
                    percent,
                    options?.dataLabelPercentPlacement,
                    options?.dataLabelPercentDecimals
                  );
                },
              }
            : seriesLabelBase;

        return {
          type: 'bar',
          name: data.legends[idx],
          data: seriesData,
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          barWidth: options?.barWidth,
          barCategoryGap: options?.barCategoryGap,
          itemStyle,
          label,
        };
      }),
    };
  }

  if (type === 'line') {
    const seriesTotals = data.series.map((s) => s.reduce((sum, v) => sum + (Number(v) || 0), 0));
    const stackedIndexTotals =
      options?.stack || options?.percentStack
        ? data.labels.map((_, i) =>
            data.series.reduce((sum, s) => sum + (Number(s[i]) || 0), 0)
          )
        : [];

    const seriesLabelBase = options?.showDataLabels
      ? {
          show: true,
          position: normalizeLineLabelPosition(options?.dataLabelPosition),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter: (params: any) =>
            formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
        }
      : undefined;

    // Support per-point colors from categoryConfig for single series
    const usePointColors = data.dataColors?.length && data.series.length === 1;

    return {
      ...animationSettings,
      color: data.seriesColors?.length ? data.seriesColors : (data.dataColors?.length ? data.dataColors : themeColors),
      legend,
      grid: { containLabel: gridContainLabel, ...gridPadding },
      xAxis: applyAxisVisibility(
        {
          type: 'category',
          data: data.labels,
          name: options?.axisTitle?.x,
          min: xMin,
          max: xMax,
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeX,
            fontFamily: options?.axisLabelFontFamilyX,
            color: options?.axisLabelColorX,
            rotate: options?.axisLabelSlantX,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
          triggerEvent: true,
        },
        options?.axisShowX
      ),
      yAxis: applyAxisVisibility(
        {
          type: 'value',
          name: options?.axisTitle?.yLeft,
          min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
          max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeYLeft,
            fontFamily: options?.axisLabelFontFamilyYLeft,
            color: options?.axisLabelColorYLeft,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
          triggerEvent: true,
        },
        options?.axisShowYLeft
      ),
      series: data.series.map((s, idx) => {
        const label =
          seriesLabelBase && options?.dataLabelShowPercent
            ? {
                ...seriesLabelBase,
                formatter: (params: any) => {
                  const n = getNumericValue(params?.value);
                  let percent: number | null = null;

                  if (options?.percentStack) {
                    percent = n;
                  } else if (options?.stack) {
                    const total = stackedIndexTotals[params?.dataIndex] || 0;
                    percent = total > 0 ? n / total : null;
                  } else {
                    const total = seriesTotals[idx] || 0;
                    percent = total > 0 ? n / total : null;
                  }

                  return formatValueWithPercent(
                    formatNumericText(n, options?.dataLabelValueFormat),
                    percent,
                    options?.dataLabelPercentPlacement,
                    options?.dataLabelPercentDecimals
                  );
                },
              }
            : seriesLabelBase;

        // Apply per-point colors for single series line charts
        const seriesData = usePointColors
          ? s.map((v, i) => ({
              value: v,
              itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
            }))
          : s;

        return {
          type: 'line',
          name: data.legends[idx],
          data: seriesData,
          smooth: options?.lineSmooth,
          lineStyle: {
            width: options?.lineStrokeWidth ?? 2,
            type: options?.lineStrokeStyle ?? 'solid',
            ...(data.seriesColors?.[idx] ? { color: data.seriesColors[idx] } : {}),
          },
          label,
        };
      }),
    };
  }

  if (type === 'area') {
    const seriesTotals = data.series.map((s) => s.reduce((sum, v) => sum + (Number(v) || 0), 0));
    const stackedIndexTotals =
      options?.stack || options?.percentStack
        ? data.labels.map((_, i) =>
            data.series.reduce((sum, s) => sum + (Number(s[i]) || 0), 0)
          )
        : [];

    const seriesLabelBase = options?.showDataLabels
      ? {
          show: true,
          position: normalizeLineLabelPosition(options?.dataLabelPosition),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter: (params: any) =>
            formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
        }
      : undefined;

    // Support per-point colors from categoryConfig for single series
    const usePointColors = data.dataColors?.length && data.series.length === 1;

    return {
      ...animationSettings,
      color: data.seriesColors?.length ? data.seriesColors : (data.dataColors?.length ? data.dataColors : themeColors),
      legend,
      grid: { containLabel: gridContainLabel, ...gridPadding },
      xAxis: applyAxisVisibility(
        {
          type: 'category',
          data: data.labels,
          name: options?.axisTitle?.x,
          min: xMin,
          max: xMax,
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeX,
            fontFamily: options?.axisLabelFontFamilyX,
            color: options?.axisLabelColorX,
            rotate: options?.axisLabelSlantX,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
          triggerEvent: true,
        },
        options?.axisShowX
      ),
      yAxis: applyAxisVisibility(
        {
          type: 'value',
          name: options?.axisTitle?.yLeft,
          min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
          max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeYLeft,
            fontFamily: options?.axisLabelFontFamilyYLeft,
            color: options?.axisLabelColorYLeft,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
          triggerEvent: true,
        },
        options?.axisShowYLeft
      ),
      series: data.series.map((s, idx) => {
        const label =
          seriesLabelBase && options?.dataLabelShowPercent
            ? {
                ...seriesLabelBase,
                formatter: (params: any) => {
                  const n = getNumericValue(params?.value);
                  let percent: number | null = null;

                  if (options?.percentStack) {
                    percent = n;
                  } else if (options?.stack) {
                    const total = stackedIndexTotals[params?.dataIndex] || 0;
                    percent = total > 0 ? n / total : null;
                  } else {
                    const total = seriesTotals[idx] || 0;
                    percent = total > 0 ? n / total : null;
                  }

                  return formatValueWithPercent(
                    formatNumericText(n, options?.dataLabelValueFormat),
                    percent,
                    options?.dataLabelPercentPlacement,
                    options?.dataLabelPercentDecimals
                  );
                },
              }
            : seriesLabelBase;

        // Apply per-point colors for single series area charts
        const seriesData = usePointColors
          ? s.map((v, i) => ({
              value: v,
              itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
            }))
          : s;

        return {
          type: 'line',
          name: data.legends[idx],
          data: seriesData,
          smooth: options?.lineSmooth,
          areaStyle: {},
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          lineStyle: {
            width: options?.lineStrokeWidth ?? 2,
            type: options?.lineStrokeStyle ?? 'solid',
            ...(data.seriesColors?.[idx] ? { color: data.seriesColors[idx] } : {}),
          },
          label,
        };
      }),
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

    const clampInner = (value: number | undefined, fallback: number) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return `${fallback}%`;
      return `${Math.max(0, Math.min(80, value))}%`;
    };

    const resolvePieLabelPosition = (pos: any): 'inside' | 'outside' | 'center' => {
      if (!pos) return isRing ? 'center' : 'outside';
      if (pos === 'inside' || pos === 'outside' || pos === 'center') return pos;
      if (pos === 'top') return 'outside';
      return isRing ? 'center' : 'outside';
    };

    const formatter = (params: any) => {
      const raw = typeof params.value === 'object' ? params.value?.value : params.value;
      const val = typeof raw === 'number' ? raw : Number(raw) || 0;
      const base = formatNumericText(val, options?.dataLabelValueFormat);
      if (!options?.dataLabelShowPercent) return base;
      const percent = typeof params.percent === 'number' ? params.percent : 0;
      const percentText = `${percent.toFixed(options?.dataLabelPercentDecimals ?? 1)}%`;
      return options?.dataLabelPercentPlacement === 'prefix'
        ? `${percentText} ${base}`.trim()
        : `${base} (${percentText})`;
    };

    const pieLabel = options?.showDataLabels
      ? {
          show: true,
          position: resolvePieLabelPosition(options?.dataLabelPosition),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter,
        }
      : undefined;

    const pieLegend =
      legendEnabled === false
        ? undefined
        : {
            ...(legend ?? { bottom: 10, left: 'center' }),
            data: data.labels,
          };

    const labelPos = resolvePieLabelPosition(options?.dataLabelPosition);
    const outerRadius = labelPos === 'outside' ? '60%' : '70%';
    const centerY =
      pieLegend && (options?.legendPosition === 'bottom' || !options?.legendPosition) ? '45%' : '50%';

    return {
      ...animationSettings,
      color: themeColors,
      legend: pieLegend,
      series: [
        {
          type: 'pie',
          radius: isRing
            ? [clampInner(options?.pieInnerRadius, 40), outerRadius]
            : outerRadius,
          center: ['50%', centerY],
          startAngle: options?.pieStartAngle ?? 0,
          avoidLabelOverlap: true,
          labelLayout: { hideOverlap: true },
          data: seriesData,
          label: pieLabel
            ? {
                ...pieLabel,
                position: labelPos,
              }
            : undefined,
        },
      ],
    };
  }

  if (type === 'scatter') {
    // Build scatter data with labels for tooltip
    const scatterData = data.series[0].map((x, idx) => ({
      value: [x, data.series[1]?.[idx] ?? x],
      name: data.labels[idx] || `Point ${idx + 1}`,
      symbolSize: (options?.pointSizes && options.pointSizes[idx]) || 12,
      itemStyle: data.dataColors?.[idx] ? { color: data.dataColors[idx] } : undefined,
    }));

    return {
      ...animationSettings,
      color: themeColors,
      legend: data.labels.length > 1 ? {
        ...legend,
        data: data.labels,
      } : undefined,
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const name = params.name || '';
          const [x, y] = params.value || [0, 0];
          return `${name}<br/>X: ${x}<br/>Y: ${y}`;
        },
      },
      grid: { containLabel: gridContainLabel, ...gridPadding },
      xAxis: applyAxisVisibility(
        {
          type: 'value',
          name: options?.axisTitle?.x,
          min: xMin,
          max: xMax,
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeX,
            fontFamily: options?.axisLabelFontFamilyX,
            color: options?.axisLabelColorX,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
          triggerEvent: true,
        },
        options?.axisShowX
      ),
      yAxis: applyAxisVisibility(
        {
          type: 'value',
          name: options?.axisTitle?.yLeft,
          min: yLeftMin,
          max: yLeftMax,
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeYLeft,
            fontFamily: options?.axisLabelFontFamilyYLeft,
            color: options?.axisLabelColorYLeft,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
          triggerEvent: true,
        },
        options?.axisShowYLeft
      ),
      series: [
        {
          type: 'scatter',
          data: scatterData,
          symbolSize: (params: any) => params.symbolSize || 12,
          label: options?.showDataLabels ? {
            show: true,
            position: 'top',
            formatter: (params: any) => params.name,
            fontSize: options?.dataLabelFontSize || 10,
            color: options?.dataLabelColor || textColor,
          } : undefined,
        },
      ],
    };
  }

  if (type === 'combo') {
    const resolvedTypes =
      options?.seriesTypes && options.seriesTypes.length === data.series.length
        ? options.seriesTypes
        : data.series.map(() => 'bar');
    const usePointColorsForSingleBarSeries =
      !!(data.dataColors?.length) && resolvedTypes.filter((t) => t === 'bar').length === 1;

    const seriesTotals = data.series.map((s) => s.reduce((sum, v) => sum + (Number(v) || 0), 0));
    const stackedIndexTotals =
      options?.stack || options?.percentStack
        ? data.labels.map((_, i) =>
            data.series.reduce((sum, s) => sum + (Number(s[i]) || 0), 0)
          )
        : [];

    const seriesLabelBar = options?.showDataLabels
      ? {
          show: true,
          position: normalizeBarLabelPosition(options?.dataLabelPosition, true),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter: (params: any) =>
            formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
        }
      : undefined;

    const seriesLabelLine = options?.showDataLabels
      ? {
          show: true,
          position: normalizeLineLabelPosition(options?.dataLabelPosition),
          ...(typeof options?.dataLabelFontSize === 'number' ? { fontSize: options.dataLabelFontSize } : {}),
          ...(options?.dataLabelFontFamily ? { fontFamily: options.dataLabelFontFamily } : {}),
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          ...(options?.dataLabelColor ? { color: options.dataLabelColor } : {}),
          formatter: (params: any) =>
            formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
        }
      : undefined;

    return {
      ...animationSettings,
      color: data.seriesColors?.length ? data.seriesColors : themeColors,
      legend,
      grid: { containLabel: gridContainLabel, ...gridPadding },
      xAxis: applyAxisVisibility(
        {
          type: 'category',
          data: data.labels,
          name: options?.axisTitle?.x,
          min: xMin,
          max: xMax,
          axisLine: buildAxisLine(textColor),
          axisLabel: buildAxisLabel({
            fontSize: options?.axisLabelFontSizeX,
            fontFamily: options?.axisLabelFontFamilyX,
            color: options?.axisLabelColorX,
            rotate: options?.axisLabelSlantX,
          }),
          splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
          triggerEvent: true,
        },
        options?.axisShowX
      ),
      yAxis: [
        applyAxisVisibility(
          {
            type: 'value',
            name: options?.axisTitle?.yLeft,
            min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
            max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
            axisLine: buildAxisLine(textColor),
            axisLabel: buildAxisLabel({
              fontSize: options?.axisLabelFontSizeYLeft,
              fontFamily: options?.axisLabelFontFamilyYLeft,
              color: options?.axisLabelColorYLeft,
            }),
            splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
            triggerEvent: true,
          },
          options?.axisShowYLeft
        ),
        applyAxisVisibility(
          {
            type: 'value',
            name: options?.axisTitle?.yRight,
            min: yRightMin,
            max: yRightMax,
            axisLine: buildAxisLine(textColor),
            axisLabel: buildAxisLabel({
              fontSize: options?.axisLabelFontSizeYRight,
              fontFamily: options?.axisLabelFontFamilyYRight,
              color: options?.axisLabelColorYRight,
            }),
            splitLine: buildSplitLine({
              show: options?.axisGridShowYRight ?? false,
              color: options?.axisGridColorYRight,
            }),
            triggerEvent: true,
          },
          options?.axisShowYRight
        ),
      ],
      series: data.series.map((s, idx) => {
        const t = resolvedTypes[idx];

        const baseLabel = t === 'bar' ? seriesLabelBar : seriesLabelLine;
        const label =
          baseLabel && options?.dataLabelShowPercent
            ? {
                ...baseLabel,
                formatter: (params: any) => {
                  const n = getNumericValue(params?.value);
                  let percent: number | null = null;

                  if (options?.percentStack) {
                    percent = n; // already 0..1
                  } else if (options?.stack) {
                    const total = stackedIndexTotals[params?.dataIndex] || 0;
                    percent = total > 0 ? n / total : null;
                  } else {
                    const total = seriesTotals[idx] || 0;
                    percent = total > 0 ? n / total : null;
                  }

                  return formatValueWithPercent(
                    formatNumericText(n, options?.dataLabelValueFormat),
                    percent,
                    options?.dataLabelPercentPlacement,
                    options?.dataLabelPercentDecimals
                  );
                },
              }
            : baseLabel;

        const seriesColor = data.seriesColors?.[idx];
        const itemStyle =
          t === 'bar' && usePointColorsForSingleBarSeries
            ? undefined
            : seriesColor
              ? { color: seriesColor }
              : undefined;
        // Per-series smooth and strokeWidth
        const seriesSmooth = options?.seriesSmoothList?.[idx] ?? options?.lineSmooth ?? false;
        const seriesStrokeWidth = options?.seriesStrokeWidths?.[idx] ?? (options?.lineStrokeWidth ?? 2);
        const seriesStrokeStyle = options?.seriesStrokeStyles?.[idx] ?? options?.lineStrokeStyle ?? 'solid';
        // Per-series data labels
        const perSeriesLabel = options?.seriesDataLabels?.[idx];
        const finalLabel = perSeriesLabel?.enabled
          ? {
              show: true,
              position: perSeriesLabel.position || 'top',
              fontSize: perSeriesLabel.fontSize || 11,
              ...(perSeriesLabel.fontFamily ? { fontFamily: perSeriesLabel.fontFamily } : {}),
              ...(perSeriesLabel.fontWeight ? { fontWeight: perSeriesLabel.fontWeight } : {}),
              color: perSeriesLabel.color || textColor,
              formatter: (params: any) => {
                const n = getNumericValue(params?.value);
                let percent: number | null = null;
                if (perSeriesLabel.showPercent) {
                  if (options?.percentStack) {
                    percent = n;
                  } else if (options?.stack) {
                    const total = stackedIndexTotals[params?.dataIndex] || 0;
                    percent = total > 0 ? n / total : null;
                  } else {
                    const total = seriesTotals[idx] || 0;
                    percent = total > 0 ? n / total : null;
                  }
                }
                const base = formatNumericText(n, perSeriesLabel.valueFormat ?? options?.dataLabelValueFormat);
                return formatValueWithPercent(
                  base,
                  percent,
                  perSeriesLabel.percentPlacement ?? options?.dataLabelPercentPlacement,
                  perSeriesLabel.percentDecimals ?? options?.dataLabelPercentDecimals
                );
              },
            }
          : label;

        if (t === 'line') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: seriesSmooth,
            yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
            itemStyle,
            lineStyle: {
              ...(seriesColor ? { color: seriesColor } : {}),
              width: seriesStrokeWidth,
              type: seriesStrokeStyle,
            },
            label: finalLabel,
          };
        }
        if (t === 'area') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: seriesSmooth,
            areaStyle: seriesColor ? { color: seriesColor } : {},
            yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
            itemStyle,
            lineStyle: {
              ...(seriesColor ? { color: seriesColor } : {}),
              width: seriesStrokeWidth,
              type: seriesStrokeStyle,
            },
            label: finalLabel,
          };
        }
        const barData =
          usePointColorsForSingleBarSeries && data.dataColors?.length
            ? s.map((v, i) => ({
                value: v,
                itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
              }))
            : s;
        return {
          type: 'bar',
          name: data.legends[idx],
          data: barData,
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          yAxisIndex: options?.yAxisIndexes?.[idx] ?? 0,
          itemStyle,
          barWidth: options?.barWidth,
          barCategoryGap: options?.barCategoryGap,
          label: finalLabel,
        };
      }),
    };
  }

  return null;
};

export const buildMagicEchartsOptionShared = (payload: MagicChartPayload | null, colSpan: number = 2, isEditing: boolean = false) => {
  return buildEChartsOption(payload as any, colSpan, isEditing)
}
