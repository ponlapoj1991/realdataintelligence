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

type CleanPreviewResponse = {
  type: 'cleanPreview'
  requestId: string
  rows: RawRow[]
  rowIndices: number[]
  totalRows: number
}

type CleanDoneResponse = {
  type: 'cleanDone'
  requestId: string
  rowCount: number
  chunkCount: number
  updatedAt: number
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
  | CleanPreviewResponse
  | CleanDoneResponse
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
  cleanPreview: (params: {
    projectId: string
    sourceId: string
    searchQuery: string
    limit: number
  }) => Promise<{ rows: RawRow[]; rowIndices: number[]; totalRows: number }>
  cleanApplyFindReplace: (params: {
    projectId: string
    sourceId: string
    targetCol: string
    findText: string
    replaceText: string
  }) => Promise<CleanDoneResponse>
  cleanApplyTransformDate: (params: { projectId: string; sourceId: string; columnKey: string }) => Promise<CleanDoneResponse>
  cleanApplyExplode: (params: {
    projectId: string
    sourceId: string
    columnKey: string
    delimiter: string
  }) => Promise<CleanDoneResponse>
  cleanDeleteRow: (params: { projectId: string; sourceId: string; rowIndex: number }) => Promise<CleanDoneResponse>
  cleanUpdateColumnType: (params: {
    projectId: string
    sourceId: string
    columnKey: string
    columnType: ColumnConfig['type']
  }) => Promise<CleanDoneResponse>
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

  const cleanPreview: TransformPipelineWorkerClient['cleanPreview'] = useCallback(
    async ({ projectId, sourceId, searchQuery, limit }) => {
      const resp = (await call({
        type: 'cleanPreview',
        projectId,
        sourceId,
        searchQuery,
        limit,
      })) as CleanPreviewResponse
      return { rows: resp.rows, rowIndices: resp.rowIndices, totalRows: resp.totalRows }
    },
    [call]
  )

  const cleanApplyFindReplace: TransformPipelineWorkerClient['cleanApplyFindReplace'] = useCallback(
    async ({ projectId, sourceId, targetCol, findText, replaceText }) => {
      const resp = (await call({
        type: 'cleanApplyFindReplace',
        projectId,
        sourceId,
        targetCol,
        findText,
        replaceText,
      })) as CleanDoneResponse
      return resp
    },
    [call]
  )

  const cleanApplyTransformDate: TransformPipelineWorkerClient['cleanApplyTransformDate'] = useCallback(
    async ({ projectId, sourceId, columnKey }) => {
      const resp = (await call({
        type: 'cleanApplyTransformDate',
        projectId,
        sourceId,
        columnKey,
      })) as CleanDoneResponse
      return resp
    },
    [call]
  )

  const cleanApplyExplode: TransformPipelineWorkerClient['cleanApplyExplode'] = useCallback(
    async ({ projectId, sourceId, columnKey, delimiter }) => {
      const resp = (await call({
        type: 'cleanApplyExplode',
        projectId,
        sourceId,
        columnKey,
        delimiter,
      })) as CleanDoneResponse
      return resp
    },
    [call]
  )

  const cleanDeleteRow: TransformPipelineWorkerClient['cleanDeleteRow'] = useCallback(
    async ({ projectId, sourceId, rowIndex }) => {
      const resp = (await call({
        type: 'cleanDeleteRow',
        projectId,
        sourceId,
        rowIndex,
      })) as CleanDoneResponse
      return resp
    },
    [call]
  )

  const cleanUpdateColumnType: TransformPipelineWorkerClient['cleanUpdateColumnType'] = useCallback(
    async ({ projectId, sourceId, columnKey, columnType }) => {
      const resp = (await call({
        type: 'cleanUpdateColumnType',
        projectId,
        sourceId,
        columnKey,
        columnType,
      })) as CleanDoneResponse
      return resp
    },
    [call]
  )

  return {
    isSupported,
    previewSingle,
    previewMulti,
    buildSingle,
    buildMulti,
    analyzeColumn,
    uniqueValues,
    cleanPreview,
    cleanApplyFindReplace,
    cleanApplyTransformDate,
    cleanApplyExplode,
    cleanDeleteRow,
    cleanUpdateColumnType,
  }
}
