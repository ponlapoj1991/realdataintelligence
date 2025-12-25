/// <reference lib="webworker" />

import type { DashboardFilter, DashboardWidget, RawRow, TransformationRule } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import { buildMagicChartPayload, type MagicChartPayload } from '../utils/magicChartPayload'
import { buildDashboardChartPayload, type DashboardChartInsertPayload } from '../utils/dashboardChartPayload'
import { getAllDataChunks, getAllDataSourceChunks, getCachedResult, setCachedResult } from '../utils/storage-v2'
import { applyTransformation } from '../utils/transform'

type SetRowsMessage = {
  type: 'setRows'
  rows: RawRow[]
  rowsVersion: number
}

type SetSourceMessage = {
  type: 'setSource'
  projectId: string
  dataSourceId?: string
  dataVersion?: number
  transformRules?: TransformationRule[]
  rowsVersion: number
}

type BuildPayloadMessage = {
  type: 'buildPayload'
  requestId: string
  rowsVersion: number
  widget: DashboardWidget
  filters?: DashboardFilter[]
  theme?: ChartTheme
  isEditing?: boolean
}

type BuildPptxPayloadMessage = {
  type: 'buildPptxPayload'
  requestId: string
  rowsVersion: number
  widget: DashboardWidget
  filters?: DashboardFilter[]
  theme?: ChartTheme
  sourceDashboardId?: string
}

type ColumnOptionsMessage = {
  type: 'columnOptions'
  requestId: string
  rowsVersion: number
  columnKey: string
  limitRows: number
  limitValues: number
}

type WorkerMessage = SetRowsMessage | SetSourceMessage | BuildPayloadMessage | BuildPptxPayloadMessage | ColumnOptionsMessage

type PayloadResponse = {
  type: 'payload'
  requestId: string
  rowsVersion: number
  payload: MagicChartPayload | null
}

type PptxPayloadResponse = {
  type: 'pptxPayload'
  requestId: string
  rowsVersion: number
  payload: DashboardChartInsertPayload | null
}

type ColumnOptionsResponse = {
  type: 'columnOptions'
  requestId: string
  rowsVersion: number
  values: string[]
}

type ErrorResponse = {
  type: 'error'
  requestId?: string
  rowsVersion?: number
  error: string
}

let currentRows: RawRow[] = []
let currentRowsVersion = 0
let currentProjectId: string | null = null
let currentDataSourceId: string | undefined
let currentDataVersion = 0
let currentTransformRules: TransformationRule[] | undefined
let currentLoadPromise: Promise<void> | null = null

const toComparableString = (raw: unknown) => {
  if (raw === null || raw === undefined || raw === '') return '(Blank)'
  return String(raw)
}

const loadRowsFromIndexedDB = async () => {
  const projectId = currentProjectId
  if (!projectId) {
    currentRows = []
    return
  }

  const rows: RawRow[] = currentDataSourceId
    ? await getAllDataSourceChunks(projectId, currentDataSourceId)
    : await getAllDataChunks(projectId)

  if (currentTransformRules && currentTransformRules.length > 0) {
    currentRows = applyTransformation(rows, currentTransformRules)
    return
  }

  currentRows = rows
}

const mergeDashboardFilters = (...lists: Array<DashboardFilter[] | undefined>) => {
  const seen = new Set<string>()
  const merged: DashboardFilter[] = []
  for (const list of lists) {
    if (!list || list.length === 0) continue
    for (const f of list) {
      if (!f || !f.column) continue
      const key = `${f.column}|${f.dataType || ''}|${f.value || ''}|${f.endValue || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(f)
    }
  }
  return merged.length ? merged : undefined
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'setRows') {
    currentRows = Array.isArray(msg.rows) ? msg.rows : []
    currentRowsVersion = msg.rowsVersion
    currentProjectId = null
    currentDataSourceId = undefined
    currentDataVersion = 0
    currentLoadPromise = null
    return
  }

  if (msg.type === 'setSource') {
    currentProjectId = msg.projectId
    currentDataSourceId = msg.dataSourceId
    currentDataVersion = typeof msg.dataVersion === 'number' ? msg.dataVersion : 0
    currentTransformRules = Array.isArray(msg.transformRules) ? msg.transformRules : undefined
    currentRowsVersion = msg.rowsVersion
    currentRows = []
    currentLoadPromise = loadRowsFromIndexedDB().catch((e) => {
      console.error('[magicAggregation.worker] Failed to load rows:', e)
      currentRows = []
    })
    return
  }

  if (msg.type === 'buildPayload') {
    const rowsVersion = msg.rowsVersion
    const run = async () => {
      try {
        const loadPromise = currentLoadPromise
        if (loadPromise) {
          await loadPromise
        }

        // Avoid returning payload built from a newer dataset than the requester expects
        if (currentRowsVersion !== rowsVersion) {
          self.postMessage({
            type: 'payload',
            requestId: msg.requestId,
            rowsVersion,
            payload: null,
          } satisfies PayloadResponse)
          return
        }

        const mergedFilters = mergeDashboardFilters(msg.widget.filters, msg.filters)
        const mergedWidget = mergedFilters ? { ...msg.widget, filters: mergedFilters } : msg.widget

        const themeId = msg.theme?.id || 'default'
        const cacheKey = JSON.stringify({
          kind: 'magicPayload',
          dataVersion: currentProjectId ? currentDataVersion : undefined,
          rowsVersion: currentProjectId ? undefined : rowsVersion,
          projectId: currentProjectId || undefined,
          dataSourceId: currentDataSourceId,
          transformRules: currentTransformRules && currentTransformRules.length ? currentTransformRules : undefined,
          themeId,
          widget: mergedWidget,
        })

        if (currentProjectId) {
          const cached = await getCachedResult(currentProjectId, cacheKey)
          if (cached) {
            self.postMessage({
              type: 'payload',
              requestId: msg.requestId,
              rowsVersion,
              payload: cached as MagicChartPayload,
            } satisfies PayloadResponse)
            return
          }
        }

        const payload = buildMagicChartPayload(mergedWidget, currentRows, { theme: msg.theme })

        if (currentProjectId && payload) {
          await setCachedResult(currentProjectId, cacheKey, payload)
        }

        self.postMessage({
          type: 'payload',
          requestId: msg.requestId,
          rowsVersion,
          payload,
        } satisfies PayloadResponse)
      } catch (e: any) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          rowsVersion,
          error: e?.message || 'Worker failed',
        } satisfies ErrorResponse)
      }
    }

    void run()
  }

  if (msg.type === 'buildPptxPayload') {
    const rowsVersion = msg.rowsVersion
    const run = async () => {
      try {
        const loadPromise = currentLoadPromise
        if (loadPromise) {
          await loadPromise
        }

        if (currentRowsVersion !== rowsVersion) {
          self.postMessage({
            type: 'pptxPayload',
            requestId: msg.requestId,
            rowsVersion,
            payload: null,
          } satisfies PptxPayloadResponse)
          return
        }

        const mergedFilters = mergeDashboardFilters(msg.widget.filters, msg.filters)
        const mergedWidget = mergedFilters ? { ...msg.widget, filters: mergedFilters } : msg.widget

        const themeId = msg.theme?.id || 'default'
        const cacheKey = JSON.stringify({
          kind: 'pptxPayload',
          dataVersion: currentProjectId ? currentDataVersion : undefined,
          rowsVersion: currentProjectId ? undefined : rowsVersion,
          projectId: currentProjectId || undefined,
          dataSourceId: currentDataSourceId,
          transformRules: currentTransformRules && currentTransformRules.length ? currentTransformRules : undefined,
          themeId,
          sourceDashboardId: msg.sourceDashboardId,
          widget: mergedWidget,
        })

        if (currentProjectId) {
          const cached = await getCachedResult(currentProjectId, cacheKey)
          if (cached) {
            self.postMessage({
              type: 'pptxPayload',
              requestId: msg.requestId,
              rowsVersion,
              payload: cached as DashboardChartInsertPayload,
            } satisfies PptxPayloadResponse)
            return
          }
        }

        const payload = buildDashboardChartPayload(mergedWidget, currentRows, {
          theme: msg.theme,
          sourceDashboardId: msg.sourceDashboardId,
        })

        if (currentProjectId && payload) {
          await setCachedResult(currentProjectId, cacheKey, payload)
        }

        self.postMessage({
          type: 'pptxPayload',
          requestId: msg.requestId,
          rowsVersion,
          payload,
        } satisfies PptxPayloadResponse)
      } catch (e: any) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          rowsVersion,
          error: e?.message || 'Worker failed',
        } satisfies ErrorResponse)
      }
    }

    void run()
  }

  if (msg.type === 'columnOptions') {
    const rowsVersion = msg.rowsVersion
    const run = async () => {
      try {
        const loadPromise = currentLoadPromise
        if (loadPromise) {
          await loadPromise
        }

        if (currentRowsVersion !== rowsVersion) {
          self.postMessage({
            type: 'columnOptions',
            requestId: msg.requestId,
            rowsVersion,
            values: [],
          } satisfies ColumnOptionsResponse)
          return
        }

        const columnKey = String(msg.columnKey || '').trim()
        const limitRows = Math.max(0, Number(msg.limitRows || 0))
        const limitValues = Math.max(0, Number(msg.limitValues || 0))

        if (!columnKey || limitRows === 0 || limitValues === 0) {
          self.postMessage({
            type: 'columnOptions',
            requestId: msg.requestId,
            rowsVersion,
            values: [],
          } satisfies ColumnOptionsResponse)
          return
        }

        const cacheKey = JSON.stringify({
          kind: 'magicColumnOptions',
          dataVersion: currentProjectId ? currentDataVersion : undefined,
          rowsVersion: currentProjectId ? undefined : rowsVersion,
          projectId: currentProjectId || undefined,
          dataSourceId: currentDataSourceId,
          transformRules: currentTransformRules && currentTransformRules.length ? currentTransformRules : undefined,
          columnKey,
          limitRows,
          limitValues,
        })

        if (currentProjectId) {
          const cached = await getCachedResult(currentProjectId, cacheKey)
          if (cached && Array.isArray((cached as any).values)) {
            self.postMessage({
              type: 'columnOptions',
              requestId: msg.requestId,
              rowsVersion,
              values: (cached as any).values as string[],
            } satisfies ColumnOptionsResponse)
            return
          }
        }

        const values = new Set<string>()
        let sawBlank = false

        const scanLimit = Math.min(limitRows, currentRows.length)
        for (let i = 0; i < scanLimit; i++) {
          const str = toComparableString((currentRows[i] as any)?.[columnKey])
          if (str === '(Blank)') sawBlank = true
          else values.add(str)
          if (values.size >= limitValues) break
        }

        const out = Array.from(values)
        out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        if (sawBlank) out.unshift('(Blank)')
        const finalValues = out.slice(0, sawBlank ? limitValues + 1 : limitValues)

        if (currentProjectId) {
          await setCachedResult(currentProjectId, cacheKey, { values: finalValues })
        }

        self.postMessage({
          type: 'columnOptions',
          requestId: msg.requestId,
          rowsVersion,
          values: finalValues,
        } satisfies ColumnOptionsResponse)
      } catch (e: any) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          rowsVersion,
          error: e?.message || 'Worker failed',
        } satisfies ErrorResponse)
      }
    }

    void run()
  }
}

export type { WorkerMessage, PayloadResponse, PptxPayloadResponse, ColumnOptionsResponse, ErrorResponse }

