import JSZip from 'jszip'
import type { ChartExportPatchInfo } from '@/utils/pptxChartExport'
import type { ChartOptions } from '@/types/slides'

export type ChartPostprocessItem = {
  chartId: number
  chartType: string
  options?: ChartOptions
  patch: ChartExportPatchInfo
}

type ChartSeriesMeta = {
  name: string
  seriesNode: Element
  dLblsNode: Element | null
  spPrNode: Element | null
  valueColIndex: number
  valueColLetter: string
  valueStartRow: number
  valueEndRow: number
}

type ChartWorkbookLayout = {
  sheetName: string
  labelLevels: number
  seriesColsSorted: number[]
  seriesNamesSorted: string[]
  lastRow: number
}

const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const C15_NS = 'http://schemas.microsoft.com/office/drawing/2012/chart'
const XLSX_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

const DATA_LABEL_RANGE_URI = '{02D57815-91ED-43cb-92C2-25804820EDAC}'

const isParserErrorDoc = (doc: Document) => {
  const rootName = doc.documentElement?.localName?.toLowerCase?.() || ''
  if (rootName === 'parsererror') return true
  if (doc.getElementsByTagName('parsererror').length > 0) return true
  return false
}

const toExcelCol = (index1Based: number) => {
  let n = index1Based
  let col = ''
  while (n > 0) {
    const r = (n - 1) % 26
    col = String.fromCharCode(65 + r) + col
    n = Math.floor((n - 1) / 26)
  }
  return col
}

const excelColToIndex = (col: string) => {
  const s = col.toUpperCase().replace(/[^A-Z]/g, '')
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
  return n
}

const parseSeriesValueRef = (formula: string) => {
  const m = formula.match(/\$([A-Z]+)\$(\d+):\$\1\$(\d+)/i)
  if (!m) return null
  const colLetter = m[1].toUpperCase()
  const startRow = Number(m[2])
  const endRow = Number(m[3])
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow)) return null
  return { colLetter, colIndex: excelColToIndex(colLetter), startRow, endRow }
}

const safeXmlText = (value: string) => value.replace(/[<>&]/g, '')

const formatNumberText = (value: number, mode?: ChartOptions['dataLabelValueFormat']) => {
  if (!Number.isFinite(value)) return '0'
  if (mode === 'text') return String(value)
  if (mode === 'compact') {
    return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
  }
  if (mode === 'accounting') {
    return new Intl.NumberFormat('en-US', { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

const formatPercentText = (fraction: number, decimals: number) => {
  if (!Number.isFinite(fraction)) return '0%'
  return `${(fraction * 100).toFixed(decimals)}%`
}

const buildPercentLabelText = (value: number, total: number, options?: ChartOptions) => {
  const base = formatNumberText(value, options?.dataLabelValueFormat)
  const decimals = typeof options?.dataLabelPercentDecimals === 'number' ? options.dataLabelPercentDecimals : 1
  if (!(total > 0)) return base

  const pct = formatPercentText(value / total, decimals)
  const placement = options?.dataLabelPercentPlacement || 'suffix'
  if (placement === 'prefix') return `${pct} ${base}`.trim()
  return `${base} (${pct})`
}

const buildExcelBaseExpr = (valueCell: string, mode?: ChartOptions['dataLabelValueFormat']) => {
  if (mode === 'text') return `TEXT(${valueCell},"0.########")`
  if (mode === 'accounting') return `TEXT(${valueCell},"#,##0.00")`
  if (mode === 'compact') {
    const abs = `ABS(${valueCell})`
    const s = `SIGN(${valueCell})`
    const fmt = (expr: string, suffix: string) => `(${s}*${expr})&"${suffix}"`
    return `IF(${abs}>=1000000000,${fmt(`TEXT(${abs}/1000000000,"0.0")`, 'B')},IF(${abs}>=1000000,${fmt(`TEXT(${abs}/1000000,"0.0")`, 'M')},IF(${abs}>=1000,${fmt(`TEXT(${abs}/1000,"0.0")`, 'K')},TEXT(${valueCell},"#,##0"))))`
  }
  return `TEXT(${valueCell},"#,##0")`
}

const buildExcelPercentExpr = (valueCell: string, totalExpr: string, options?: ChartOptions) => {
  const decimals = typeof options?.dataLabelPercentDecimals === 'number' ? options.dataLabelPercentDecimals : 1
  const fmt = `0.${'0'.repeat(Math.max(0, decimals))}%`
  return `TEXT(${valueCell}/${totalExpr},"${fmt}")`
}

const buildExcelLabelFormula = (valueCell: string, totalExpr: string, options?: ChartOptions) => {
  const baseExpr = buildExcelBaseExpr(valueCell, options?.dataLabelValueFormat)
  const pctExpr = buildExcelPercentExpr(valueCell, totalExpr, options)
  const placement = options?.dataLabelPercentPlacement || 'suffix'

  const combined =
    placement === 'prefix'
      ? `${pctExpr}&" "&${baseExpr}`
      : `${baseExpr}&" ("&${pctExpr}&")"`

  return `IF(${totalExpr}>0,${combined},${baseExpr})`
}

const isBarSeries = (seriesNode: Element) => {
  let n: Node | null = seriesNode
  while (n && n.nodeType === Node.ELEMENT_NODE) {
    const el = n as Element
    if (el.localName === 'barChart') return true
    if (el.localName === 'lineChart' || el.localName === 'areaChart' || el.localName === 'pieChart' || el.localName === 'doughnutChart') return false
    n = el.parentNode
  }
  return false
}

const getSeriesName = (seriesNode: Element) => {
  const tx = Array.from(seriesNode.childNodes).find(n => (n as Element)?.localName === 'tx') as Element | undefined
  if (!tx) return ''
  const v = tx.getElementsByTagNameNS(CHART_NS, 'v')[0]
  return v?.textContent || ''
}

const getSeriesValueFormula = (seriesNode: Element) => {
  const f = seriesNode.getElementsByTagNameNS(CHART_NS, 'f')[0]
  return f?.textContent || ''
}

const getSeriesDLbls = (seriesNode: Element) => {
  const node = Array.from(seriesNode.childNodes).find(n => (n as Element)?.localName === 'dLbls') as Element | undefined
  return node || null
}

const getSeriesSpPr = (seriesNode: Element) => {
  const node = Array.from(seriesNode.childNodes).find(n => (n as Element)?.localName === 'spPr') as Element | undefined
  return node || null
}

const patchChartXml = (xml: string, item: ChartPostprocessItem) => {
  const originalXml = xml
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (isParserErrorDoc(doc)) return { xml: originalXml, layout: null as ChartWorkbookLayout | null }

  const seriesNodes = Array.from(doc.getElementsByTagNameNS(CHART_NS, 'ser')) as Element[]
  const seriesMeta: ChartSeriesMeta[] = []

  for (const seriesNode of seriesNodes) {
    const formula = getSeriesValueFormula(seriesNode)
    const parsed = parseSeriesValueRef(formula)
    if (!parsed) continue
    seriesMeta.push({
      name: getSeriesName(seriesNode),
      seriesNode,
      dLblsNode: getSeriesDLbls(seriesNode),
      spPrNode: getSeriesSpPr(seriesNode),
      valueColIndex: parsed.colIndex,
      valueColLetter: parsed.colLetter,
      valueStartRow: parsed.startRow,
      valueEndRow: parsed.endRow,
    })
  }

  if (!seriesMeta.length) return { xml, layout: null as ChartWorkbookLayout | null }

  const seriesColsSorted = Array.from(new Set(seriesMeta.map(m => m.valueColIndex))).sort((a, b) => a - b)
  const minCol = Math.min(...seriesColsSorted)
  const labelLevels = Math.max(1, minCol - 1)
  const lastRow = Math.max(...seriesMeta.map(m => m.valueEndRow))

  const seriesNameByColIndex = new Map<number, string>()
  for (const meta of seriesMeta) {
    if (!seriesNameByColIndex.has(meta.valueColIndex) && meta.name) seriesNameByColIndex.set(meta.valueColIndex, meta.name)
  }
  const seriesNamesSorted = seriesColsSorted.map(col => seriesNameByColIndex.get(col) || '')

  const legendColorByName = new Map<string, string>()
  for (let i = 0; i < item.patch.legends.length; i++) {
    const name = item.patch.legends[i] || ''
    const color = item.patch.seriesPalette[i]
    if (name && color) legendColorByName.set(name, color)
  }

  const wantPercentLabels = item.options?.showDataLabels !== false && !!item.options?.dataLabelShowPercent
  const sheetName = 'Sheet1'

  for (const meta of seriesMeta) {
    const workbookIndex = Math.max(0, seriesColsSorted.indexOf(meta.valueColIndex))
    const labelColIndex = labelLevels + seriesColsSorted.length + workbookIndex + 1
    const labelColLetter = toExcelCol(labelColIndex)

    if (wantPercentLabels) {
      const dLbls = meta.dLblsNode || (() => {
        const node = doc.createElementNS(CHART_NS, 'c:dLbls')
        const insertBefore = Array.from(meta.seriesNode.childNodes).find(n => (n as Element)?.localName === 'cat') || null
        meta.seriesNode.insertBefore(node, insertBefore)
        meta.dLblsNode = node
        return node
      })()

      const showVal = dLbls.getElementsByTagNameNS(CHART_NS, 'showVal')[0] || doc.createElementNS(CHART_NS, 'c:showVal')
      showVal.setAttribute('val', '0')
      if (!showVal.parentNode) dLbls.appendChild(showVal)

      const extLst = dLbls.getElementsByTagNameNS(CHART_NS, 'extLst')[0] || doc.createElementNS(CHART_NS, 'c:extLst')
      if (!extLst.parentNode) dLbls.appendChild(extLst)

      for (const existing of Array.from(extLst.getElementsByTagNameNS(CHART_NS, 'ext'))) {
        if ((existing as Element).getAttribute('uri') === DATA_LABEL_RANGE_URI) extLst.removeChild(existing)
      }

      const ext = doc.createElementNS(CHART_NS, 'c:ext')
      ext.setAttribute('uri', DATA_LABEL_RANGE_URI)
      ext.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:c15', C15_NS)

      const dlRange = doc.createElementNS(C15_NS, 'c15:datalabelsRange')
      const f = doc.createElementNS(C15_NS, 'c15:f')
      f.textContent = `${sheetName}!$${labelColLetter}$${meta.valueStartRow}:$${labelColLetter}$${meta.valueEndRow}`
      dlRange.appendChild(f)

      const strCache = doc.createElementNS(C15_NS, 'c15:dlblRangeCache')
      const ptCount = doc.createElementNS(C15_NS, 'c15:ptCount')
      const pointCount = Math.max(0, meta.valueEndRow - meta.valueStartRow + 1)
      ptCount.setAttribute('val', String(pointCount))
      strCache.appendChild(ptCount)

      const idxInPayload = item.patch.legends.findIndex(n => n === meta.name)
      const seriesValues = idxInPayload >= 0 ? (item.patch.alignedSeries[idxInPayload] || []) : []
      const seriesTotal = seriesValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0)

      for (let i = 0; i < pointCount; i++) {
        const pt = doc.createElementNS(C15_NS, 'c15:pt')
        pt.setAttribute('idx', String(i))
        const v = doc.createElementNS(C15_NS, 'c15:v')
        const value = Number(seriesValues[i] ?? 0)
        const text = buildPercentLabelText(value, seriesTotal, item.options)
        v.textContent = safeXmlText(text)
        pt.appendChild(v)
        strCache.appendChild(pt)
      }

      dlRange.appendChild(strCache)

      const showRange = doc.createElementNS(C15_NS, 'c15:showDataLabelsRange')
      showRange.setAttribute('val', '1')

      ext.appendChild(dlRange)
      ext.appendChild(showRange)
      extLst.appendChild(ext)
    }

    const legendColor = legendColorByName.get(meta.name)
    const hasPointOverrides = meta.seriesNode.getElementsByTagNameNS(CHART_NS, 'dPt').length > 0
    if (legendColor && hasPointOverrides && isBarSeries(meta.seriesNode) && meta.spPrNode) {
      const spPr = meta.spPrNode
      const solidFill = spPr.getElementsByTagNameNS(DRAWING_NS, 'solidFill')[0] || doc.createElementNS(DRAWING_NS, 'a:solidFill')
      if (!solidFill.parentNode) spPr.insertBefore(solidFill, spPr.firstChild)
      const srgb = solidFill.getElementsByTagNameNS(DRAWING_NS, 'srgbClr')[0] || doc.createElementNS(DRAWING_NS, 'a:srgbClr')
      srgb.setAttribute('val', legendColor)
      if (!srgb.parentNode) solidFill.appendChild(srgb)
    }
  }

  const serializer = new XMLSerializer()
  const nextXml = serializer.serializeToString(doc)
  const verify = parser.parseFromString(nextXml, 'application/xml')
  if (isParserErrorDoc(verify)) return { xml: originalXml, layout: null as ChartWorkbookLayout | null }
  const layout: ChartWorkbookLayout = { sheetName, labelLevels, seriesColsSorted, seriesNamesSorted, lastRow }
  return { xml: nextXml, layout }
}

const patchWorkbookXlsx = async (xlsxArrayBuffer: ArrayBuffer, layout: ChartWorkbookLayout, item: ChartPostprocessItem) => {
  const originalBuffer = xlsxArrayBuffer
  const zip = await JSZip.loadAsync(xlsxArrayBuffer)
  const sheet = zip.file('xl/worksheets/sheet1.xml')
  if (!sheet) return originalBuffer

  const sheetXml = await sheet.async('text')
  const parser = new DOMParser()
  const doc = parser.parseFromString(sheetXml, 'application/xml')
  if (isParserErrorDoc(doc)) return originalBuffer

  const dimension = doc.getElementsByTagNameNS(XLSX_NS, 'dimension')[0]
  const newLastColIndex = layout.labelLevels + layout.seriesColsSorted.length + layout.seriesColsSorted.length
  const newDim = `A1:${toExcelCol(newLastColIndex)}${layout.lastRow}`
  if (dimension) dimension.setAttribute('ref', newDim)

  const sheetData = doc.getElementsByTagNameNS(XLSX_NS, 'sheetData')[0]
  if (!sheetData) return originalBuffer

  const rows = Array.from(sheetData.getElementsByTagNameNS(XLSX_NS, 'row')) as Element[]
  const wantPercentLabels = item.options?.showDataLabels !== false && !!item.options?.dataLabelShowPercent
  if (!wantPercentLabels) return originalBuffer

  const seriesTotals = item.patch.alignedSeries.map(s => s.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0))
  const legendIndexByName = new Map<string, number>()
  item.patch.legends.forEach((n, idx) => {
    if (n) legendIndexByName.set(n, idx)
  })

  for (const row of rows) {
    const rAttr = row.getAttribute('r')
    const rowNum = rAttr ? Number(rAttr) : NaN
    if (!Number.isFinite(rowNum)) continue
    row.setAttribute('spans', `1:${newLastColIndex}`)
    if (rowNum < 2 || rowNum > layout.lastRow) continue

    for (let workbookIndex = 0; workbookIndex < layout.seriesColsSorted.length; workbookIndex++) {
      const valueColIndex = layout.seriesColsSorted[workbookIndex]
      const valueColLetter = toExcelCol(valueColIndex)
      const valueCell = `${valueColLetter}${rowNum}`

      const labelColIndex = layout.labelLevels + layout.seriesColsSorted.length + workbookIndex + 1
      const labelCell = `${toExcelCol(labelColIndex)}${rowNum}`

      const totalRange = `$${valueColLetter}$2:$${valueColLetter}$${layout.lastRow}`
      const totalExpr = `SUM(${totalRange})`
      const formula = buildExcelLabelFormula(valueCell, totalExpr, item.options)

      const nameFromWorkbook = layout.seriesNamesSorted[workbookIndex] || item.patch.legends[workbookIndex] || ''
      const seriesIdx = legendIndexByName.get(nameFromWorkbook) ?? (workbookIndex < item.patch.alignedSeries.length ? workbookIndex : -1)
      const seriesTotal = seriesIdx >= 0 ? (seriesTotals[seriesIdx] || 0) : 0
      const value = seriesIdx >= 0 ? Number(item.patch.alignedSeries[seriesIdx]?.[rowNum - 2] ?? 0) : 0
      const cached = buildPercentLabelText(value, seriesTotal, item.options)

      const cell = doc.createElementNS(XLSX_NS, 'c')
      cell.setAttribute('r', labelCell)
      cell.setAttribute('t', 'str')

      const f = doc.createElementNS(XLSX_NS, 'f')
      f.textContent = formula
      const v = doc.createElementNS(XLSX_NS, 'v')
      v.textContent = cached
      cell.appendChild(f)
      cell.appendChild(v)

      row.appendChild(cell)
    }
  }

  const nextSheetXml = new XMLSerializer().serializeToString(doc)
  const verify = parser.parseFromString(nextSheetXml, 'application/xml')
  if (isParserErrorDoc(verify)) return originalBuffer
  zip.file('xl/worksheets/sheet1.xml', nextSheetXml)
  return zip.generateAsync({ type: 'arraybuffer' })
}

export const postprocessPptxCharts = async (pptxBlob: Blob, items: ChartPostprocessItem[]) => {
  if (!items.length) return pptxBlob

  const buffer = await pptxBlob.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)

  for (const item of items) {
    const chartPath = `ppt/charts/chart${item.chartId}.xml`
    const embedPath = `ppt/embeddings/Microsoft_Excel_Worksheet${item.chartId}.xlsx`
    const chartFile = zip.file(chartPath)
    const embedFile = zip.file(embedPath)
    if (!chartFile || !embedFile) continue

    const chartXml = await chartFile.async('text')
    const { xml: patchedChartXml, layout } = patchChartXml(chartXml, item)
    if (!layout) continue

    const embed = await embedFile.async('arraybuffer')
    const patchedEmbed = await patchWorkbookXlsx(embed, layout, item)
    zip.file(chartPath, patchedChartXml)
    zip.file(embedPath, patchedEmbed)
  }

  const out = await zip.generateAsync({ type: 'blob' })
  return out as Blob
}
