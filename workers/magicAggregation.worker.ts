/// <reference lib="webworker" />

import type { DashboardFilter, DashboardWidget, RawRow } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import { buildMagicChartPayload, type MagicChartPayload } from '../utils/magicChartPayload'

type SetRowsMessage = {
  type: 'setRows'
  rows: RawRow[]
  rowsVersion: number
}

type BuildPayloadMessage = {
  type: 'buildPayload'
  requestId: string
  rowsVersion: number
  widget: DashboardWidget
  filters?: DashboardFilter[]
  theme?: ChartTheme
}

type WorkerMessage = SetRowsMessage | BuildPayloadMessage

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
    return
  }

  if (msg.type === 'buildPayload') {
    try {
      const rows = currentRowsVersion === msg.rowsVersion ? currentRows : currentRows
      const mergedFilters = mergeDashboardFilters(msg.widget.filters, msg.filters)
      const mergedWidget = mergedFilters ? { ...msg.widget, filters: mergedFilters } : msg.widget
      const payload = buildMagicChartPayload(mergedWidget, rows, { theme: msg.theme })
      self.postMessage({
        type: 'payload',
        requestId: msg.requestId,
        rowsVersion: msg.rowsVersion,
        payload,
      } satisfies PayloadResponse)
    }
    catch (e: any) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        rowsVersion: msg.rowsVersion,
        error: e?.message || 'Worker failed',
      } satisfies ErrorResponse)
    }
  }
}

export type { WorkerMessage, PayloadResponse, ErrorResponse }

