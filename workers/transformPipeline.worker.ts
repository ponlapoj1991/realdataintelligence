/// <reference lib="webworker" />

import type {
  ColumnConfig,
  DataSourceKind,
  RawRow,
  TransformationRule,
  TransformMethod,
} from '../types'
import {
  getProjectMetadata,
  saveProjectMetadata,
  getDataSourceChunk,
  saveDataSourceChunk,
  getDataChunk,
} from '../utils/storage-v2'
import { analyzeSourceColumn, applyTransformation, getAllUniqueValues } from '../utils/transform'

type PreviewSingleMessage = {
  type: 'previewSingle'
  requestId: string
  projectId: string
  sourceId: string
  rules: TransformationRule[]
  limit: number
}

type PreviewMultiMessage = {
  type: 'previewMulti'
  requestId: string
  projectId: string
  sources: Array<{ sourceId: string; rules: TransformationRule[] }>
  limit: number
}

type BuildSingleMessage = {
  type: 'buildSingle'
  requestId: string
  projectId: string
  sourceId: string
  name: string
  kind: DataSourceKind
  rules: TransformationRule[]
}

type BuildMultiMessage = {
  type: 'buildMulti'
  requestId: string
  projectId: string
  name: string
  kind: DataSourceKind
  sources: Array<{ sourceId: string; rules: TransformationRule[] }>
}

type AnalyzeColumnMessage = {
  type: 'analyzeColumn'
  requestId: string
  projectId: string
  sourceId: string
  key: string
}

type UniqueValuesMessage = {
  type: 'uniqueValues'
  requestId: string
  projectId: string
  sourceId: string
  key: string
  method: TransformMethod
  limit: number
  params?: any
}

type WorkerMessage =
  | PreviewSingleMessage
  | PreviewMultiMessage
  | BuildSingleMessage
  | BuildMultiMessage
  | AnalyzeColumnMessage
  | UniqueValuesMessage

type PreviewResponse = {
  type: 'preview'
  requestId: string
  rows: RawRow[]
  totalRows: number
  columns: ColumnConfig[]
}

type BuildResponse = {
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
  analysis: ReturnType<typeof analyzeSourceColumn>
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

const CHUNK_SIZE = 1000

const columnsFromRules = (rules: TransformationRule[]): ColumnConfig[] => {
  return rules.map((r) => ({
    key: r.targetName,
    type: 'string',
    visible: true,
    label: r.targetName,
  }))
}

const safeGetSourceChunk = async (projectId: string, sourceId: string, chunkIndex: number): Promise<RawRow[]> => {
  const chunk = await getDataSourceChunk(projectId, sourceId, chunkIndex)
  if (chunk.length) return chunk
  // Fallback: legacy active data chunks (v2)
  return await getDataChunk(projectId, chunkIndex)
}

const getSourceStats = (metadata: any, sourceId: string) => {
  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const src = sources.find((s: any) => s?.id === sourceId)
  const rowCount = typeof src?.rowCount === 'number' ? src.rowCount : 0
  const chunkCount = typeof src?.chunkCount === 'number' ? src.chunkCount : Math.ceil(rowCount / CHUNK_SIZE)
  return { rowCount, chunkCount, src }
}

const collectSourceRows = async (params: {
  projectId: string
  sourceId: string
  maxRows: number
}): Promise<RawRow[]> => {
  const metadata = await getProjectMetadata(params.projectId)
  if (!metadata) throw new Error('Project not found')

  const { chunkCount } = getSourceStats(metadata, params.sourceId)
  const maxRows = Math.max(0, params.maxRows || 0)

  const rows: RawRow[] = []
  for (let i = 0; i < chunkCount && rows.length < maxRows; i++) {
    const chunk = await safeGetSourceChunk(params.projectId, params.sourceId, i)
    if (!chunk.length) continue
    for (const row of chunk) {
      rows.push(row)
      if (rows.length >= maxRows) break
    }
  }
  return rows
}

const analyzeColumn = async (msg: AnalyzeColumnMessage): Promise<ColumnAnalysisResponse> => {
  const sample = await collectSourceRows({
    projectId: msg.projectId,
    sourceId: msg.sourceId,
    maxRows: 250,
  })

  return {
    type: 'columnAnalysis',
    requestId: msg.requestId,
    analysis: analyzeSourceColumn(sample, msg.key),
  }
}

const uniqueValues = async (msg: UniqueValuesMessage): Promise<UniqueValuesResponse> => {
  const limit = Math.max(0, msg.limit || 0)
  const sample = await collectSourceRows({
    projectId: msg.projectId,
    sourceId: msg.sourceId,
    maxRows: limit,
  })

  return {
    type: 'uniqueValues',
    requestId: msg.requestId,
    values: getAllUniqueValues(sample, msg.key, msg.method, limit, msg.params),
  }
}

const previewSingle = async (msg: PreviewSingleMessage): Promise<PreviewResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = getSourceStats(metadata, msg.sourceId)
  const limit = Math.max(0, msg.limit || 0)

  const rows: RawRow[] = []
  for (let i = 0; i < chunkCount && rows.length < limit; i++) {
    const chunk = await safeGetSourceChunk(msg.projectId, msg.sourceId, i)
    if (!chunk.length) continue
    const transformed = applyTransformation(chunk, msg.rules)
    for (const r of transformed) {
      rows.push(r)
      if (rows.length >= limit) break
    }
  }

  return {
    type: 'preview',
    requestId: msg.requestId,
    rows,
    totalRows: rowCount,
    columns: columnsFromRules(msg.rules),
  }
}

const previewMulti = async (msg: PreviewMultiMessage): Promise<PreviewResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  let totalRows = 0
  const limit = Math.max(0, msg.limit || 0)
  const rows: RawRow[] = []

  const mergedColumns: ColumnConfig[] = []
  const seen = new Set<string>()
  for (const src of msg.sources) {
    for (const col of columnsFromRules(src.rules)) {
      if (seen.has(col.key)) continue
      seen.add(col.key)
      mergedColumns.push(col)
    }
  }

  for (const src of msg.sources) {
    const { rowCount, chunkCount } = getSourceStats(metadata, src.sourceId)
    totalRows += rowCount
    for (let i = 0; i < chunkCount && rows.length < limit; i++) {
      const chunk = await safeGetSourceChunk(msg.projectId, src.sourceId, i)
      if (!chunk.length) continue
      const transformed = applyTransformation(chunk, src.rules)
      for (const r of transformed) {
        rows.push(r)
        if (rows.length >= limit) break
      }
    }
    if (rows.length >= limit) break
  }

  return {
    type: 'preview',
    requestId: msg.requestId,
    rows,
    totalRows,
    columns: mergedColumns,
  }
}

const buildSingle = async (msg: BuildSingleMessage): Promise<BuildResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = getSourceStats(metadata, msg.sourceId)
  const now = Date.now()
  const sourceId = crypto.randomUUID()
  const columns = columnsFromRules(msg.rules)

  const newSource = {
    id: sourceId,
    name: msg.name,
    kind: msg.kind,
    rows: [],
    rowCount,
    chunkCount,
    columns,
    createdAt: now,
    updatedAt: now,
  }

  const nextMeta = {
    ...metadata,
    dataSources: [...(metadata.dataSources || []), newSource],
    lastModified: now,
  }
  await saveProjectMetadata(nextMeta)

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk(msg.projectId, msg.sourceId, i)
    const transformed = applyTransformation(chunk, msg.rules)
    await saveDataSourceChunk(msg.projectId, sourceId, i, transformed)
  }

  return {
    type: 'buildDone',
    requestId: msg.requestId,
    source: {
      id: sourceId,
      name: msg.name,
      kind: msg.kind,
      rowCount,
      chunkCount,
      columns,
      createdAt: now,
      updatedAt: now,
    },
  }
}

const buildMulti = async (msg: BuildMultiMessage): Promise<BuildResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const now = Date.now()
  const sourceId = crypto.randomUUID()

  let totalRows = 0
  for (const src of msg.sources) {
    const { rowCount } = getSourceStats(metadata, src.sourceId)
    totalRows += rowCount
  }

  const chunkCount = Math.ceil(totalRows / CHUNK_SIZE)

  const mergedColumns: ColumnConfig[] = []
  const seen = new Set<string>()
  for (const src of msg.sources) {
    for (const col of columnsFromRules(src.rules)) {
      if (seen.has(col.key)) continue
      seen.add(col.key)
      mergedColumns.push(col)
    }
  }

  const newSource = {
    id: sourceId,
    name: msg.name,
    kind: msg.kind,
    rows: [],
    rowCount: totalRows,
    chunkCount,
    columns: mergedColumns,
    createdAt: now,
    updatedAt: now,
  }

  const nextMeta = {
    ...metadata,
    dataSources: [...(metadata.dataSources || []), newSource],
    lastModified: now,
  }
  await saveProjectMetadata(nextMeta)

  let outIndex = 0
  let buffer: RawRow[] = []
  const flush = async () => {
    if (buffer.length === 0) return
    await saveDataSourceChunk(msg.projectId, sourceId, outIndex, buffer)
    outIndex += 1
    buffer = []
  }

  for (const src of msg.sources) {
    const { chunkCount: srcChunks } = getSourceStats(metadata, src.sourceId)
    for (let i = 0; i < srcChunks; i++) {
      const chunk = await safeGetSourceChunk(msg.projectId, src.sourceId, i)
      if (!chunk.length) continue
      const transformed = applyTransformation(chunk, src.rules)
      for (const row of transformed) {
        buffer.push(row)
        if (buffer.length >= CHUNK_SIZE) {
          await flush()
        }
      }
    }
  }
  await flush()

  return {
    type: 'buildDone',
    requestId: msg.requestId,
    source: {
      id: sourceId,
      name: msg.name,
      kind: msg.kind,
      rowCount: totalRows,
      chunkCount,
      columns: mergedColumns,
      createdAt: now,
      updatedAt: now,
    },
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data
  const requestId = (msg as any)?.requestId

  const run = async () => {
    try {
      if (msg.type === 'previewSingle') {
        const resp = await previewSingle(msg)
        self.postMessage(resp satisfies PreviewResponse)
        return
      }
      if (msg.type === 'previewMulti') {
        const resp = await previewMulti(msg)
        self.postMessage(resp satisfies PreviewResponse)
        return
      }
      if (msg.type === 'buildSingle') {
        const resp = await buildSingle(msg)
        self.postMessage(resp satisfies BuildResponse)
        return
      }
      if (msg.type === 'buildMulti') {
        const resp = await buildMulti(msg)
        self.postMessage(resp satisfies BuildResponse)
        return
      }
      if (msg.type === 'analyzeColumn') {
        const resp = await analyzeColumn(msg)
        self.postMessage(resp satisfies ColumnAnalysisResponse)
        return
      }
      if (msg.type === 'uniqueValues') {
        const resp = await uniqueValues(msg)
        self.postMessage(resp satisfies UniqueValuesResponse)
        return
      }
    } catch (e: any) {
      self.postMessage({
        type: 'error',
        requestId,
        error: e?.message || 'Worker failed',
      } satisfies ErrorResponse)
    }
  }

  void run()
}

export type {
  WorkerMessage,
  PreviewResponse,
  BuildResponse,
  ColumnAnalysisResponse,
  UniqueValuesResponse,
  ErrorResponse,
}
