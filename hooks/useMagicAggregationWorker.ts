import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import type { DashboardFilter, DashboardWidget, RawRow } from '../types'
import type { ChartTheme } from '../constants/chartTheme'
import type { MagicChartPayload } from '../utils/magicChartPayload'

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

type WorkerResponse = PayloadResponse | ErrorResponse

export interface MagicAggregationWorkerClient {
  isSupported: boolean
  requestPayload: (params: {
    widget: DashboardWidget
    filters?: DashboardFilter[]
    theme?: ChartTheme
    isEditing?: boolean
  }) => Promise<MagicChartPayload | null>
}

export function useMagicAggregationWorker(rows: RawRow[], theme?: ChartTheme): MagicAggregationWorkerClient {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const rowsVersionRef = useRef(0)
  const pendingRef = useRef(
    new Map<
      string,
      {
        rowsVersion: number
        resolve: (payload: MagicChartPayload | null) => void
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
        const pending = pendingRef.current.get(msg.requestId)
        if (!pending) return
        pendingRef.current.delete(msg.requestId)
        if (pending.rowsVersion !== msg.rowsVersion) return
        pending.resolve(msg.payload)
        return
      }

      if (msg.type === 'error') {
        const requestId = msg.requestId
        if (!requestId) return
        const pending = pendingRef.current.get(requestId)
        if (!pending) return
        pendingRef.current.delete(requestId)
        pending.reject(new Error(msg.error || 'Worker failed'))
      }
    }

    worker.onerror = (event) => {
      console.error('[useMagicAggregationWorker] Worker error:', event)
    }

    return () => {
      setReady(false)
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error('Worker terminated'))
      }
      pendingRef.current.clear()
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
    worker.postMessage({ type: 'setRows', rows, rowsVersion })
  }, [rows, isSupported, ready])

  const requestPayload: MagicAggregationWorkerClient['requestPayload'] = useCallback(
    ({ widget, filters, theme: themeOverride, isEditing }) => {
      if (!isSupported || !workerRef.current) {
        return Promise.resolve(null)
      }

      const requestId = crypto.randomUUID()
      const rowsVersion = rowsVersionRef.current

      return new Promise((resolve, reject) => {
        pendingRef.current.set(requestId, { rowsVersion, resolve, reject })
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

  return { isSupported, requestPayload }
}
