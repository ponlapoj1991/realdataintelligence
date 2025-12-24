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
  deleteAllDataSourceChunksForSource,
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

type BuildMultiToTargetMessage = {
  type: 'buildMultiToTarget'
  requestId: string
  projectId: string
  targetSourceId: string
  mode: 'append' | 'replace'
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

type CleanPreviewMessage = {
  type: 'cleanPreview'
  requestId: string
  projectId: string
  sourceId: string
  searchQuery: string
  limit: number
  filters?: Record<string, string[] | null>
}

type CleanQueryPageMessage = {
  type: 'cleanQueryPage'
  requestId: string
  projectId: string
  sourceId: string
  searchQuery: string
  page: number
  pageSize: number
  filters?: Record<string, string[] | null>
}

type CleanApplyFindReplaceMessage = {
  type: 'cleanApplyFindReplace'
  requestId: string
  projectId: string
  sourceId: string
  targetCol: string
  findText: string
  replaceText: string
}

type CleanApplyTransformDateMessage = {
  type: 'cleanApplyTransformDate'
  requestId: string
  projectId: string
  sourceId: string
  columnKey: string
}

type CleanApplyExplodeMessage = {
  type: 'cleanApplyExplode'
  requestId: string
  projectId: string
  sourceId: string
  columnKey: string
  delimiter: string
}

type CleanDeleteRowMessage = {
  type: 'cleanDeleteRow'
  requestId: string
  projectId: string
  sourceId: string
  rowIndex: number
}

type CleanUpdateColumnTypeMessage = {
  type: 'cleanUpdateColumnType'
  requestId: string
  projectId: string
  sourceId: string
  columnKey: string
  columnType: ColumnConfig['type']
}

type CleanColumnOptionsMessage = {
  type: 'cleanColumnOptions'
  requestId: string
  projectId: string
  sourceId: string
  columnKey: string
  limitRows: number
  limitValues: number
}

type CloneSourceMessage = {
  type: 'cloneSource'
  requestId: string
  projectId: string
  sourceId: string
  name: string
  kind: DataSourceKind
}

type WorkerMessage =
  | PreviewSingleMessage
  | PreviewMultiMessage
  | BuildSingleMessage
  | BuildMultiMessage
  | BuildMultiToTargetMessage
  | AnalyzeColumnMessage
  | UniqueValuesMessage
  | CleanPreviewMessage
  | CleanQueryPageMessage
  | CleanApplyFindReplaceMessage
  | CleanApplyTransformDateMessage
  | CleanApplyExplodeMessage
  | CleanDeleteRowMessage
  | CleanUpdateColumnTypeMessage
  | CleanColumnOptionsMessage
  | CloneSourceMessage

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

type CleanPreviewResponse = {
  type: 'cleanPreview'
  requestId: string
  rows: RawRow[]
  rowIndices: number[]
  totalRows: number
}

type CleanQueryPageResponse = {
  type: 'cleanQueryPage'
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

type CleanColumnOptionsResponse = {
  type: 'cleanColumnOptions'
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

const safeGetSourceChunk = async (params: {
  metadata: any
  projectId: string
  sourceId: string
  chunkIndex: number
}): Promise<RawRow[]> => {
  const chunk = await getDataSourceChunk(params.projectId, params.sourceId, params.chunkIndex)
  if (chunk.length) return chunk

  const sources = Array.isArray(params.metadata?.dataSources) ? params.metadata.dataSources : []
  const src = sources.find((s: any) => s?.id === params.sourceId)

  // Fallback: legacy metadata that still embeds rows (pre-v3)
  if (src && Array.isArray(src.rows) && src.rows.length > 0) {
    const start = params.chunkIndex * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, src.rows.length)
    return (src.rows as RawRow[]).slice(start, end)
  }

  // Fallback: legacy active data chunks (v2) ONLY when source is the active one
  if (params.metadata?.activeDataSourceId === params.sourceId) {
    return await getDataChunk(params.projectId, params.chunkIndex)
  }

  return []
}

const getSourceStats = (metadata: any, sourceId: string) => {
  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const src = sources.find((s: any) => s?.id === sourceId)
  const rowCount =
    typeof src?.rowCount === 'number'
      ? src.rowCount
      : Array.isArray(src?.rows)
        ? src.rows.length
        : 0
  const chunkCount = typeof src?.chunkCount === 'number' ? src.chunkCount : Math.ceil(rowCount / CHUNK_SIZE)
  return { rowCount, chunkCount, src }
}

const inferredSourceStatsCache = new Map<string, { version: number; rowCount: number; chunkCount: number }>()

const getSourceVersion = (metadata: any, sourceId: string) => {
  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const src = sources.find((s: any) => s?.id === sourceId)
  if (typeof src?.updatedAt === 'number') return src.updatedAt
  if (typeof metadata?.lastModified === 'number') return metadata.lastModified
  return 0
}

const inferSourceStatsFromChunks = async (params: {
  metadata: any
  projectId: string
  sourceId: string
}): Promise<{ rowCount: number; chunkCount: number }> => {
  const first = await safeGetSourceChunk({
    metadata: params.metadata,
    projectId: params.projectId,
    sourceId: params.sourceId,
    chunkIndex: 0,
  })
  if (!first.length) return { rowCount: 0, chunkCount: 0 }

  let high = 1
  while (true) {
    const chunk = await safeGetSourceChunk({
      metadata: params.metadata,
      projectId: params.projectId,
      sourceId: params.sourceId,
      chunkIndex: high,
    })
    if (!chunk.length) break
    high *= 2
  }

  let left = Math.floor(high / 2)
  let right = high - 1
  let lastIndex = 0
  let lastSize = first.length

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2)
    const chunk = await safeGetSourceChunk({
      metadata: params.metadata,
      projectId: params.projectId,
      sourceId: params.sourceId,
      chunkIndex: mid,
    })
    if (chunk.length) {
      lastIndex = mid
      lastSize = chunk.length
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  const chunkCount = lastIndex + 1
  const rowCount = lastIndex * CHUNK_SIZE + lastSize
  return { rowCount, chunkCount }
}

const resolveSourceStats = async (params: {
  metadata: any
  projectId: string
  sourceId: string
}): Promise<{ rowCount: number; chunkCount: number; src: any }> => {
  const { rowCount, chunkCount, src } = getSourceStats(params.metadata, params.sourceId)
  const version = getSourceVersion(params.metadata, params.sourceId)
  const cacheKey = `${params.projectId}:${params.sourceId}`
  const cached = inferredSourceStatsCache.get(cacheKey)

  if (cached && cached.version === version) {
    return { rowCount: cached.rowCount, chunkCount: cached.chunkCount, src }
  }

  if (rowCount > 0 || chunkCount > 0) {
    inferredSourceStatsCache.set(cacheKey, { version, rowCount, chunkCount })
    return { rowCount, chunkCount, src }
  }

  const inferred = await inferSourceStatsFromChunks(params)
  inferredSourceStatsCache.set(cacheKey, { version, ...inferred })
  return { ...inferred, src }
}

const collectSourceRows = async (params: {
  projectId: string
  sourceId: string
  maxRows: number
}): Promise<RawRow[]> => {
  const metadata = await getProjectMetadata(params.projectId)
  if (!metadata) throw new Error('Project not found')

  const { chunkCount } = await resolveSourceStats({
    metadata,
    projectId: params.projectId,
    sourceId: params.sourceId,
  })
  const maxRows = Math.max(0, params.maxRows || 0)

  const rows: RawRow[] = []
  for (let i = 0; i < chunkCount && rows.length < maxRows; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: params.projectId,
      sourceId: params.sourceId,
      chunkIndex: i,
    })
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
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
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
      const chunk = await safeGetSourceChunk({
        metadata,
        projectId: msg.projectId,
        sourceId: src.sourceId,
        chunkIndex: i,
      })
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
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
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
      const chunk = await safeGetSourceChunk({
        metadata,
        projectId: msg.projectId,
        sourceId: src.sourceId,
        chunkIndex: i,
      })
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

const mergeColumnsPreferExisting = (existing: ColumnConfig[], incoming: ColumnConfig[]): ColumnConfig[] => {
  const map = new Map<string, ColumnConfig>()
  for (const col of existing) map.set(col.key, col)
  for (const col of incoming) {
    if (!map.has(col.key)) map.set(col.key, col)
  }
  return Array.from(map.values())
}

const buildMultiToTarget = async (msg: BuildMultiToTargetMessage): Promise<BuildResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const target = Array.isArray(metadata.dataSources)
    ? (metadata.dataSources as any[]).find((s) => s?.id === msg.targetSourceId)
    : null
  if (!target) throw new Error('Target table not found')

  const now = Date.now()

  let totalRows = 0
  for (const src of msg.sources) {
    const { rowCount } = getSourceStats(metadata, src.sourceId)
    totalRows += rowCount
  }

  const mergedColumns: ColumnConfig[] = []
  const seen = new Set<string>()
  for (const src of msg.sources) {
    for (const col of columnsFromRules(src.rules)) {
      if (seen.has(col.key)) continue
      seen.add(col.key)
      mergedColumns.push(col)
    }
  }

  const existingColumns = Array.isArray(target.columns) ? (target.columns as ColumnConfig[]) : []
  const nextColumns =
    msg.mode === 'replace' ? mergedColumns : mergeColumnsPreferExisting(existingColumns, mergedColumns)

  if (msg.mode === 'replace') {
    await deleteAllDataSourceChunksForSource(msg.projectId, msg.targetSourceId)
  }

  const existingRowCount = typeof target.rowCount === 'number' ? target.rowCount : 0
  const existingChunkCount =
    typeof target.chunkCount === 'number' ? target.chunkCount : Math.ceil(existingRowCount / CHUNK_SIZE)

  let outIndex = 0
  let buffer: RawRow[] = []

  if (msg.mode === 'append' && existingRowCount > 0) {
    const remainder = existingRowCount % CHUNK_SIZE
    if (remainder === 0) {
      outIndex = existingChunkCount
    } else {
      outIndex = Math.max(0, existingChunkCount - 1)
      buffer = await safeGetSourceChunk({
        metadata,
        projectId: msg.projectId,
        sourceId: msg.targetSourceId,
        chunkIndex: outIndex,
      })
    }
  }

  const flushRemainder = async () => {
    if (buffer.length === 0) return
    await saveDataSourceChunk(msg.projectId, msg.targetSourceId, outIndex, buffer)
    outIndex += 1
    buffer = []
  }

  const pushRow = async (row: RawRow) => {
    buffer.push(row)
    while (buffer.length >= CHUNK_SIZE) {
      const head = buffer.slice(0, CHUNK_SIZE)
      await saveDataSourceChunk(msg.projectId, msg.targetSourceId, outIndex, head)
      outIndex += 1
      buffer = buffer.slice(CHUNK_SIZE)
    }
  }

  if (msg.mode === 'replace') {
    outIndex = 0
    buffer = []
  }

  for (const src of msg.sources) {
    const { chunkCount: srcChunks } = getSourceStats(metadata, src.sourceId)
    for (let i = 0; i < srcChunks; i++) {
      const chunk = await safeGetSourceChunk({
        metadata,
        projectId: msg.projectId,
        sourceId: src.sourceId,
        chunkIndex: i,
      })
      if (!chunk.length) continue
      const transformed = applyTransformation(chunk, src.rules)
      for (const row of transformed) {
        await pushRow(row)
      }
    }
  }
  await flushRemainder()

  const nextRowCount = msg.mode === 'append' ? existingRowCount + totalRows : totalRows
  const nextChunkCount = Math.ceil(nextRowCount / CHUNK_SIZE)

  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const nextSources = sources.map((s: any) => {
    if (s?.id !== msg.targetSourceId) return s
    return {
      ...s,
      columns: nextColumns,
      rowCount: nextRowCount,
      chunkCount: nextChunkCount,
      updatedAt: now,
      rows: [],
    }
  })

  await saveProjectMetadata({
    ...metadata,
    dataSources: nextSources,
    lastModified: now,
  })

  return {
    type: 'buildDone',
    requestId: msg.requestId,
    source: {
      id: msg.targetSourceId,
      name: String(target.name || ''),
      kind: target.kind as DataSourceKind,
      rowCount: nextRowCount,
      chunkCount: nextChunkCount,
      columns: nextColumns,
      createdAt: typeof target.createdAt === 'number' ? target.createdAt : now,
      updatedAt: now,
    },
  }
}

const smartParseDateLite = (val: any): string | null => {
  if (val === null || val === undefined || val === '') return null

  if (typeof val === 'number') {
    if (val > 30000 && val < 60000) {
      const totalMilliseconds = Math.round((val - 25569) * 86400 * 1000)
      const date = new Date(totalMilliseconds)
      return date.toISOString()
    }
  }

  const strVal = String(val).trim()
  if (!strVal) return null

  const shortYearRegex = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/
  const shortYearMatch = strVal.match(shortYearRegex)
  if (shortYearMatch) {
    const d = parseInt(shortYearMatch[1], 10)
    const m = parseInt(shortYearMatch[2], 10) - 1
    let y = parseInt(shortYearMatch[3], 10)
    y += 2000
    const date = new Date(y, m, d)
    if (!isNaN(date.getTime())) return date.toISOString()
  }

  let date = new Date(strVal)
  if (isNaN(date.getTime())) {
    const parts = strVal.split(/[\/\-\.\s:]/)
    if (parts.length >= 3) {
      const d = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10) - 1
      let y = parseInt(parts[2], 10)
      if (y > 2400) y -= 543
      if (y < 100) y += 2000
      let hours = 0
      let mins = 0
      if (parts.length >= 5) {
        hours = parseInt(parts[3], 10) || 0
        mins = parseInt(parts[4], 10) || 0
      }
      date = new Date(y, m, d, hours, mins, 0)
    }
  }

  if (!isNaN(date.getTime())) return date.toISOString()
  return null
}

const cleanPreview = async (msg: CleanPreviewMessage): Promise<CleanPreviewResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = await resolveSourceStats({
    metadata,
    projectId: msg.projectId,
    sourceId: msg.sourceId,
  })
  const limit = Math.max(0, msg.limit || 0)
  const search = String(msg.searchQuery || '').trim().toLowerCase()

  const rows: RawRow[] = []
  const rowIndices: number[] = []
  const filters = msg.filters && typeof msg.filters === 'object' ? msg.filters : {}
  const filterEntries = Object.entries(filters).filter(([, v]) => Array.isArray(v) && v.length > 0) as Array<
    [string, string[]]
  >

  for (let i = 0; i < chunkCount && rows.length < limit; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]
      if (filterEntries.length) {
        let ok = true
        for (const [col, allowed] of filterEntries) {
          const raw = (row as any)[col]
          const strVal = raw === null || raw === undefined || raw === '' ? '(Blank)' : String(raw)
          if (!allowed.includes(strVal)) {
            ok = false
            break
          }
        }
        if (!ok) continue
      }
      const match =
        !search ||
        Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(search))
      if (match) {
        rows.push(row)
        rowIndices.push(i * CHUNK_SIZE + j)
        if (rows.length >= limit) break
      }
    }
  }

  return {
    type: 'cleanPreview',
    requestId: msg.requestId,
    rows,
    rowIndices,
    totalRows: rowCount,
  }
}

const cleanQueryPage = async (msg: CleanQueryPageMessage): Promise<CleanQueryPageResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = await resolveSourceStats({
    metadata,
    projectId: msg.projectId,
    sourceId: msg.sourceId,
  })
  const pageSize = Math.max(1, msg.pageSize || 1)
  const page = Math.max(0, msg.page || 0)
  const offset = page * pageSize
  const end = offset + pageSize
  const search = String(msg.searchQuery || '').trim().toLowerCase()

  const rows: RawRow[] = []
  const rowIndices: number[] = []
  const filters = msg.filters && typeof msg.filters === 'object' ? msg.filters : {}
  const filterEntries = Object.entries(filters).filter(([, v]) => Array.isArray(v) && v.length > 0) as Array<
    [string, string[]]
  >

  if (!search && filterEntries.length === 0) {
    const startRow = offset
    const endRow = Math.min(end, rowCount)

    if (startRow >= rowCount) {
      return {
        type: 'cleanQueryPage',
        requestId: msg.requestId,
        rows: [],
        rowIndices: [],
        totalRows: rowCount,
      }
    }

    const startChunk = Math.floor(startRow / CHUNK_SIZE)
    const endChunk = Math.ceil(endRow / CHUNK_SIZE)

    const buffer: RawRow[] = []
    for (let i = startChunk; i < endChunk && i < chunkCount; i++) {
      const chunk = await safeGetSourceChunk({
        metadata,
        projectId: msg.projectId,
        sourceId: msg.sourceId,
        chunkIndex: i,
      })
      buffer.push(...chunk)
    }

    const offsetInFirstChunk = startRow % CHUNK_SIZE
    const rows = buffer.slice(offsetInFirstChunk, offsetInFirstChunk + pageSize)
    const rowIndices = rows.map((_, idx) => startRow + idx)

    return {
      type: 'cleanQueryPage',
      requestId: msg.requestId,
      rows,
      rowIndices,
      totalRows: rowCount,
    }
  }

  let matched = 0

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]

      if (filterEntries.length) {
        let ok = true
        for (const [col, allowed] of filterEntries) {
          const raw = (row as any)[col]
          const strVal = raw === null || raw === undefined || raw === '' ? '(Blank)' : String(raw)
          if (!allowed.includes(strVal)) {
            ok = false
            break
          }
        }
        if (!ok) continue
      }

      const match =
        !search ||
        Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(search))
      if (!match) continue

      if (matched >= offset && matched < end) {
        rows.push(row)
        rowIndices.push(i * CHUNK_SIZE + j)
      }
      matched += 1
    }
  }

  return {
    type: 'cleanQueryPage',
    requestId: msg.requestId,
    rows,
    rowIndices,
    totalRows: matched,
  }
}

const cleanColumnOptions = async (msg: CleanColumnOptionsMessage): Promise<CleanColumnOptionsResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { chunkCount } = await resolveSourceStats({
    metadata,
    projectId: msg.projectId,
    sourceId: msg.sourceId,
  })
  const limitRows = Math.max(0, msg.limitRows || 0)
  const limitValues = Math.max(0, msg.limitValues || 0)

  const values = new Set<string>()
  let scanned = 0
  let sawBlank = false

  for (let i = 0; i < chunkCount && scanned < limitRows && values.size < limitValues; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue
    for (const row of chunk) {
      const raw = (row as any)[msg.columnKey]
      if (raw === null || raw === undefined || raw === '') {
        sawBlank = true
      } else {
        values.add(String(raw))
      }
      scanned += 1
      if (scanned >= limitRows || values.size >= limitValues) break
    }
  }

  const out = Array.from(values).sort()
  if (sawBlank) out.unshift('(Blank)')

  return {
    type: 'cleanColumnOptions',
    requestId: msg.requestId,
    values: out,
  }
}

const updateSourceColumns = (metadata: any, sourceId: string, updater: (cols: ColumnConfig[]) => ColumnConfig[]) => {
  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const nextSources = sources.map((s: any) => {
    if (s?.id !== sourceId) return s
    return { ...s, columns: updater(Array.isArray(s.columns) ? s.columns : []), updatedAt: Date.now() }
  })
  return { ...metadata, dataSources: nextSources, lastModified: Date.now() }
}

const cleanUpdateColumnType = async (msg: CleanUpdateColumnTypeMessage): Promise<CleanDoneResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')
  const now = Date.now()

  const nextMeta = updateSourceColumns(metadata, msg.sourceId, (cols) =>
    cols.map((c) => (c.key === msg.columnKey ? { ...c, type: msg.columnType } : c))
  )
  await saveProjectMetadata({ ...nextMeta, lastModified: now })

  const { rowCount, chunkCount } = getSourceStats(nextMeta, msg.sourceId)
  return { type: 'cleanDone', requestId: msg.requestId, rowCount, chunkCount, updatedAt: now }
}

const cleanApplyFindReplace = async (msg: CleanApplyFindReplaceMessage): Promise<CleanDoneResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = getSourceStats(metadata, msg.sourceId)
  const now = Date.now()

  const findText = String(msg.findText || '')
  const replaceText = String(msg.replaceText || '')
  const targetCol = String(msg.targetCol || 'all')

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    let changed = false
    const nextChunk = chunk.map((row) => {
      const nextRow: RawRow = { ...row }
      const keys = targetCol === 'all' ? Object.keys(nextRow) : [targetCol]
      for (const key of keys) {
        const v = nextRow[key]
        if (typeof v === 'string' && v.includes(findText)) {
          nextRow[key] = v.split(findText).join(replaceText)
          changed = true
        }
      }
      return nextRow
    })

    if (changed) {
      await saveDataSourceChunk(msg.projectId, msg.sourceId, i, nextChunk)
    }
  }

  const nextMeta = updateSourceColumns(metadata, msg.sourceId, (cols) => cols)
  await saveProjectMetadata({ ...nextMeta, lastModified: now })

  return { type: 'cleanDone', requestId: msg.requestId, rowCount, chunkCount, updatedAt: now }
}

const cleanApplyTransformDate = async (msg: CleanApplyTransformDateMessage): Promise<CleanDoneResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = getSourceStats(metadata, msg.sourceId)
  const now = Date.now()

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    let changed = false
    const nextChunk = chunk.map((row) => {
      const v = row[msg.columnKey]
      if (typeof v === 'string') {
        const parsed = smartParseDateLite(v)
        if (parsed && parsed !== v) {
          changed = true
          return { ...row, [msg.columnKey]: parsed }
        }
      }
      return row
    })

    if (changed) {
      await saveDataSourceChunk(msg.projectId, msg.sourceId, i, nextChunk)
    }
  }

  const nextMeta = updateSourceColumns(metadata, msg.sourceId, (cols) =>
    cols.map((c) => (c.key === msg.columnKey ? { ...c, type: 'date' } : c))
  )
  await saveProjectMetadata({ ...nextMeta, lastModified: now })

  return { type: 'cleanDone', requestId: msg.requestId, rowCount, chunkCount, updatedAt: now }
}

const cleanApplyExplode = async (msg: CleanApplyExplodeMessage): Promise<CleanDoneResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount } = getSourceStats(metadata, msg.sourceId)
  const now = Date.now()
  const delimiter = String(msg.delimiter || ',')

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    let changed = false
    const nextChunk = chunk.map((row) => {
      const v = row[msg.columnKey]
      if (typeof v === 'string') {
        const parts = v
          .split(delimiter)
          .map((s) => s.trim())
          .filter(Boolean)
        const next = JSON.stringify(parts)
        if (next !== v) {
          changed = true
          return { ...row, [msg.columnKey]: next }
        }
      }
      return row
    })

    if (changed) {
      await saveDataSourceChunk(msg.projectId, msg.sourceId, i, nextChunk)
    }
  }

  const nextMeta = updateSourceColumns(metadata, msg.sourceId, (cols) =>
    cols.map((c) => (c.key === msg.columnKey ? { ...c, type: 'tag_array' } : c))
  )
  await saveProjectMetadata({ ...nextMeta, lastModified: now })

  return { type: 'cleanDone', requestId: msg.requestId, rowCount, chunkCount, updatedAt: now }
}

const cleanDeleteRow = async (msg: CleanDeleteRowMessage): Promise<CleanDoneResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')
  const { rowCount, chunkCount, src } = getSourceStats(metadata, msg.sourceId)
  const indexToDelete = Math.max(0, msg.rowIndex)

  if (indexToDelete >= rowCount) {
    return { type: 'cleanDone', requestId: msg.requestId, rowCount, chunkCount, updatedAt: Date.now() }
  }

  await deleteAllDataSourceChunksForSource(msg.projectId, msg.sourceId)

  let outIndex = 0
  let buffer: RawRow[] = []

  const flush = async () => {
    if (!buffer.length) return
    await saveDataSourceChunk(msg.projectId, msg.sourceId, outIndex, buffer)
    outIndex += 1
    buffer = []
  }

  for (let i = 0; i < chunkCount; i++) {
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (!chunk.length) continue

    for (let j = 0; j < chunk.length; j++) {
      const gi = i * CHUNK_SIZE + j
      if (gi === indexToDelete) continue
      buffer.push(chunk[j])
      if (buffer.length >= CHUNK_SIZE) await flush()
    }
  }
  await flush()

  const nextRowCount = Math.max(0, rowCount - 1)
  const nextChunkCount = Math.ceil(nextRowCount / CHUNK_SIZE)
  const now = Date.now()
  const sources = Array.isArray(metadata?.dataSources) ? metadata.dataSources : []
  const nextSources = sources.map((s: any) => {
    if (s?.id !== msg.sourceId) return s
    return { ...s, rowCount: nextRowCount, chunkCount: nextChunkCount, updatedAt: now, rows: [] }
  })
  const shouldUpdateLegacy = metadata?.activeDataSourceId === msg.sourceId && src
  await saveProjectMetadata({
    ...metadata,
    dataSources: nextSources,
    ...(shouldUpdateLegacy ? { rowCount: nextRowCount, chunkCount: nextChunkCount } : {}),
    lastModified: now,
  })

  return { type: 'cleanDone', requestId: msg.requestId, rowCount: nextRowCount, chunkCount: nextChunkCount, updatedAt: now }
}

const cloneSource = async (msg: CloneSourceMessage): Promise<BuildResponse> => {
  const metadata = await getProjectMetadata(msg.projectId)
  if (!metadata) throw new Error('Project not found')

  const { rowCount, chunkCount, src } = getSourceStats(metadata, msg.sourceId)
  if (!src) throw new Error('Source not found')

  const now = Date.now()
  const sourceId = crypto.randomUUID()

  const columns = Array.isArray((src as any).columns) ? ((src as any).columns as ColumnConfig[]) : []

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
    const chunk = await safeGetSourceChunk({
      metadata,
      projectId: msg.projectId,
      sourceId: msg.sourceId,
      chunkIndex: i,
    })
    if (chunk.length) {
      await saveDataSourceChunk(msg.projectId, sourceId, i, chunk)
    } else {
      await saveDataSourceChunk(msg.projectId, sourceId, i, [])
    }
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
      if (msg.type === 'buildMultiToTarget') {
        const resp = await buildMultiToTarget(msg)
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
      if (msg.type === 'cleanPreview') {
        const resp = await cleanPreview(msg)
        self.postMessage(resp satisfies CleanPreviewResponse)
        return
      }
      if (msg.type === 'cleanQueryPage') {
        const resp = await cleanQueryPage(msg)
        self.postMessage(resp satisfies CleanQueryPageResponse)
        return
      }
      if (msg.type === 'cleanApplyFindReplace') {
        const resp = await cleanApplyFindReplace(msg)
        self.postMessage(resp satisfies CleanDoneResponse)
        return
      }
      if (msg.type === 'cleanApplyTransformDate') {
        const resp = await cleanApplyTransformDate(msg)
        self.postMessage(resp satisfies CleanDoneResponse)
        return
      }
      if (msg.type === 'cleanApplyExplode') {
        const resp = await cleanApplyExplode(msg)
        self.postMessage(resp satisfies CleanDoneResponse)
        return
      }
      if (msg.type === 'cleanDeleteRow') {
        const resp = await cleanDeleteRow(msg)
        self.postMessage(resp satisfies CleanDoneResponse)
        return
      }
      if (msg.type === 'cleanUpdateColumnType') {
        const resp = await cleanUpdateColumnType(msg)
        self.postMessage(resp satisfies CleanDoneResponse)
        return
      }
      if (msg.type === 'cleanColumnOptions') {
        const resp = await cleanColumnOptions(msg)
        self.postMessage(resp satisfies CleanColumnOptionsResponse)
        return
      }
      if (msg.type === 'cloneSource') {
        const resp = await cloneSource(msg)
        self.postMessage(resp satisfies BuildResponse)
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
  CleanPreviewResponse,
  CleanDoneResponse,
  CleanColumnOptionsResponse,
  ErrorResponse,
}
