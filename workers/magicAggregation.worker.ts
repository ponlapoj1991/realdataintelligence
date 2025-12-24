/// <reference lib="webworker" />

import type { DashboardFilter, DashboardWidget, RawRow, TransformationRule } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import { buildMagicChartPayload, type MagicChartPayload } from '../utils/magicChartPayload'
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

type WorkerMessage = SetRowsMessage | SetSourceMessage | BuildPayloadMessage

type PayloadResponse = {
  type: 'payload'
  requestId: string
  rowsVersion: number
  payload: MagicChartPayload | null
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

const loadRowsFromIndexedDB = async () => {
  const projectId = currentProjectId
  if (!projectId) {
    currentRows = []
    return
  }

  let rows: RawRow[] = []

  if (currentDataSourceId) {
    rows = await getAllDataSourceChunks(projectId, currentDataSourceId)
  }

  if (rows.length === 0) {
    rows = await getAllDataChunks(projectId)
  }

  if (currentTransformRules && currentTransformRules.length > 0) {
    rows = applyTransformation(rows, currentTransformRules)
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
}

export type { WorkerMessage, PayloadResponse, ErrorResponse }

