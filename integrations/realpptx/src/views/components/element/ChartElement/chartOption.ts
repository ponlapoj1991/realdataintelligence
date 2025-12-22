import type { ComposeOption } from 'echarts/core'
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  RadarSeriesOption,
} from 'echarts/charts'
import type { ChartData, ChartType } from '@/types/slides'

type EChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | RadarSeriesOption>

export interface ChartOptionPayload {
  type: ChartType
  data: ChartData
  themeColors: string[]
  textColor?: string
  lineColor?: string
  // Series/stack
  lineSmooth?: boolean
  stack?: boolean
  percentStack?: boolean
  subType?: 'clustered' | 'stacked' | 'percentStacked' | 'scatter' | 'bubble'
  seriesTypes?: ('bar' | 'line' | 'area')[]
  yAxisIndexes?: number[]
  pointSizes?: number[]
  orientation?: 'vertical' | 'horizontal'
  barWidth?: number
  barCategoryGap?: string

  // Labels
  showDataLabels?: boolean
  dataLabelPosition?: 'top' | 'inside' | 'outside' | 'center'
  dataLabelFontSize?: number
  dataLabelFontWeight?: 'normal' | 'bold'
  dataLabelColor?: string
  dataLabelValueFormat?: 'auto' | 'text' | 'number' | 'compact' | 'accounting'
  dataLabelShowCategoryName?: boolean
  dataLabelShowPercent?: boolean
  dataLabelPercentDecimals?: number
  dataLabelPercentPlacement?: 'prefix' | 'suffix'

  // Legend
  legendEnabled?: boolean
  legendPosition?: 'top' | 'bottom' | 'left' | 'right'
  legendAlign?: 'left' | 'center' | 'right'
  legendFontSize?: number
  legendFontColor?: string

  // Axis
  axisTitle?: { x?: string; yLeft?: string; yRight?: string }
  axisRange?: { xMin?: number; xMax?: number; yLeftMin?: number; yLeftMax?: number; yRightMin?: number; yRightMax?: number }
  axisLabelFontSize?: number
  axisLabelColor?: string
  axisLabelSlant?: 0 | 45 | 90
  axisGridShow?: boolean
  axisGridColor?: string

  // Pie/Ring
  pieInnerRadius?: number
  pieStartAngle?: number
}

const formatNumericText = (
  value: number,
  mode?: 'auto' | 'text' | 'number' | 'compact' | 'accounting'
) => {
  if (!Number.isFinite(value)) return '0'
  switch (mode) {
    case 'text':
      return String(value)
    case 'number':
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
    case 'compact':
      return new Intl.NumberFormat(undefined, {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1,
      }).format(value)
    case 'accounting':
      return new Intl.NumberFormat(undefined, {
        useGrouping: true,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value)
    case 'auto':
    default:
      return String(value)
  }
}

const buildColoredSeriesData = (values: number[], colors?: string[], fallback?: string[]) => {
  if (!colors || colors.length === 0) return values
  return values.map((value, index) => ({
    value,
    itemStyle: {
      color: colors[index] || (fallback && fallback[index % fallback.length]) || colors[colors.length - 1],
    },
  }))
}

const buildLabel = ({
  showDataLabels,
  dataLabelPosition,
  dataLabelFontSize,
  dataLabelFontWeight,
  dataLabelColor,
  formatter,
}: {
  showDataLabels?: boolean
  dataLabelPosition?: 'top' | 'inside' | 'outside' | 'center'
  dataLabelFontSize?: number
  dataLabelFontWeight?: 'normal' | 'bold'
  dataLabelColor?: string
  formatter?: any
}) => ({
  show: showDataLabels !== false,
  position: dataLabelPosition || 'top',
  ...(dataLabelFontSize ? { fontSize: dataLabelFontSize } : {}),
  ...(dataLabelFontWeight ? { fontWeight: dataLabelFontWeight } : {}),
  ...(dataLabelColor ? { color: dataLabelColor } : {}),
  ...(formatter ? { formatter } : {}),
})

const buildPieLabel = ({
  showDataLabels,
  dataLabelPosition,
  dataLabelFontSize,
  dataLabelFontWeight,
  dataLabelColor,
  dataLabelValueFormat,
  dataLabelShowCategoryName,
  dataLabelShowPercent,
  dataLabelPercentDecimals,
  dataLabelPercentPlacement,
  textColor,
}: {
  showDataLabels?: boolean
  dataLabelPosition?: 'top' | 'inside' | 'outside' | 'center'
  dataLabelFontSize?: number
  dataLabelFontWeight?: 'normal' | 'bold'
  dataLabelColor?: string
  dataLabelValueFormat?: ChartOptionPayload['dataLabelValueFormat']
  dataLabelShowCategoryName?: boolean
  dataLabelShowPercent?: boolean
  dataLabelPercentDecimals?: number
  dataLabelPercentPlacement?: ChartOptionPayload['dataLabelPercentPlacement']
  textColor?: string
}) => {
  const formatter = (params: any) => {
    const raw = typeof params.value === 'object' ? params.value?.value : params.value
    const val = typeof raw === 'number' ? raw : Number(raw) || 0
    const baseValue = formatNumericText(val, dataLabelValueFormat)
    const withName = dataLabelShowCategoryName && params?.name ? `${params.name}: ${baseValue}` : baseValue
    if (!dataLabelShowPercent) return withName
    const percent = typeof params.percent === 'number' ? params.percent : 0
    const percentText = `${percent.toFixed(dataLabelPercentDecimals ?? 0)}%`
    const placement = dataLabelPercentPlacement || 'suffix'
    return placement === 'prefix' ? `${percentText} ${withName}`.trim() : `${withName} (${percentText})`
  }
  return {
    show: showDataLabels !== false,
    position: dataLabelPosition || 'outside',
    ...(dataLabelFontSize ? { fontSize: dataLabelFontSize } : {}),
    ...(dataLabelFontWeight ? { fontWeight: dataLabelFontWeight } : {}),
    ...(dataLabelColor ? { color: dataLabelColor } : textColor ? { color: textColor } : {}),
    ...(showDataLabels !== false ? { formatter } : {}),
  }
}

const clampPercent = (val: number | undefined, fallback: number) => {
  if (val === undefined || Number.isNaN(val)) return `${fallback}%`
  return `${Math.max(0, Math.min(100, val))}%`
}

const normalizeBarLabelPosition = (pos: ChartOptionPayload['dataLabelPosition'] | undefined, isVertical: boolean) => {
  if (!pos) return isVertical ? 'top' : 'right'
  if (pos === 'center') return 'inside'
  if (pos === 'outside') return isVertical ? 'top' : 'right'
  return pos
}

const normalizeLineLabelPosition = (pos: ChartOptionPayload['dataLabelPosition'] | undefined) => {
  if (pos === 'center') return 'top'
  if (pos === 'outside') return 'top'
  return (pos || 'top') as 'top' | 'inside'
}

const getChartOptionLegacy = ({
  type,
  data,
  themeColors,
  textColor,
  lineColor,
  lineSmooth,
  stack,
  percentStack,
  subType,
  seriesTypes,
  yAxisIndexes,
  pointSizes,
  orientation,
  barWidth,
  barCategoryGap,
  // labels
  showDataLabels,
  dataLabelPosition,
  dataLabelFontSize,
  dataLabelFontWeight,
  dataLabelColor,
  dataLabelValueFormat,
  dataLabelShowCategoryName,
  dataLabelShowPercent,
  dataLabelPercentDecimals,
  dataLabelPercentPlacement,
  // legend
  legendEnabled,
  legendPosition,
  legendAlign,
  legendFontSize,
  legendFontColor,
  // axis
  axisTitle,
  axisRange,
  axisLabelFontSize,
  axisLabelColor,
  axisLabelSlant,
  axisGridShow,
  axisGridColor,
  // pie
  pieInnerRadius,
  pieStartAngle,
}: ChartOptionPayload): EChartOption | null => {

  // Logic: Calculate totals for percent stacking or showPercent
  const categoryTotals: number[] = new Array(data.labels.length).fill(0)

  // Always calculate totals if possible, to be safe
  for (let i = 0; i < data.labels.length; i++) {
    let sum = 0
    for (const s of data.series) {
      const val = s[i]
      const numeric = typeof val === 'object' ? (val as any)?.value : val
      if (typeof numeric === 'number') sum += numeric
    }
    categoryTotals[i] = sum
  }

  const commonFormatter = (params: any) => {
    // If show percent is OFF, just return value
    if (!dataLabelShowPercent) {
      const val = params.value
      const numericVal = typeof val === 'object' ? (val as any)?.value : val
      if (percentStack || subType === 'percentStacked') {
        const ratio = typeof numericVal === 'number' ? numericVal : (Number(numericVal) || 0)
        return `${(ratio * 100).toFixed(dataLabelPercentDecimals ?? 0)}%`
      }
      return typeof val === 'object' ? (val as any)?.value : val
    }

    // If Pie/Ring/Radar (ECharts handles percent for Pie usually, but let's be explicit)
    if (params.seriesType === 'pie' || params.seriesType === 'ring' || params.seriesType === 'radar') {
      const percent = params.percent
      if (typeof percent === 'number') return `${percent.toFixed(dataLabelPercentDecimals ?? 0)}%`
      return params.value
    }

    // For Bar/Line (Manual calculation)
    if (params.componentType === 'series' && (params.seriesType === 'bar' || params.seriesType === 'line')) {
      const idx = params.dataIndex
      const val = params.value
      const numericVal = typeof val === 'object' ? (val as any)?.value : val

      const total = categoryTotals[idx]
      if (total === 0) return '0%'
      const p = (numericVal / total) * 100
      return `${p.toFixed(dataLabelPercentDecimals ?? 0)}%`
    }

    return params.value
  }

  const textStyle = textColor ? { color: textColor } : {}

  const axisLine = textColor
    ? { lineStyle: { color: textColor } }
    : undefined

  const axisLabel = {
    ...(axisLabelColor ? { color: axisLabelColor } : textColor ? { color: textColor } : {}),
    ...(axisLabelFontSize ? { fontSize: axisLabelFontSize } : { fontSize: 12 }), // Default font size
    ...(axisLabelSlant ? { rotate: axisLabelSlant } : {}),
  }

  const splitLine = {
    show: axisGridShow !== undefined ? axisGridShow : true,
    lineStyle: { color: axisGridColor || lineColor },
  }

  // Build legend with configurable position and text style
  const legendPos = legendPosition || 'bottom'
  const legendLayout =
    legendPos === 'left' || legendPos === 'right'
      ? { orient: 'vertical' as const, [legendPos]: 10, top: 'middle' }
      : { [legendPos]: legendPos === 'top' ? 10 : 10 }
  const legendTextStyle = {
    ...(legendFontSize ? { fontSize: legendFontSize } : {}),
    ...(legendFontColor ? { color: legendFontColor } : textStyle),
  }
  const legendAlignProps =
    legendPos === 'top' || legendPos === 'bottom'
      ? { align: legendAlign || 'left' }
      : {}
  const shouldShowLegend =
    legendEnabled !== false &&
    ((type === 'pie' || type === 'ring') ? (data.labels?.length || 0) > 1 : data.series.length > 1)
  const legend = shouldShowLegend
    ? {
        ...legendLayout,
        textStyle: legendTextStyle,
        ...legendAlignProps,
      }
    : undefined

  const palette = data.seriesColors && data.seriesColors.length ? data.seriesColors : themeColors
  // Always attach formatter to label config so it can switch modes dynamically
  const labelCfg = buildLabel({
    showDataLabels,
    dataLabelPosition,
    dataLabelFontSize,
    dataLabelFontWeight,
    dataLabelColor,
    formatter: commonFormatter
  })

  if (type === 'bar' || type === 'column') {
    const defaultOrientation = type === 'column' ? 'vertical' : 'horizontal'
    const resolvedOrientation = orientation || defaultOrientation
    const isVertical = resolvedOrientation === 'vertical'

    const categoryAxis = {
      type: 'category' as const,
      data: data.labels,
      axisLine,
      axisLabel,
      name: axisTitle?.x,
      triggerEvent: true,
    }

    const valueAxis = {
      type: 'value' as const,
      axisLine,
      axisLabel: (percentStack || subType === 'percentStacked')
        ? { ...axisLabel, formatter: (v: any) => `${Math.round((Number(v) || 0) * 100)}%` }
        : axisLabel,
      splitLine,
      name: axisTitle?.yLeft,
      min: (percentStack || subType === 'percentStacked') ? 0 : axisRange?.yLeftMin,
      max: (percentStack || subType === 'percentStacked') ? 1 : axisRange?.yLeftMax,
      triggerEvent: true,
    }

    const borderRadius: [number, number, number, number] = isVertical
      ? [2, 2, 0, 0]
      : [0, 2, 2, 0]

    return {
      color: palette,
      textStyle,
      legend,
      xAxis: isVertical
        ? categoryAxis
        : {
          ...valueAxis,
          name: axisTitle?.x,
          min: axisRange?.xMin ?? ((percentStack || subType === 'percentStacked') ? 0 : valueAxis.min),
          max: axisRange?.xMax ?? ((percentStack || subType === 'percentStacked') ? 1 : valueAxis.max),
        },
      yAxis: isVertical
        ? {
          ...valueAxis,
          min: axisRange?.yLeftMin ?? valueAxis.min,
          max: axisRange?.yLeftMax ?? valueAxis.max,
        }
        : {
          ...categoryAxis,
          name: axisTitle?.yLeft,
        },
      series: data.series.map((item, index) => {
        const seriesItem: BarSeriesOption = {
          data: data.series.length === 1
            ? buildColoredSeriesData(item, data.dataColors, palette)
            : item,
          name: data.legends[index],
          type: 'bar',
          label: {
            ...(labelCfg as BarSeriesOption['label']),
            position: normalizeBarLabelPosition(dataLabelPosition, isVertical),
          },
          itemStyle: {
            borderRadius,
            ...(data.series.length > 1 && data.seriesColors && data.seriesColors[index]
              ? { color: data.seriesColors[index] }
              : {}),
          },
        }
        if (stack || percentStack || subType === 'stacked' || subType === 'percentStacked') seriesItem.stack = 'A'
        if (barWidth) seriesItem.barWidth = barWidth
        if (barCategoryGap) seriesItem.barCategoryGap = barCategoryGap
        return seriesItem
      }),
    }
  }
  if (type === 'line') {
    return {
      color: palette,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLine,
        axisLabel,
        name: axisTitle?.x,
        min: axisRange?.xMin,
        max: axisRange?.xMax,
        triggerEvent: true,
      },
      yAxis: {
        type: 'value',
        axisLine,
        axisLabel,
        splitLine,
        name: axisTitle?.yLeft,
        min: axisRange?.yLeftMin ?? ((percentStack || subType === 'percentStacked') ? 0 : undefined),
        max: axisRange?.yLeftMax ?? ((percentStack || subType === 'percentStacked') ? 1 : undefined),
        triggerEvent: true,
      },
      series: data.series.map((item, index) => {
        const seriesItem: LineSeriesOption = {
          data: data.series.length === 1
            ? buildColoredSeriesData(item, data.dataColors, palette)
            : item,
          name: data.legends[index],
          type: 'line',
          smooth: lineSmooth,
          label: {
            ...labelCfg,
            position: normalizeLineLabelPosition(dataLabelPosition),
          },
          ...(data.series.length > 1 && data.seriesColors && data.seriesColors[index]
            ? { itemStyle: { color: data.seriesColors[index] } }
            : {}),
        }
        if (stack || percentStack || subType === 'stacked' || subType === 'percentStacked') seriesItem.stack = 'A'
        return seriesItem
      }),
    }
  }
  if (type === 'pie') {
    const pieLabel = buildPieLabel({
      showDataLabels,
      dataLabelPosition,
      dataLabelFontSize,
      dataLabelFontWeight,
      dataLabelColor,
      dataLabelValueFormat,
      dataLabelShowCategoryName,
      dataLabelShowPercent,
      dataLabelPercentDecimals,
      dataLabelPercentPlacement,
      textColor,
    })
    const inner = pieInnerRadius !== undefined ? clampPercent(pieInnerRadius, 0) : undefined
    return {
      color: palette,
      textStyle,
      legend,
      series: [
        {
          data: data.series[0].map((item, index) => ({
            value: item,
            name: data.labels[index],
            itemStyle: {
              color: (data.dataColors && data.dataColors[index]) || palette[index % palette.length],
            },
          })),
          label: pieLabel as PieSeriesOption['label'],
          type: 'pie',
          radius: inner ? [inner, '70%'] as PieSeriesOption['radius'] : '70%',
          startAngle: pieStartAngle ?? 0,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
            label: {
              show: true,
              fontSize: dataLabelFontSize ?? 14,
              fontWeight: dataLabelFontWeight ?? 'bold',
            },
          },
        }
      ],
    }
  }
  if (type === 'ring') {
    const pieLabel = buildPieLabel({
      showDataLabels,
      dataLabelPosition,
      dataLabelFontSize,
      dataLabelFontWeight,
      dataLabelColor,
      dataLabelValueFormat,
      dataLabelShowCategoryName,
      dataLabelShowPercent,
      dataLabelPercentDecimals,
      dataLabelPercentPlacement,
      textColor,
    })
    const inner = clampPercent(pieInnerRadius, 40)
    return {
      color: palette,
      textStyle,
      legend,
      series: [
        {
          data: data.series[0].map((item, index) => ({
            value: item,
            name: data.labels[index],
            itemStyle: {
              color: (data.dataColors && data.dataColors[index]) || palette[index % palette.length],
            },
          })),
          label: pieLabel as PieSeriesOption['label'],
          type: 'pie',
          radius: [inner, '70%'],
          startAngle: pieStartAngle ?? 0,
          padAngle: 1,
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: dataLabelFontSize ?? 14,
              fontWeight: dataLabelFontWeight ?? 'bold'
            },
          },
        }
      ],
    }
  }
  if (type === 'area') {
    return {
      color: palette,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.labels,
        axisLine,
        axisLabel,
        name: axisTitle?.x,
        min: axisRange?.xMin,
        max: axisRange?.xMax,
        triggerEvent: true,
      },
      yAxis: {
        type: 'value',
        axisLine,
        axisLabel: (percentStack || subType === 'percentStacked')
          ? { ...axisLabel, formatter: (v: any) => `${Math.round((Number(v) || 0) * 100)}%` }
          : axisLabel,
        splitLine,
        name: axisTitle?.yLeft,
        min: axisRange?.yLeftMin ?? ((percentStack || subType === 'percentStacked') ? 0 : undefined),
        max: axisRange?.yLeftMax ?? ((percentStack || subType === 'percentStacked') ? 1 : undefined),
        triggerEvent: true,
      },
      series: data.series.map((item, index) => {
        const seriesItem: LineSeriesOption = {
          data: data.series.length === 1
            ? buildColoredSeriesData(item, data.dataColors, palette)
            : item,
          name: data.legends[index],
          type: 'line',
          areaStyle: {},
          label: {
            ...labelCfg,
            position: (dataLabelPosition === 'outside' ? 'top' : dataLabelPosition) as 'top' | 'inside',
          },
          ...(data.series.length > 1 && data.seriesColors && data.seriesColors[index]
            ? { itemStyle: { color: data.seriesColors[index] } }
            : {}),
        }
        if (stack || percentStack || subType === 'stacked' || subType === 'percentStacked') seriesItem.stack = 'A'
        return seriesItem
      }),
    }
  }
  if (type === 'radar') {
    return {
      color: palette,
      textStyle,
      legend,
      radar: {
        indicator: data.labels.map(item => ({ name: item })),
        splitLine,
        axisLine: lineColor ? {
          lineStyle: {
            color: lineColor,
          }
        } : undefined,
      },
      series: [
        {
          data: data.series.map((item, index) => ({
            value: item,
            name: data.legends[index],
            ...(data.seriesColors && data.seriesColors[index] ? { itemStyle: { color: data.seriesColors[index] } } : {}),
          })),
          type: 'radar',
          ...(data.seriesColors && data.seriesColors.length ? { color: data.seriesColors } : {}),
        },
      ],
    }
  }
  if (type === 'scatter') {
    const formatedData = []
    for (let i = 0; i < data.series[0].length; i++) {
      const x = data.series[0][i]
      const y = data.series[1] ? data.series[1][i] : x
      formatedData.push([x, y])
    }

    const clampSize = (val: number) => Math.max(4, Math.min(32, val))

    return {
      color: palette,
      textStyle,
      xAxis: {
        axisLine,
        axisLabel,
        splitLine,
        name: axisTitle?.x,
        min: axisRange?.xMin,
        max: axisRange?.xMax,
        triggerEvent: true,
      },
      yAxis: {
        axisLine,
        axisLabel,
        splitLine,
        name: axisTitle?.yLeft,
        min: axisRange?.yLeftMin,
        max: axisRange?.yLeftMax,
        triggerEvent: true,
      },
      series: [
        {
          symbolSize: (val: number[], params: { dataIndex: number }) => {
            if (!pointSizes || pointSizes[params.dataIndex] === undefined) return 12
            return clampSize(pointSizes[params.dataIndex])
          },
          data: formatedData,
          type: 'scatter',
        }
      ],
    }
  }
  if (type === 'combo') {
    const resolvedSeriesTypes =
      seriesTypes && seriesTypes.length === data.series.length
        ? seriesTypes
        : data.series.map(() => 'bar')

    const hasDualAxis = yAxisIndexes && yAxisIndexes.some(idx => idx === 1)

    const yAxisConfig = hasDualAxis ? [
      {
        type: 'value' as const,
        name: axisTitle?.yLeft,
        axisLine,
        axisLabel: percentStack
          ? { ...axisLabel, formatter: (v: any) => `${Math.round((Number(v) || 0) * 100)}%` }
          : axisLabel,
        splitLine,
        min: axisRange?.yLeftMin ?? (percentStack ? 0 : undefined),
        max: axisRange?.yLeftMax ?? (percentStack ? 1 : undefined),
        triggerEvent: true,
      },
      {
        type: 'value' as const,
        name: axisTitle?.yRight,
        axisLine,
        axisLabel,
        splitLine: { show: false },
        min: axisRange?.yRightMin,
        max: axisRange?.yRightMax,
        triggerEvent: true,
      }
    ] : {
      type: 'value' as const,
      name: axisTitle?.yLeft,
      axisLine,
      axisLabel: percentStack
        ? { ...axisLabel, formatter: (v: any) => `${Math.round((Number(v) || 0) * 100)}%` }
        : axisLabel,
      splitLine,
      min: axisRange?.yLeftMin ?? (percentStack ? 0 : undefined),
      max: axisRange?.yLeftMax ?? (percentStack ? 1 : undefined),
      triggerEvent: true,
    }

    return {
      color: palette,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        name: axisTitle?.x,
        data: data.labels,
        axisLine,
        axisLabel,
        min: axisRange?.xMin,
        max: axisRange?.xMax,
        triggerEvent: true,
      },
      yAxis: yAxisConfig,
      series: data.series.map((item, index) => {
        const seriesType = resolvedSeriesTypes[index] || 'bar'
        const yAxisIndex = yAxisIndexes?.[index] ?? 0
        const resolvedLabelPos: 'top' | 'inside' =
          dataLabelPosition === 'inside' ? 'inside' : 'top'
        const coloredSeriesData =
          data.series.length === 1
            ? buildColoredSeriesData(item, data.dataColors, palette)
            : item

        if (seriesType === 'line' || seriesType === 'area') {
          const lineSeries: LineSeriesOption = {
            data: coloredSeriesData,
            name: data.legends[index],
            type: 'line',
            smooth: lineSmooth,
            yAxisIndex: hasDualAxis ? yAxisIndex : undefined,
            label: {
              ...labelCfg,
              position: resolvedLabelPos,
            },
            ...(data.seriesColors && data.seriesColors[index]
              ? { itemStyle: { color: data.seriesColors[index] } }
              : {}),
          }
          if (seriesType === 'area') {
            lineSeries.areaStyle = {}
          }
          return lineSeries
        }
        const barSeries: BarSeriesOption = {
          data: coloredSeriesData,
          name: data.legends[index],
          type: 'bar',
          yAxisIndex: hasDualAxis ? yAxisIndex : undefined,
          label: {
            ...labelCfg,
            position: resolvedLabelPos === 'inside' ? 'inside' : 'top',
          },
          itemStyle: {
            borderRadius: [2, 2, 0, 0],
            ...(data.seriesColors && data.seriesColors[index]
              ? { color: data.seriesColors[index] }
              : {}),
          },
        }
        if (stack || percentStack) barSeries.stack = 'A'
        return barSeries
      }),
    }
  }

  return null
}

export const getChartOption = (payload: ChartOptionPayload): EChartOption | null => {
  return getChartOptionLegacy(payload)
}
