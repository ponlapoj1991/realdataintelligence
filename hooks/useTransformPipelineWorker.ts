import { useEffect, useMemo, useRef, useCallback } from 'react'
import type {
  ColumnConfig,
  DataSourceKind,
  RawRow,
  TransformationRule,
  TransformMethod,
} from '../types'

type PreviewResponse = {
  type: 'preview'
  requestId: string
  rows: RawRow[]
  totalRows: number
  columns: ColumnConfig[]
}

type BuildDoneResponse = {
  type: 'buildDone'
  requestId: string
  source: {
    id: string
    name: string
    kind: DataSourceKind
    rowCount: number
    chunkCount: number
    columns: ColumnConfig[]
    createdAt: number
    updatedAt: number
  }
}

type ColumnAnalysisResponse = {
  type: 'columnAnalysis'
  requestId: string
  analysis: {
    isArrayLikely: boolean
    isDateLikely: boolean
    sampleValues: string[]
    uniqueTags: string[]
  }
}

type UniqueValuesResponse = {
  type: 'uniqueValues'
  requestId: string
  values: string[]
}

type ErrorResponse = {
  type: 'error'
  requestId: string
  error: string
}

type WorkerResponse =
  | PreviewResponse
  | BuildDoneResponse
  | ColumnAnalysisResponse
  | UniqueValuesResponse
  | ErrorResponse

export interface TransformPipelineWorkerClient {
  isSupported: boolean
  previewSingle: (params: {
    projectId: string
    sourceId: string
    rules: TransformationRule[]
    limit: number
  }) => Promise<{ rows: RawRow[]; totalRows: number; columns: ColumnConfig[] }>
  previewMulti: (params: {
    projectId: string
    sources: Array<{ sourceId: string; rules: TransformationRule[] }>
    limit: number
  }) => Promise<{ rows: RawRow[]; totalRows: number; columns: ColumnConfig[] }>
  buildSingle: (params: {
    projectId: string
    sourceId: string
    name: string
    kind: DataSourceKind
    rules: TransformationRule[]
  }) => Promise<BuildDoneResponse['source']>
  buildMulti: (params: {
    projectId: string
    name: string
    kind: DataSourceKind
    sources: Array<{ sourceId: string; rules: TransformationRule[] }>
  }) => Promise<BuildDoneResponse['source']>
  analyzeColumn: (params: {
    projectId: string
    sourceId: string
    key: string
  }) => Promise<ColumnAnalysisResponse['analysis']>
  uniqueValues: (params: {
    projectId: string
    sourceId: string
    key: string
    method: TransformMethod
    limit: number
    params?: any
  }) => Promise<string[]>
}

export function useTransformPipelineWorker(): TransformPipelineWorkerClient {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef(
    new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }>()
  )

  const isSupported = useMemo(() => typeof Worker !== 'undefined', [])

  useEffect(() => {
    if (!isSupported) return
    workerRef.current = new Worker(new URL('../workers/transformPipeline.worker.ts', import.meta.url), {
      type: 'module',
    })

    const worker = workerRef.current
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      const pending = pendingRef.current.get((msg as any).requestId)
      if (!pending) return
      pendingRef.current.delete((msg as any).requestId)

      if (msg.type === 'error') {
        pending.reject(new Error(msg.error || 'Worker failed'))
        return
      }

      pending.resolve(msg)
    }

    worker.onerror = (event) => {
      console.error('[useTransformPipelineWorker] Worker error:', event)
    }

    return () => {
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error('Worker terminated'))
      }
      pendingRef.current.clear()
      worker.terminate()
      workerRef.current = null
    }
  }, [isSupported])

  const call = useCallback(
    (payload: any) => {
      if (!isSupported || !workerRef.current) return Promise.reject(new Error('Worker not supported'))
      const requestId = crypto.randomUUID()
      return new Promise<any>((resolve, reject) => {
        pendingRef.current.set(requestId, { resolve, reject })
        workerRef.current!.postMessage({ ...payload, requestId })
      })
    },
    [isSupported]
  )

  const previewSingle: TransformPipelineWorkerClient['previewSingle'] = useCallback(
    async ({ projectId, sourceId, rules, limit }) => {
      const resp = (await call({
        type: 'previewSingle',
        projectId,
        sourceId,
        rules,
        limit,
      })) as PreviewResponse
      return { rows: resp.rows, totalRows: resp.totalRows, columns: resp.columns }
    },
    [call]
  )

  const previewMulti: TransformPipelineWorkerClient['previewMulti'] = useCallback(
    async ({ projectId, sources, limit }) => {
      const resp = (await call({
        type: 'previewMulti',
        projectId,
        sources,
        limit,
      })) as PreviewResponse
      return { rows: resp.rows, totalRows: resp.totalRows, columns: resp.columns }
    },
    [call]
  )

  const buildSingle: TransformPipelineWorkerClient['buildSingle'] = useCallback(
    async ({ projectId, sourceId, name, kind, rules }) => {
      const resp = (await call({
        type: 'buildSingle',
        projectId,
        sourceId,
        name,
        kind,
        rules,
      })) as BuildDoneResponse
      return resp.source
    },
    [call]
  )

  const buildMulti: TransformPipelineWorkerClient['buildMulti'] = useCallback(
    async ({ projectId, name, kind, sources }) => {
      const resp = (await call({
        type: 'buildMulti',
        projectId,
        name,
        kind,
        sources,
      })) as BuildDoneResponse
      return resp.source
    },
    [call]
  )

  const analyzeColumn: TransformPipelineWorkerClient['analyzeColumn'] = useCallback(
    async ({ projectId, sourceId, key }) => {
      const resp = (await call({
        type: 'analyzeColumn',
        projectId,
        sourceId,
        key,
      })) as ColumnAnalysisResponse
      return resp.analysis
    },
    [call]
  )

  const uniqueValues: TransformPipelineWorkerClient['uniqueValues'] = useCallback(
    async ({ projectId, sourceId, key, method, limit, params }) => {
      const resp = (await call({
        type: 'uniqueValues',
        projectId,
        sourceId,
        key,
        method,
        limit,
        params,
      })) as UniqueValuesResponse
      return resp.values
    },
    [call]
  )

  return { isSupported, previewSingle, previewMulti, buildSingle, buildMulti, analyzeColumn, uniqueValues }
}
