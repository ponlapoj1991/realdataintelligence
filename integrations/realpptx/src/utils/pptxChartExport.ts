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

  const stripUndefinedDeep = (value: any): any => {
    if (Array.isArray(value)) return value.map(stripUndefinedDeep)
    if (!value || typeof value !== 'object') return value
    const out: any = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out[k] = stripUndefinedDeep(v)
    }
    return out
  }

  const roundFixed = (value: number, decimals: number) => {
    if (!Number.isFinite(value)) return 0
    return Number(value.toFixed(decimals))
  }

  const asFiniteNumber = (value: any, fallback = 0) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const clampNonNegative = (value: any, fallback = 0) => {
    return Math.max(0, asFiniteNumber(value, fallback))
  }

  const sanitizeXmlText = (value: any) => {
    const raw = (value === null || value === undefined) ? '' : String(value)
    // Remove characters that commonly break OOXML when not escaped correctly
    const cleaned = raw
      .replace(/[<>&]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return cleaned
  }

  const makeUniqueNames = (items: string[], fallbackPrefix: string) => {
    const bases = items.map((item, idx) => {
      const cleaned = sanitizeXmlText(item)
      return cleaned || `${fallbackPrefix} ${idx + 1}`
    })

    const counts = new Map<string, number>()
    for (const b of bases) counts.set(b, (counts.get(b) || 0) + 1)

    const seen = new Map<string, number>()
    return bases.map((b) => {
      const total = counts.get(b) || 0
      if (total <= 1) return b
      const next = (seen.get(b) || 0) + 1
      seen.set(b, next)
      return `${b} ${next}`
    })
  }

  const normalizeLabels = (labels: any[]) => {
    const raw = (Array.isArray(labels) ? labels : []).map(v => (v === null || v === undefined) ? '' : String(v))
    const safe = makeUniqueNames(raw, 'Label')
    // Ensure no empty labels for OOXML stability
    return safe.length ? safe : ['Label 1']
  }

  const normalizeSeries = (series: any[]) => {
    const src = Array.isArray(series) ? series : []
    return src.map(row => {
      const arr = Array.isArray(row) ? row : []
      return arr.map(v => {
        const n = (v === null || v === undefined || v === '') ? 0 : asFiniteNumber(v, 0)
        return roundFixed(n, 2)
      })
    })
  }

  const alignSeriesToLabels = (input: number[][], targetLen: number) => {
    return input.map(row => {
      const values = (Array.isArray(row) ? row : []).slice(0, targetLen).map(v => roundFixed(asFiniteNumber(v, 0), 2))
      while (values.length < targetLen) values.push(0)
      return values
    })
  }

  // Normalize & validate chart payload first to avoid invalid OOXML (NaN/undefined/null)
  const labels = normalizeLabels(el.data?.labels || [])
  const series = normalizeSeries(el.data?.series || [])
  const legendsRaw = Array.isArray(el.data?.legends)
    ? el.data.legends.map(v => (v === null || v === undefined) ? '' : String(v))
    : []
  const legends = makeUniqueNames(legendsRaw.length ? legendsRaw : series.map((_, idx) => `Series ${idx + 1}`), 'Series')

  if (!series.length) return

  const alignedSeries = alignSeriesToLabels(series, labels.length)

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
    const seriesColors = (el.data?.seriesColors || []).filter(Boolean).map(color => toPptxHex(color))
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

  const opt = (el.options || {}) as any
  const fontFace =
    opt.legendFontFamily ||
    opt.dataLabelFontFamily ||
    opt.axisLabelFontFamilyX ||
    opt.axisLabelFontFamilyYLeft ||
    opt.axisLabelFontFamilyYRight ||
    'Arial'

  const catAxisTextColor = toPptxHex(opt.axisLabelColorX || el.options?.axisLabelColor || el.textColor || '#000000')
  const valAxisTextColor = toPptxHex(opt.axisLabelColorYLeft || el.options?.axisLabelColor || el.textColor || '#000000')
  const valAxisTextColorRight = toPptxHex(opt.axisLabelColorYRight || opt.axisLabelColorYLeft || el.options?.axisLabelColor || el.textColor || '#000000')
  const gridColor = toPptxHex(opt.axisGridColorYLeft || el.options?.axisGridColor || el.lineColor || '#D9D9D9')

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
  const dataLabelFontSizePx = scaleFontPx(el.options?.dataLabelFontSize ?? 11)
  const dataLabelColor = toPptxHex(el.options?.dataLabelColor || valAxisTextColor)
  const dataLabelBold = el.options?.dataLabelFontWeight === 'bold'

  const catAxisFontSizePx = scaleFontPx(opt.axisLabelFontSizeX ?? el.options?.axisLabelFontSize ?? 10)
  const valAxisFontSizePx = scaleFontPx(opt.axisLabelFontSizeYLeft ?? el.options?.axisLabelFontSize ?? 10)
  const axisBold = dataLabelBold

  const x = roundFixed(clampNonNegative(el.left) / ratioPx2Inch, 4)
  const y = roundFixed(clampNonNegative(el.top) / ratioPx2Inch, 4)
  const w = roundFixed(clampNonNegative(el.width) / ratioPx2Inch, 4)
  const h = roundFixed(clampNonNegative(el.height) / ratioPx2Inch, 4)
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
  else if (isBarLike && series.length === 1 && hasPerPointColors) {
    options.chartColors = Array.from({ length: pointCount }, (_, idx) => resolveDataPointColor(idx))
  }
  else if (isScatter) {
    options.chartColors = fallbackPalette.slice(0, Math.max(1, series.length - 1))
  }
  else if (isCombo) {
    // set later after multi chart build (order-sensitive)
    options.chartColors = fallbackPalette.slice()
  }
  else {
    options.chartColors = fallbackPalette.slice(0, Math.max(1, series.length))
  }

  // Axis text
  options.fontFace = fontFace
  options.catAxisLabelColor = catAxisTextColor
  options.valAxisLabelColor = valAxisTextColor
  options.catAxisLabelFontSize = pxToPt(catAxisFontSizePx)
  options.valAxisLabelFontSize = pxToPt(valAxisFontSizePx)
  options.catAxisLabelFontBold = axisBold
  options.valAxisLabelFontBold = axisBold
  options.catAxisLabelFontFace = fontFace
  options.valAxisLabelFontFace = fontFace
  options.catAxisMinorTickMark = 'none'
  options.valAxisMinorTickMark = 'none'

  const rotate = (typeof opt.axisLabelSlantX === 'number' && Number.isFinite(opt.axisLabelSlantX))
    ? opt.axisLabelSlantX
    : (typeof el.options?.axisLabelSlant === 'number' && Number.isFinite(el.options.axisLabelSlant))
      ? el.options.axisLabelSlant
      : undefined
  if (typeof rotate === 'number') options.catAxisLabelRotate = rotate

  const axisRange = el.options?.axisRange
  if (typeof axisRange?.yLeftMin === 'number' && Number.isFinite(axisRange.yLeftMin)) options.valAxisMinVal = axisRange.yLeftMin
  if (typeof axisRange?.yLeftMax === 'number' && Number.isFinite(axisRange.yLeftMax)) options.valAxisMaxVal = axisRange.yLeftMax

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
  const shouldShowLegend = legendEnabled && series.length > 1 && !isScatter
  if (shouldShowLegend) {
    options.showLegend = true
    options.legendPos = mapLegendPos(el.options?.legendPosition)
    options.legendColor = toPptxHex(el.options?.legendFontColor || valAxisTextColor)
    options.legendFontSize = pxToPt(scaleFontPx(el.options?.legendFontSize ?? 12))
    options.legendFontFace = fontFace
  }

  // Data labels
  if (['bar', 'column', 'line', 'area', 'pie', 'ring'].includes(el.chartType)) {
    options.dataLabelColor = dataLabelColor
    options.dataLabelFontSize = pxToPt(dataLabelFontSizePx)
    options.dataLabelFontBold = dataLabelBold
    options.dataLabelFontFace = fontFace

    if (el.chartType === 'bar' || el.chartType === 'column') {
      options.showValue = showDataLabels
      if (showDataLabels && !el.options?.dataLabelShowPercent) {
        if (el.options?.dataLabelValueFormat === 'number') options.dataLabelFormatCode = '#,##0'
        if (el.options?.dataLabelValueFormat === 'accounting') options.dataLabelFormatCode = '#,##0.00'
      }
      const mapped = mapDataLabelPosForBar(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
    }
    else if (el.chartType === 'line' || el.chartType === 'area') {
      options.showValue = showDataLabels
      if (showDataLabels && !el.options?.dataLabelShowPercent) {
        if (el.options?.dataLabelValueFormat === 'number') options.dataLabelFormatCode = '#,##0'
        if (el.options?.dataLabelValueFormat === 'accounting') options.dataLabelFormatCode = '#,##0.00'
      }
      const mapped = mapDataLabelPosForLine(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
      if (el.options?.lineSmooth) options.lineSmooth = true
    }
    else if (isPieLike) {
      const showPercent = showDataLabels && !!el.options?.dataLabelShowPercent
      options.showPercent = showPercent
      options.showValue = showDataLabels
      ;(options as any).showLeaderLines = showDataLabels

      const decimals = el.options?.dataLabelPercentDecimals
      if (showPercent && typeof decimals === 'number') {
        options.dataLabelFormatCode = `0.${'0'.repeat(Math.max(0, decimals))}%`
      }
      else if (showDataLabels) {
        if (el.options?.dataLabelValueFormat === 'number') options.dataLabelFormatCode = '#,##0'
        if (el.options?.dataLabelValueFormat === 'accounting') options.dataLabelFormatCode = '#,##0.00'
      }

      const mapped = mapDataLabelPosForPie(el.options?.dataLabelPosition)
      if (mapped) options.dataLabelPosition = mapped
    }
  }

  // Build data payloads
  const chartData: any[] = []
  if (isScatter) {
    const xValues = (series[0] || []).map(v => roundFixed(asFiniteNumber(v, 0), 2))
    const ySeries = series.slice(1)
    if (!xValues.length || !ySeries.length) return

    let minLen = xValues.length
    const yValuesList = ySeries.map((row) => (row || []).map(v => roundFixed(asFiniteNumber(v, 0), 2)))
    for (const row of yValuesList) minLen = Math.min(minLen, row.length)
    if (minLen <= 0) return

    chartData.push({ name: 'X', values: xValues.slice(0, minLen) })
    for (let i = 0; i < ySeries.length; i++) {
      chartData.push({
        name: legends?.[i] || `Series ${i + 1}`,
        values: (yValuesList[i] || []).slice(0, minLen),
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
      const values = (alignedSeries[i] || []).slice(0, targetLen).map(v => roundFixed(asFiniteNumber(v, 0), 2))
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
    pptxSlide.addChart(pptx.ChartType.bar, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'line') {
    pptxSlide.addChart(pptx.ChartType.line, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'area') {
    if (el.options?.percentStack) options.barGrouping = 'percentStacked'
    else if (el.options?.stack) options.barGrouping = 'stacked'
    pptxSlide.addChart(pptx.ChartType.area, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'radar') {
    pptxSlide.addChart(pptx.ChartType.radar, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'scatter') {
    options.lineSize = 0
    pptxSlide.addChart(pptx.ChartType.scatter, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'pie') {
    if (typeof el.options?.pieStartAngle === 'number') options.firstSliceAng = el.options.pieStartAngle
    pptxSlide.addChart(pptx.ChartType.pie, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'ring') {
    const holeSize = Math.max(0, Math.min(90, Math.round(el.options?.pieInnerRadius ?? 75)))
    options.holeSize = holeSize
    if (typeof el.options?.pieStartAngle === 'number') options.firstSliceAng = el.options.pieStartAngle
    pptxSlide.addChart(pptx.ChartType.doughnut, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
    return
  }

  if (el.chartType === 'combo') {
    // Build multi-type chart (bar/line/area) - still editable in PowerPoint
    const seriesTypes =
      el.options?.seriesTypes && el.options.seriesTypes.length === series.length
        ? el.options.seriesTypes
        : series.map(() => 'bar')

    const yAxisIndexes = (() => {
      const fromOptions = Array.isArray(el.options?.yAxisIndexes) ? el.options.yAxisIndexes : undefined
      if (fromOptions && fromOptions.length === alignedSeries.length) return fromOptions.map(v => (v === 1 ? 1 : 0))
      return alignedSeries.map(() => 0)
    })()

    const useSecondary = yAxisIndexes.some(v => v === 1) && opt.axisShowYRight !== false

    const barData: any[] = []
    const barSecondaryData: any[] = []
    const lineData: any[] = []
    const lineSecondaryData: any[] = []
    const areaData: any[] = []
    const areaSecondaryData: any[] = []
    const barColorIndex: number[] = []
    const barSecondaryColorIndex: number[] = []
    const lineColorIndex: number[] = []
    const lineSecondaryColorIndex: number[] = []
    const areaColorIndex: number[] = []
    const areaSecondaryColorIndex: number[] = []

    for (let i = 0; i < alignedSeries.length; i++) {
      const seriesType = seriesTypes[i] || 'bar'
      const obj = {
        name: legends[i] || `Series ${i + 1}`,
        labels,
        values: alignedSeries[i],
      }

      const onSecondary = useSecondary && yAxisIndexes[i] === 1
      if (seriesType === 'line') {
        ;(onSecondary ? lineSecondaryData : lineData).push(obj)
        ;(onSecondary ? lineSecondaryColorIndex : lineColorIndex).push(i)
      }
      else if (seriesType === 'area') {
        ;(onSecondary ? areaSecondaryData : areaData).push(obj)
        ;(onSecondary ? areaSecondaryColorIndex : areaColorIndex).push(i)
      }
      else {
        ;(onSecondary ? barSecondaryData : barData).push(obj)
        ;(onSecondary ? barSecondaryColorIndex : barColorIndex).push(i)
      }
    }

    const concatOrderColors: string[] = []
    for (const idx of barColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    for (const idx of barSecondaryColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    for (const idx of lineColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    for (const idx of lineSecondaryColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    for (const idx of areaColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    for (const idx of areaSecondaryColorIndex) concatOrderColors.push(fallbackPalette[idx % fallbackPalette.length] || fallbackPalette[0] || '000000')
    options.chartColors = concatOrderColors.length ? concatOrderColors : fallbackPalette.slice(0, Math.max(1, alignedSeries.length))

    const multi: any[] = []
    if (barData.length) multi.push({ type: pptx.ChartType.bar, data: barData })
    if (barSecondaryData.length) multi.push({ type: pptx.ChartType.bar, data: barSecondaryData, options: { secondaryValAxis: true, secondaryCatAxis: true } })
    if (lineData.length) multi.push({ type: pptx.ChartType.line, data: lineData })
    if (lineSecondaryData.length) multi.push({ type: pptx.ChartType.line, data: lineSecondaryData, options: { secondaryValAxis: true, secondaryCatAxis: true } })
    if (areaData.length) multi.push({ type: pptx.ChartType.area, data: areaData })
    if (areaSecondaryData.length) multi.push({ type: pptx.ChartType.area, data: areaSecondaryData, options: { secondaryValAxis: true, secondaryCatAxis: true } })

    options.barDir = 'col'
    if (el.options?.percentStack) options.barGrouping = 'percentStacked'
    else if (el.options?.stack) options.barGrouping = 'stacked'

    if (useSecondary) {
      options.valAxes = [
        {
          valAxisLabelColor: valAxisTextColor,
          valAxisLabelFontBold: axisBold,
          valAxisLabelFontFace: fontFace,
          valAxisLabelFontSize: pxToPt(valAxisFontSizePx),
          valAxisMinorTickMark: 'none',
          valAxisMinVal: (typeof axisRange?.yLeftMin === 'number' && Number.isFinite(axisRange.yLeftMin)) ? axisRange.yLeftMin : undefined,
          valAxisMaxVal: (typeof axisRange?.yLeftMax === 'number' && Number.isFinite(axisRange.yLeftMax)) ? axisRange.yLeftMax : undefined,
        },
        {
          valAxisLabelColor: valAxisTextColorRight,
          valAxisLabelFontBold: axisBold,
          valAxisLabelFontFace: fontFace,
          valAxisLabelFontSize: pxToPt(valAxisFontSizePx),
          valAxisMinorTickMark: 'none',
          valAxisMinVal: (typeof axisRange?.yRightMin === 'number' && Number.isFinite(axisRange.yRightMin)) ? axisRange.yRightMin : undefined,
          valAxisMaxVal: (typeof axisRange?.yRightMax === 'number' && Number.isFinite(axisRange.yRightMax)) ? axisRange.yRightMax : undefined,
        },
      ]

      options.catAxes = [
        {},
        { catAxisHidden: true },
      ]
    }

    ;(pptxSlide as any).addChart(stripUndefinedDeep(multi) as any, undefined as any, stripUndefinedDeep(options))
    return
  }

  // Fallback
  pptxSlide.addChart(pptx.ChartType.bar, stripUndefinedDeep(chartData), stripUndefinedDeep(options))
}
