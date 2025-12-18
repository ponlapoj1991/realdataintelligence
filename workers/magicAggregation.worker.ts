/// <reference lib="webworker" />

import type { DashboardWidget, RawRow } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import { applyWidgetFilters } from '../utils/widgetData'
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
  filters?: any[]
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
      const filtered = applyWidgetFilters(rows, msg.filters)
      const payload = buildMagicChartPayload(msg.widget, filtered, { theme: msg.theme })
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

