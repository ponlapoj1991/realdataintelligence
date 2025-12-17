import type pptxgen from 'pptxgenjs'
import tinycolor from 'tinycolor2'
import type { PPTChartElement } from '@/types/slides'

export type FormatColorResult = { alpha: number; color: string }
export type FormatColorFn = (color: string) => FormatColorResult

export function addChartElementToSlide(params: {
  pptx: pptxgen
  pptxSlide: any
  el: PPTChartElement
  ratioPx2Inch: number
  ratioPx2Pt: number
  formatColor: FormatColorFn
}) {
  const { pptx, pptxSlide, el, ratioPx2Inch, ratioPx2Pt, formatColor } = params

  const asFiniteNumber = (value: any, fallback = 0) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const clampNonNegative = (value: any, fallback = 0) => {
    return Math.max(0, asFiniteNumber(value, fallback))
  }

  const normalizeLabels = (labels: any[]) => {
    return (Array.isArray(labels) ? labels : []).map(v => (v === null || v === undefined) ? '' : String(v))
  }

  const normalizeSeries = (series: any[]) => {
    const src = Array.isArray(series) ? series : []
    return src.map(row => {
      const arr = Array.isArray(row) ? row : []
      return arr.map(v => (v === null || v === undefined || v === '') ? 0 : asFiniteNumber(v, 0))
    })
  }

  // Normalize & validate chart payload first to avoid invalid OOXML (NaN/undefined/null)
  const labels = normalizeLabels(el.data?.labels || [])
  const series = normalizeSeries(el.data?.series || [])
  const legends = Array.isArray(el.data?.legends) ? el.data.legends.map(v => (v === null || v === undefined) ? '' : String(v)) : []

  if (!series.length) return

  const normalizeHexInput = (input: string) => {
    if (!input) return '#000000'
    const trimmed = input.trim()
    return /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed
  }

  // PPTX chart expects HEX without "#", and some internal paths (data-point colors) do not strip "#"
  const toPptxHex = (input: string) => {
    const c = formatColor(normalizeHexInput(input))
    return c.color.replace('#', '').toUpperCase()
  }

  const buildThemePalette = (colors: string[]) => {
    let palette: string[] = []

    if (colors.length >= 10) palette = colors.slice()
    else if (colors.length === 1) palette = tinycolor(colors[0]).analogous(10).map(color => color.toHexString())
    else if (colors.length > 1) {
      const len = colors.length
      const supplement = tinycolor(colors[len - 1]).analogous(10 + 1 - len).map(color => color.toHexString())
      palette = [...colors.slice(0, len - 1), ...supplement]
    }
    else palette = ['#000000']

    return palette.map(color => toPptxHex(color))
  }

  const themePalette = buildThemePalette(el.themeColors || [])

  // On-screen palette logic: `seriesColors` (if provided) overrides theme palette
  const seriesPalette = (() => {
    const seriesColors = (el.data.seriesColors || []).filter(Boolean).map(color => toPptxHex(color))
    return seriesColors.length ? seriesColors : themePalette.length ? themePalette : ['000000']
  })()

  const dataColors = (el.data?.dataColors || []).filter(Boolean).map(color => toPptxHex(color))
  const fallbackPalette = seriesPalette.length ? seriesPalette : themePalette.length ? themePalette : ['000000']

  const resolveDataPointColor = (index: number) => {
    const direct = dataColors[index]
    if (direct) return direct
    if (fallbackPalette.length) return fallbackPalette[index % fallbackPalette.length] || fallbackPalette[0]
    return dataColors[dataColors.length - 1] || '000000'
  }

  const pointCount = Math.max(labels.length, series[0]?.length || 0)

  const isPieLike = el.chartType === 'pie' || el.chartType === 'ring'
  const isBarLike = el.chartType === 'bar' || el.chartType === 'column'
  const isScatter = el.chartType === 'scatter'
  const isCombo = el.chartType === 'combo'

  // Font scaling (match on-screen shrink behavior: shrink only)
  const BASE_CHART_SIZE = 400
  const minSide = Math.max(1, Math.min(asFiniteNumber(el.width, BASE_CHART_SIZE), asFiniteNumber(el.height, BASE_CHART_SIZE)))
  const rawScale = minSide / BASE_CHART_SIZE
  const fontScale = Math.round(Math.min(1, rawScale) * 100) / 100
  const scaleFontPx = (px: number) => Math.max(6, Math.round(px * fontScale))
  const pxToPt = (px: number) => px / ratioPx2Pt

  const axisTextColor = toPptxHex(el.options?.axisLabelColor || el.textColor || '#000000')
  const gridColor = toPptxHex(el.options?.axisGridColor || el.lineColor || '#D9D9D9')

  const defaultOrientation = el.chartType === 'column' ? 'vertical' : el.chartType === 'bar' ? 'horizontal' : undefined
  const resolvedOrientation = el.options?.orientation || defaultOrientation
  const resolvedBarDir = resolvedOrientation === 'horizontal' ? 'bar' : 'col'

  const mapLegendPos = (pos?: 'top' | 'bottom' | 'left' | 'right') => {
    if (pos === 'top') return 't'
    if (pos === 'left') return 'l'
    if (pos === 'right') return 'r'
    return 'b'
  }

  const mapDataLabelPosForBar = (pos: any) => {
    // pptx: 'inEnd' | 'outEnd' | 'ctr' | 'inBase' | ...
    if (pos === 'inside') return 'inEnd'
    if (pos === 'center') return 'ctr'
    if (pos === 'outside') return 'outEnd'
    if (pos === 'top') return 'outEnd'
    return undefined
  }

  const mapDataLabelPosForLine = (pos: any) => {
    // pptx: 't' | 'b' | 'l' | 'r' | 'ctr'
    if (pos === 'center') return 'ctr'
    if (pos === 'inside') return 'ctr'
    if (pos === 'outside') return 't'
    if (pos === 'top') return 't'
    return undefined
  }

  const mapDataLabelPosForPie = (pos: any) => {
    // pptx: 'bestFit' | 'ctr' | 'inEnd' | 'outEnd'
    if (pos === 'inside') return 'inEnd'
    if (pos === 'center') return 'ctr'
    if (pos === 'outside') return 'outEnd'
    if (pos === 'top') return 'outEnd'
    return undefined
  }

  const showDataLabels = el.options?.showDataLabels !== false
  const dataLabelFontSizePx = scaleFontPx(el.options?.dataLabelFontSize ?? 12)
  const dataLabelColor = toPptxHex(el.options?.dataLabelColor || axisTextColor)
  const dataLabelBold = el.options?.dataLabelFontWeight === 'bold'

  const axisFontSizePx = scaleFontPx(el.options?.axisLabelFontSize ?? 12)

  const x = clampNonNegative(el.left) / ratioPx2Inch
  const y = clampNonNegative(el.top) / ratioPx2Inch
  const w = clampNonNegative(el.width) / ratioPx2Inch
  const h = clampNonNegative(el.height) / ratioPx2Inch
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return
  if (w <= 0 || h <= 0) return

  const options: pptxgen.IChartOpts = {
    x,
    y,
    w,
    h,
    chartColors: ['000000'], // overwritten below
  }

  // chartColors (series or data-point based)
  const hasPerPointColors = dataColors.length > 1
  if (isPieLike) {
    options.chartColors = Array.from({ length: pointCount }, (_, idx) => resolveDataPointColor(idx))
  }
  else if (isBarLike && el.data.series.length === 1 && hasPerPointColors) {
    options.chartColors = Array.from({ length: pointCount }, (_, idx) => resolveDataPointColor(idx))
  }
  else if (isScatter) {
    options.chartColors = fallbackPalette.slice(0, Math.max(1, el.data.series.length - 1))
  }
  else if (isCombo) {
    // set later after multi chart build (order-sensitive)
    options.chartColors = fallbackPalette.slice()
  }
  else {
    options.chartColors = fallbackPalette.slice(0, Math.max(1, el.data.series.length))
  }

  // Axis text
  options.catAxisLabelColor = axisTextColor
  options.valAxisLabelColor = axisTextColor
  options.catAxisLabelFontSize = pxToPt(axisFontSizePx)
  options.valAxisLabelFontSize = pxToPt(axisFontSizePx)

  // Gridlines (match on-screen defaults)
  if (el.options?.axisGridShow === false) {
    options.valGridLine = { style: 'none' }
    if (isScatter) options.catGridLine = { style: 'none' }
  }
  else {
    options.valGridLine = { color: gridColor, size: 1, style: 'solid' }
    if (isScatter) options.catGridLine = { color: gridColor, size: 1, style: 'solid' }
  }

  // Plot area styles
  if (el.fill || el.outline) {
    const plotArea: pptxgen.IChartPropsFillLine = {}
    if (el.fill) {
      const c = formatColor(el.fill)
      plotArea.fill = { color: toPptxHex(c.color), transparency: (1 - c.alpha) * 100 }
    }
    if (el.outline) {
      plotArea.border = {
        pt: el.outline.width! / ratioPx2Pt,
        color: toPptxHex(el.outline.color!),
      }
    }
    options.plotArea = plotArea
  }

  // Legend
  const legendEnabled = el.options?.legendEnabled !== false
  const shouldShowLegend = legendEnabled && el.data.series.length > 1 && !isScatter
  if (shouldShowLegend) {
    options.showLegend = true
    options.legendPos = mapLegendPos(el.options?.legendPosition)
    options.legendColor = toPptxHex(el.options?.legendFontColor || axisTextColor)
    options.legendFontSize = pxToPt(scaleFontPx(el.options?.legendFontSize ?? 12))
  }

  // Data labels
  if (['bar', 'column', 'line', 'area', 'pie', 'ring'].includes(el.chartType)) {
    options.dataLabelColor = dataLabelColor
    options.dataLabelFontSize = pxToPt(dataLabelFontSizePx)
    options.dataLabelFontBold = dataLabelBold

    if (el.chartType === 'bar' || el.chartType === 'column') {
      options.showValue = showDataLabels
      const mapped = mapDataLabelPosForBar(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
    }
    else if (el.chartType === 'line' || el.chartType === 'area') {
      options.showValue = showDataLabels
      const mapped = mapDataLabelPosForLine(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
      if (el.options?.lineSmooth) options.lineSmooth = true
    }
    else if (isPieLike) {
      const showPercent = showDataLabels && !!el.options?.dataLabelShowPercent
      options.showPercent = showPercent
      options.showValue = showDataLabels && !showPercent

      const decimals = el.options?.dataLabelPercentDecimals
      if (showPercent && typeof decimals === 'number') {
        options.dataLabelFormatCode = `0.${'0'.repeat(Math.max(0, decimals))}%`
      }

      const mapped = mapDataLabelPosForPie(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
    }
  }

  // Build data payloads
  const chartData: any[] = []
  if (isScatter) {
    const xValues = (series[0] || []).map(v => asFiniteNumber(v, 0))
    const ySeries = series.slice(1)
    if (!xValues.length || !ySeries.length) return

    chartData.push({ name: 'X', values: xValues })
    for (let i = 0; i < ySeries.length; i++) {
      chartData.push({
        name: legends?.[i] || `Series ${i + 1}`,
        values: (ySeries[i] || []).map(v => asFiniteNumber(v, 0)),
      })
    }
  }
  else {
    if (!labels.length) {
      // PowerPoint needs category labels; synthesize stable labels if missing
      const maxLen = Math.max(1, ...series.map(s => s.length))
      for (let i = 0; i < maxLen; i++) labels.push(`${i + 1}`)
    }

    // Pad/truncate values to match label length for OOXML stability
    const normalizedLabels = labels.slice()
    const targetLen = normalizedLabels.length

    for (let i = 0; i < series.length; i++) {
      const values = (series[i] || []).slice(0, targetLen)
      while (values.length < targetLen) values.push(0)
      chartData.push({
        name: legends?.[i] || `Series ${i + 1}`,
        labels: normalizedLabels,
        values,
      })
    }
  }

  // Type / special options
  if (el.chartType === 'bar' || el.chartType === 'column') {
    options.barDir = resolvedBarDir
    if (el.options?.percentStack) options.barGrouping = 'percentStacked'
    else if (el.options?.stack) options.barGrouping = 'stacked'
    pptxSlide.addChart(pptx.ChartType.bar, chartData, options)
    return
  }

  if (el.chartType === 'line') {
    pptxSlide.addChart(pptx.ChartType.line, chartData, options)
    return
  }

  if (el.chartType === 'area') {
    if (el.options?.percentStack) options.barGrouping = 'percentStacked'
    else if (el.options?.stack) options.barGrouping = 'stacked'
    pptxSlide.addChart(pptx.ChartType.area, chartData, options)
    return
  }

  if (el.chartType === 'radar') {
    pptxSlide.addChart(pptx.ChartType.radar, chartData, options)
    return
  }

  if (el.chartType === 'scatter') {
    options.lineSize = 0
    pptxSlide.addChart(pptx.ChartType.scatter, chartData, options)
    return
  }

  if (el.chartType === 'pie') {
    if (typeof el.options?.pieStartAngle === 'number') options.firstSliceAng = el.options.pieStartAngle
    pptxSlide.addChart(pptx.ChartType.pie, chartData, options)
    return
  }

  if (el.chartType === 'ring') {
    const holeSize = Math.max(0, Math.min(90, Math.round(el.options?.pieInnerRadius ?? 40)))
    options.holeSize = holeSize
    if (typeof el.options?.pieStartAngle === 'number') options.firstSliceAng = el.options.pieStartAngle
    pptxSlide.addChart(pptx.ChartType.doughnut, chartData, options)
    return
  }

  if (el.chartType === 'combo') {
    // Build multi-type chart (bar/line/area) - still editable in PowerPoint
    const seriesTypes =
      el.options?.seriesTypes && el.options.seriesTypes.length === el.data.series.length
        ? el.options.seriesTypes
        : el.data.series.map(() => 'bar')

    const barData: any[] = []
    const lineData: any[] = []
    const areaData: any[] = []
    const concatOrderColors: string[] = []

    for (let i = 0; i < el.data.series.length; i++) {
      const seriesType = seriesTypes[i] || 'bar'
      const obj = {
        _srcIndex: i,
        name: el.data.legends?.[i] || `Series ${i + 1}`,
        labels: el.data.labels,
        values: el.data.series[i],
      }
      if (seriesType === 'line') lineData.push(obj)
      else if (seriesType === 'area') areaData.push(obj)
      else barData.push(obj)
    }

    // Preserve colors in the same order as the library concatenates data: bar, then line, then area
    for (const obj of barData) {
      const idx = obj._srcIndex as number
      concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    }
    for (const obj of lineData) {
      const idx = obj._srcIndex as number
      concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    }
    for (const obj of areaData) {
      const idx = obj._srcIndex as number
      concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    }
    options.chartColors = concatOrderColors.length ? concatOrderColors : fallbackPalette.slice(0, Math.max(1, el.data.series.length))

    const multi: any[] = []
    if (barData.length) multi.push({ type: pptx.ChartType.bar, data: barData })
    if (lineData.length) multi.push({ type: pptx.ChartType.line, data: lineData })
    if (areaData.length) multi.push({ type: pptx.ChartType.area, data: areaData })

    options.barDir = 'col'
    if (el.options?.percentStack) options.barGrouping = 'percentStacked'
    else if (el.options?.stack) options.barGrouping = 'stacked'

    pptxSlide.addChart(multi as any, undefined as any, options)
    return
  }

  // Fallback
  pptxSlide.addChart(pptx.ChartType.bar, chartData, options)
}
