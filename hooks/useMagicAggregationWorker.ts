import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import type { DashboardFilter, DashboardWidget, RawRow, TransformationRule } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import type { MagicChartPayload } from '../utils/magicChartPayload'

export type MagicAggregationWorkerSource =
  | { mode: 'rows'; rows: RawRow[] }
  | { mode: 'dataSource'; projectId: string; dataSourceId?: string; dataVersion?: number; transformRules?: TransformationRule[] }

type PayloadResponse = {
  type: 'payload'
  requestId: string
  rowsVersion: number
  payload: MagicChartPayload | null
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

type WorkerResponse = PayloadResponse | ColumnOptionsResponse | ErrorResponse

export interface MagicAggregationWorkerClient {
  isSupported: boolean
  requestPayload: (params: {
    widget: DashboardWidget
    filters?: DashboardFilter[]
    theme?: ChartTheme
    isEditing?: boolean
  }) => Promise<MagicChartPayload | null>
  requestColumnOptions: (params: {
    columnKey: string
    limitRows: number
    limitValues: number
  }) => Promise<string[]>
}

export function useMagicAggregationWorker(rows: RawRow[], theme?: ChartTheme): MagicAggregationWorkerClient
export function useMagicAggregationWorker(source: MagicAggregationWorkerSource, theme?: ChartTheme): MagicAggregationWorkerClient
export function useMagicAggregationWorker(
  arg: RawRow[] | MagicAggregationWorkerSource,
  theme?: ChartTheme
): MagicAggregationWorkerClient {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const rowsVersionRef = useRef(0)
  const pendingPayloadRef = useRef(
    new Map<
      string,
      {
        rowsVersion: number
        resolve: (payload: MagicChartPayload | null) => void
        reject: (err: Error) => void
      }
    >()
  )
  const pendingColumnOptionsRef = useRef(
    new Map<
      string,
      {
        rowsVersion: number
        resolve: (values: string[]) => void
        reject: (err: Error) => void
      }
    >()
  )

  const isSupported = useMemo(() => {
    return typeof Worker !== 'undefined'
  }, [])

  useEffect(() => {
    if (!isSupported) return

    workerRef.current = new Worker(new URL('../workers/magicAggregation.worker.ts', import.meta.url), {
      type: 'module',
    })
    setReady(true)

    const worker = workerRef.current
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'payload') {
        const pending = pendingPayloadRef.current.get(msg.requestId)
        if (!pending) return
        pendingPayloadRef.current.delete(msg.requestId)
        if (pending.rowsVersion !== msg.rowsVersion) {
          // Avoid leaving callers hanging if rows were updated mid-flight
          pending.resolve(null)
          return
        }
        pending.resolve(msg.payload)
        return
      }

      if (msg.type === 'columnOptions') {
        const pending = pendingColumnOptionsRef.current.get(msg.requestId)
        if (!pending) return
        pendingColumnOptionsRef.current.delete(msg.requestId)
        if (pending.rowsVersion !== msg.rowsVersion) {
          pending.resolve([])
          return
        }
        pending.resolve(Array.isArray(msg.values) ? msg.values : [])
        return
      }

      if (msg.type === 'error') {
        const requestId = msg.requestId
        if (!requestId) return

        const pendingPayload = pendingPayloadRef.current.get(requestId)
        if (pendingPayload) {
          pendingPayloadRef.current.delete(requestId)
          pendingPayload.reject(new Error(msg.error || 'Worker failed'))
          return
        }

        const pendingOpts = pendingColumnOptionsRef.current.get(requestId)
        if (pendingOpts) {
          pendingColumnOptionsRef.current.delete(requestId)
          pendingOpts.reject(new Error(msg.error || 'Worker failed'))
        }
      }
    }

    worker.onerror = (event) => {
      console.error('[useMagicAggregationWorker] Worker error:', event)
    }

    return () => {
      setReady(false)
      for (const [, pending] of pendingPayloadRef.current) {
        pending.reject(new Error('Worker terminated'))
      }
      pendingPayloadRef.current.clear()
      for (const [, pending] of pendingColumnOptionsRef.current) {
        pending.reject(new Error('Worker terminated'))
      }
      pendingColumnOptionsRef.current.clear()
      worker.terminate()
      workerRef.current = null
    }
  }, [isSupported])

  useEffect(() => {
    if (!isSupported) return
    const worker = workerRef.current
    if (!worker) return
    if (!ready) return

    rowsVersionRef.current += 1
    const rowsVersion = rowsVersionRef.current

    if (Array.isArray(arg)) {
      worker.postMessage({ type: 'setRows', rows: arg, rowsVersion })
      return
    }

    const source: MagicAggregationWorkerSource = arg
    if (source.mode === 'rows') {
      worker.postMessage({ type: 'setRows', rows: source.rows, rowsVersion })
      return
    }

    worker.postMessage({
      type: 'setSource',
      projectId: source.projectId,
      dataSourceId: source.dataSourceId,
      dataVersion: source.dataVersion,
      transformRules: source.transformRules,
      rowsVersion,
    })
  }, [arg, isSupported, ready])

  const requestPayload: MagicAggregationWorkerClient['requestPayload'] = useCallback(
    ({ widget, filters, theme: themeOverride, isEditing }) => {
      if (!isSupported || !workerRef.current) {
        return Promise.resolve(null)
      }

      const requestId = crypto.randomUUID()
      const rowsVersion = rowsVersionRef.current

      return new Promise((resolve, reject) => {
        pendingPayloadRef.current.set(requestId, { rowsVersion, resolve, reject })
        workerRef.current!.postMessage({
          type: 'buildPayload',
          requestId,
          rowsVersion,
          widget,
          filters,
          theme: themeOverride ?? theme,
          isEditing,
        })
      })
    },
    [isSupported, theme]
  )

  const requestColumnOptions: MagicAggregationWorkerClient['requestColumnOptions'] = useCallback(
    ({ columnKey, limitRows, limitValues }) => {
      if (!isSupported || !workerRef.current) {
        return Promise.resolve([])
      }

      const requestId = crypto.randomUUID()
      const rowsVersion = rowsVersionRef.current

      return new Promise((resolve, reject) => {
        pendingColumnOptionsRef.current.set(requestId, { rowsVersion, resolve, reject })
        workerRef.current!.postMessage({
          type: 'columnOptions',
          requestId,
          rowsVersion,
          columnKey,
          limitRows,
          limitValues,
        })
      })
    },
    [isSupported]
  )

  return { isSupported, requestPayload, requestColumnOptions }
}
