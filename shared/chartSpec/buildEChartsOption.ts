import type { SharedChartPayload, SharedChartOptions, ValueFormatMode } from './types'

export const buildEChartsOption = (payload: SharedChartPayload | null, colSpan: number = 2, isEditing: boolean = false) => {
  if (!payload) return null

  const animationSettings = isEditing
    ? ({ animation: false } as const)
    : ({ animation: true, animationDuration: 300, animationEasing: 'cubicOut' as const } as const)

  const isCompact = colSpan <= 1
  const baseFontSize = isCompact ? 10 : 12
  const smallFontSize = isCompact ? 9 : 11
  const gridPadding = isCompact ? { top: 20, bottom: 20, left: 5, right: 5 } : { top: 30, bottom: 30, left: 10, right: 10 }

  const { type, data, options, textColor, lineColor, themeColors } = payload
  const axisRange = options?.axisRange || {}
  const xMin = axisRange?.xMin
  const xMax = axisRange?.xMax
  const yLeftMin = axisRange?.yLeftMin
  const yLeftMax = axisRange?.yLeftMax
  const yRightMin = axisRange?.yRightMin
  const yRightMax = axisRange?.yRightMax

  const buildAxisLine = (color?: string) => (color ? { lineStyle: { color } } : undefined)

  const buildAxisLabel = (cfg: { fontSize?: number; fontFamily?: string; color?: string; rotate?: number }) => ({
    ...(cfg.color || textColor ? { color: cfg.color ?? textColor } : {}),
    fontSize: typeof cfg.fontSize === 'number' ? (isCompact ? Math.max(8, cfg.fontSize - 2) : cfg.fontSize) : baseFontSize,
    ...(cfg.fontFamily ? { fontFamily: cfg.fontFamily } : {}),
    ...(typeof cfg.rotate === 'number' && cfg.rotate !== 0 ? { rotate: cfg.rotate } : {}),
    overflow: 'truncate',
    width: isCompact ? 60 : undefined,
  })

  const buildSplitLine = (cfg: { show?: boolean; color?: string }) => ({
    ...(typeof cfg.show === 'boolean' ? { show: cfg.show } : {}),
    ...(cfg.color || lineColor ? { lineStyle: { color: cfg.color ?? lineColor } } : {}),
  })

  const applyAxisVisibility = (axis: any, show?: boolean) => {
    if (show === false) {
      return {
        ...axis,
        name: undefined,
        nameTextStyle: undefined,
        axisLine: { ...(axis?.axisLine ?? {}), show: false },
        axisTick: { show: false },
        axisLabel: { ...(axis?.axisLabel ?? {}), show: false },
      }
    }
    return axis
  }

  const normalizeBarLabelPosition = (pos: any, isVertical: boolean): 'top' | 'right' | 'inside' => {
    if (!pos) return isVertical ? 'top' : 'right'
    if (pos === 'center') return 'inside'
    if (pos === 'outside') return isVertical ? 'top' : 'right'
    if (pos === 'inside') return 'inside'
    return isVertical ? 'top' : 'right'
  }

  const normalizeLineLabelPosition = (pos: any): 'top' | 'inside' => {
    if (!pos) return 'top'
    if (pos === 'inside') return 'inside'
    return 'top'
  }

  const getNumericValue = (value: any): number => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'object' && (value as any).value !== undefined) {
      const n = Number((value as any).value)
      return Number.isFinite(n) ? n : 0
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  const formatNumericText = (value: number, mode?: ValueFormatMode) => {
    if (!Number.isFinite(value)) return '0'
    switch (mode) {
      case 'text':
        return String(value)
      case 'number':
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
      case 'compact':
        return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
      case 'accounting':
        return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
      case 'auto':
      default:
        return String(value)
    }
  }

  const formatValueWithPercent = (
    baseValue: string,
    fraction: number | null | undefined,
    placement: 'prefix' | 'suffix' | undefined,
    decimals: number | undefined
  ) => {
    if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return baseValue
    const p = `${(fraction * 100).toFixed(decimals ?? 0)}%`
    if (placement === 'prefix') return `${p} ${baseValue}`
    return `${baseValue} ${p}`
  }

  const palette = data.seriesColors && data.seriesColors.length ? data.seriesColors : themeColors
  const textStyle = textColor ? { color: textColor } : {}

  if (type === 'kpi') return null

  if (type === 'pie' || type === 'ring') {
    const legendEnabled = options?.legendEnabled !== false && data.series.length > 1
    const legendPos = options?.legendPosition || 'bottom'
    const legendLayout =
      legendPos === 'left' || legendPos === 'right'
        ? { orient: 'vertical' as const, [legendPos]: 10, top: 'middle' }
        : { [legendPos]: legendPos === 'top' ? 10 : 10 }

    const legendTextStyle = {
      ...(options?.legendFontSize ? { fontSize: options.legendFontSize } : {}),
      ...(options?.legendFontColor ? { color: options.legendFontColor } : textStyle),
    }

    const legendAlignProps =
      legendPos === 'top' || legendPos === 'bottom'
        ? { align: options?.legendAlign || 'left' }
        : {}

    const seriesItem = {
      type: type === 'ring' ? 'pie' : 'pie',
      radius: type === 'ring' ? [options?.pieInnerRadius ?? 75, 100] : [0, 100],
      startAngle: options?.pieStartAngle,
      label: {
        show: options?.showDataLabels !== false,
        position: options?.dataLabelPosition || 'outside',
        ...(options?.dataLabelFontSize ? { fontSize: options.dataLabelFontSize } : {}),
        ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
        ...(options?.dataLabelColor ? { color: options.dataLabelColor } : textColor ? { color: textColor } : {}),
        formatter: options?.dataLabelShowPercent
          ? (params: any) => {
              const percent = typeof params.percent === 'number' ? params.percent : 0
              return `${percent.toFixed(options?.dataLabelPercentDecimals ?? 0)}%`
            }
          : undefined,
      },
      labelLine: {
        show: true,
      },
      data: data.series.map((item: any, index: number) => ({
        value: item,
        name: data.legends[index],
        ...(data.seriesColors && data.seriesColors[index] ? { itemStyle: { color: data.seriesColors[index] } } : {}),
      })),
    }

    return {
      ...animationSettings,
      color: palette,
      textStyle,
      legend: legendEnabled
        ? {
            ...legendLayout,
            textStyle: legendTextStyle,
            ...legendAlignProps,
          }
        : undefined,
      grid: {
        containLabel: true,
        ...gridPadding,
      },
      series: [seriesItem],
    }
  }

  const axisLine = buildAxisLine(textColor)

  const xAxis = applyAxisVisibility(
    {
      type: 'category',
      data: data.labels,
      name: options?.axisTitle?.x,
      axisLine,
      axisLabel: buildAxisLabel({
        fontSize: options?.axisLabelFontSizeX ?? (options as SharedChartOptions | undefined)?.axisLabelFontSize,
        color: options?.axisLabelColorX ?? (options as SharedChartOptions | undefined)?.axisLabelColor,
        rotate: options?.axisLabelSlantX ?? (options as SharedChartOptions | undefined)?.axisLabelSlant,
      }),
      splitLine: buildSplitLine({ show: options?.axisGridShowX ?? (options as SharedChartOptions | undefined)?.axisGridShow, color: options?.axisGridColorX ?? (options as SharedChartOptions | undefined)?.axisGridColor }),
      min: xMin,
      max: xMax,
      triggerEvent: true,
    },
    options?.axisShowX
  )

  const yLeftAxis = applyAxisVisibility(
    {
      type: 'value' as const,
      name: options?.axisTitle?.yLeft,
      axisLine,
      axisLabel: buildAxisLabel({
        fontSize: options?.axisLabelFontSizeYLeft ?? (options as SharedChartOptions | undefined)?.axisLabelFontSize,
        color: options?.axisLabelColorYLeft ?? (options as SharedChartOptions | undefined)?.axisLabelColor,
      }),
      splitLine: buildSplitLine({ show: options?.axisGridShowYLeft ?? (options as SharedChartOptions | undefined)?.axisGridShow, color: options?.axisGridColorYLeft ?? (options as SharedChartOptions | undefined)?.axisGridColor }),
      min: yLeftMin ?? (options?.percentStack ? 0 : undefined),
      max: yLeftMax ?? (options?.percentStack ? 1 : undefined),
      triggerEvent: true,
    },
    options?.axisShowYLeft
  )

  const yRightAxis = applyAxisVisibility(
    {
      type: 'value' as const,
      name: options?.axisTitle?.yRight,
      axisLine,
      axisLabel: buildAxisLabel({
        fontSize: options?.axisLabelFontSizeYRight ?? (options as SharedChartOptions | undefined)?.axisLabelFontSize,
        color: options?.axisLabelColorYRight ?? (options as SharedChartOptions | undefined)?.axisLabelColor,
      }),
      splitLine: {
        show: options?.axisGridShowYRight ?? false,
        lineStyle: { color: options?.axisGridColorYRight ?? lineColor },
      },
      min: yRightMin,
      max: yRightMax,
      triggerEvent: true,
    },
    options?.axisShowYRight
  )

  const legendEnabled = options?.legendEnabled !== false && data.series.length > 1 && type !== 'scatter'
  const legendPos = options?.legendPosition || 'bottom'
  const legendLayout =
    legendPos === 'left' || legendPos === 'right'
      ? { orient: 'vertical' as const, [legendPos]: 10, top: 'middle' }
      : { [legendPos]: legendPos === 'top' ? 10 : 10 }
  const legendTextStyle = {
    ...(options?.legendFontSize ? { fontSize: options.legendFontSize } : {}),
    ...(options?.legendFontColor ? { color: options.legendFontColor } : textStyle),
  }
  const legendAlignProps =
    legendPos === 'top' || legendPos === 'bottom'
      ? { align: options?.legendAlign || 'left' }
      : {}

  const legend = legendEnabled
    ? {
        ...legendLayout,
        textStyle: legendTextStyle,
        ...legendAlignProps,
      }
    : undefined

  const showDataLabels = options?.showDataLabels !== false
  const baseLabel =
    showDataLabels
      ? {
          show: true,
          position: options?.dataLabelPosition,
          fontSize: options?.dataLabelFontSize ?? smallFontSize,
          ...(options?.dataLabelFontWeight ? { fontWeight: options.dataLabelFontWeight } : {}),
          color: options?.dataLabelColor || '#000000',
        }
      : { show: false }

  if (type === 'scatter') {
    const formatedData: any[] = []
    const xSeries = (data.series[0] || []) as any[]
    const ySeries = (data.series[1] || []) as any[]
    for (let i = 0; i < xSeries.length; i++) {
      const x = getNumericValue(xSeries[i])
      const y = getNumericValue(ySeries[i] ?? xSeries[i])
      formatedData.push([x, y])
    }

    const clampSize = (val: number) => Math.max(4, Math.min(32, val))

    return {
      ...animationSettings,
      color: palette,
      textStyle,
      legend,
      grid: {
        containLabel: true,
        ...gridPadding,
      },
      xAxis: {
        axisLine,
        axisLabel: buildAxisLabel({ fontSize: options?.axisLabelFontSizeX, color: options?.axisLabelColorX }),
        splitLine: buildSplitLine({ show: options?.axisGridShowX, color: options?.axisGridColorX }),
        name: options?.axisTitle?.x,
        min: xMin,
        max: xMax,
        triggerEvent: true,
      },
      yAxis: {
        axisLine,
        axisLabel: buildAxisLabel({ fontSize: options?.axisLabelFontSizeYLeft, color: options?.axisLabelColorYLeft }),
        splitLine: buildSplitLine({ show: options?.axisGridShowYLeft, color: options?.axisGridColorYLeft }),
        name: options?.axisTitle?.yLeft,
        min: yLeftMin,
        max: yLeftMax,
        triggerEvent: true,
      },
      series: [
        {
          symbolSize: (_val: number[], params: { dataIndex: number }) => {
            if (!options?.pointSizes || options.pointSizes[params.dataIndex] === undefined) return 12
            return clampSize(options.pointSizes[params.dataIndex]!)
          },
          data: formatedData,
          type: 'scatter',
        },
      ],
    }
  }

  const seriesTotals = data.series.map((s: any) => (Array.isArray(s) ? (s as any[]).reduce((acc, v) => acc + getNumericValue(v), 0) : 0))
  const stackedIndexTotals: number[] = []
  if (options?.stack || options?.percentStack) {
    const len = data.labels.length
    for (let i = 0; i < len; i++) {
      let sum = 0
      for (const s of data.series as any[]) sum += getNumericValue((s as any[])[i])
      stackedIndexTotals[i] = sum
    }
  }

  const resolvedSeriesTypes =
    options?.seriesTypes && options.seriesTypes.length === data.series.length
      ? options.seriesTypes
      : data.series.map(() => 'bar')

  const hasDualAxis = Array.isArray(options?.yAxisIndexes) && options.yAxisIndexes.some(idx => idx === 1) && options?.axisShowYRight !== false

  const yAxisConfig = hasDualAxis ? [yLeftAxis, yRightAxis] : yLeftAxis

  if (type === 'combo') {
    return {
      ...animationSettings,
      color: palette,
      textStyle,
      legend,
      grid: {
        containLabel: true,
        ...gridPadding,
      },
      xAxis,
      yAxis: yAxisConfig,
      series: (data.series as any[]).map((s, idx) => {
        const t = resolvedSeriesTypes[idx] || 'bar'
        const yAxisIndex = options?.yAxisIndexes?.[idx] ?? 0
        const seriesColor = data.seriesColors?.[idx]

        const perSeriesLabel = options?.seriesDataLabels?.[idx]
        const finalLabel = perSeriesLabel?.enabled
          ? {
              show: true,
              position: perSeriesLabel.position || 'top',
              fontSize: perSeriesLabel.fontSize || 11,
              ...(perSeriesLabel.fontFamily ? { fontFamily: perSeriesLabel.fontFamily } : {}),
              ...(perSeriesLabel.fontWeight ? { fontWeight: perSeriesLabel.fontWeight } : {}),
              color: perSeriesLabel.color || textColor,
              formatter: (params: any) => {
                const n = getNumericValue(params?.value)
                let percent: number | null = null
                if (perSeriesLabel.showPercent) {
                  const total = seriesTotals[idx] || 0
                  percent = total > 0 ? n / total : null
                }
                const base = formatNumericText(n, perSeriesLabel.valueFormat ?? options?.dataLabelValueFormat)
                return formatValueWithPercent(
                  base,
                  percent,
                  perSeriesLabel.percentPlacement ?? options?.dataLabelPercentPlacement,
                  perSeriesLabel.percentDecimals ?? options?.dataLabelPercentDecimals
                )
              },
            }
          : {
              ...baseLabel,
              position: t === 'bar' ? normalizeBarLabelPosition(options?.dataLabelPosition, true) : normalizeLineLabelPosition(options?.dataLabelPosition),
              formatter: (params: any) => {
                const n = getNumericValue(params?.value)
                let percent: number | null = null
                if (options?.dataLabelShowPercent) {
                  const total = seriesTotals[idx] || 0
                  percent = total > 0 ? n / total : null
                }
                return formatValueWithPercent(
                  formatNumericText(n, options?.dataLabelValueFormat),
                  percent,
                  options?.dataLabelPercentPlacement,
                  options?.dataLabelPercentDecimals
                )
              },
            }

        if (t === 'line' || t === 'area') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: options?.seriesSmoothList?.[idx] ?? options?.lineSmooth ?? false,
            yAxisIndex: hasDualAxis ? yAxisIndex : undefined,
            ...(t === 'area' ? { areaStyle: {} } : {}),
            itemStyle: seriesColor ? { color: seriesColor } : undefined,
            lineStyle: {
              ...(seriesColor ? { color: seriesColor } : {}),
              width: options?.seriesStrokeWidths?.[idx] ?? 2,
              type: options?.seriesStrokeStyles?.[idx] ?? 'solid',
            },
            label: finalLabel,
          }
        }

        const usePointColorsForSingleBarSeries = data.series.length === 1 && Array.isArray(data.dataColors) && data.dataColors.length > 0
        const barData =
          usePointColorsForSingleBarSeries
            ? (s as any[]).map((v, i) => ({
                value: v,
                itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
              }))
            : s

        return {
          type: 'bar',
          name: data.legends[idx],
          data: barData,
          yAxisIndex: hasDualAxis ? yAxisIndex : undefined,
          barWidth: options?.barWidth,
          barCategoryGap: options?.barCategoryGap,
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          itemStyle: seriesColor ? { color: seriesColor, borderRadius: [2, 2, 0, 0] } : { borderRadius: [2, 2, 0, 0] },
          label: finalLabel,
        }
      }),
    }
  }

  if (type === 'bar' || type === 'column' || type === 'line' || type === 'area') {
    const isVertical = type !== 'bar'
    const chartSeriesType = type === 'line' ? 'line' : type === 'area' ? 'line' : 'bar'

    return {
      ...animationSettings,
      color: palette,
      textStyle,
      legend,
      grid: {
        containLabel: true,
        ...gridPadding,
      },
      xAxis: isVertical ? xAxis : yLeftAxis,
      yAxis: isVertical ? yLeftAxis : xAxis,
      series: (data.series as any[]).map((s, idx) => {
        const seriesColor = data.seriesColors?.[idx]
        if (chartSeriesType === 'line') {
          return {
            type: 'line',
            name: data.legends[idx],
            data: s,
            smooth: options?.lineSmooth ?? false,
            ...(type === 'area' ? { areaStyle: {} } : {}),
            itemStyle: seriesColor ? { color: seriesColor } : undefined,
            lineStyle: {
              ...(seriesColor ? { color: seriesColor } : {}),
              width: options?.seriesStrokeWidths?.[idx] ?? 2,
              type: options?.seriesStrokeStyles?.[idx] ?? 'solid',
            },
            label: {
              ...baseLabel,
              position: normalizeLineLabelPosition(options?.dataLabelPosition),
              formatter: (params: any) => formatNumericText(getNumericValue(params?.value), options?.dataLabelValueFormat),
            },
          }
        }

        const usePointColorsForSingleBarSeries = data.series.length === 1 && Array.isArray(data.dataColors) && data.dataColors.length > 0
        const barData =
          usePointColorsForSingleBarSeries
            ? (s as any[]).map((v, i) => ({
                value: v,
                itemStyle: data.dataColors?.[i] ? { color: data.dataColors[i] } : undefined,
              }))
            : s

        return {
          type: 'bar',
          name: data.legends[idx],
          data: barData,
          stack: options?.stack || options?.percentStack ? 'A' : undefined,
          barWidth: options?.barWidth,
          barCategoryGap: options?.barCategoryGap,
          itemStyle: seriesColor ? { color: seriesColor, borderRadius: [2, 2, 0, 0] } : { borderRadius: [2, 2, 0, 0] },
          label: {
            ...baseLabel,
            position: normalizeBarLabelPosition(options?.dataLabelPosition, isVertical),
            formatter: (params: any) => {
              const n = getNumericValue(params?.value)
              if (!options?.dataLabelShowPercent) return formatNumericText(n, options?.dataLabelValueFormat)
              const total = stackedIndexTotals[params?.dataIndex] || 0
              const percent = total > 0 ? n / total : null
              return formatValueWithPercent(
                formatNumericText(n, options?.dataLabelValueFormat),
                percent,
                options?.dataLabelPercentPlacement,
                options?.dataLabelPercentDecimals
              )
            },
          },
        }
      }),
    }
  }

  if (type === 'radar') {
    return {
      ...animationSettings,
      color: palette,
      textStyle,
      legend,
      grid: {
        containLabel: true,
        ...gridPadding,
      },
      radar: {
        indicator: data.labels.map((label, idx) => ({
          name: label,
          max: (data.series[0] as any[])[idx],
        })),
      },
      series: [
        {
          type: 'radar',
          data: data.series.map((item: any, index: number) => ({
            value: item,
            name: data.legends[index],
            ...(data.seriesColors && data.seriesColors[index] ? { itemStyle: { color: data.seriesColors[index] } } : {}),
          })),
        },
      ],
    }
  }

  return null
}

