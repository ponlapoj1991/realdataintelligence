<template>
  <div class="ai-summary">
    <template v-if="view === 'list'">
      <div class="header">
        <div class="title">AI Summary</div>
        <button class="add" type="button" @click="startCreate()">
          + Context
        </button>
      </div>

      <div v-if="contexts.length === 0" class="empty">
        <button class="context-card add-card" type="button" @click="startCreate()">
          + Context
        </button>
      </div>

      <div v-else class="context-list">
        <button
          v-for="c in contexts"
          :key="c.id"
          class="context-card"
          type="button"
          @click="openContext(c.id)"
        >
          <div class="context-card-main">
            <div class="context-name">{{ c.name }}</div>
            <div class="context-meta">
              <span class="context-src">{{ c.dataSourceName }}</span>
              <span class="context-kind">{{ c.dataSourceKind }}</span>
            </div>
          </div>

          <div class="context-actions">
            <button
              v-if="isReady(c)"
              class="context-act primary"
              type="button"
              @click.stop="analyzeContext(c.id)"
            >
              Analyze
            </button>
            <button class="context-act" type="button" @click.stop="openContext(c.id)">
              Edit
            </button>
            <button class="context-act danger" type="button" @click.stop="deleteContext(c.id)">
              Delete
            </button>
          </div>
        </button>
      </div>
    </template>

    <template v-else-if="view === 'create'">
      <div class="header">
        <button class="back" type="button" @click="cancelCreate()">Back</button>
        <div class="title">New Context</div>
      </div>

      <div class="form">
        <label class="label">Name</label>
        <input class="input" v-model.trim="newContextName" type="text" />

        <label class="label">Data Source</label>
        <button class="picker" type="button" @click="openTablePicker()">
          {{ pickedSource ? pickedSource.name : 'Select Data Source' }}
        </button>
        <div v-if="pickedSource" class="picked-meta">
          <span class="picked-kind">{{ pickedSource.kind }}</span>
          <span class="picked-rows">{{ pickedSource.rowCount }} rows</span>
        </div>

        <div class="actions">
          <Button class="action" :disabled="!canCreate" type="primary" @click="createContext()">
            Create
          </Button>
          <Button class="action" @click="cancelCreate()">
            Cancel
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'

type PickedDataSource = {
  id: string
  name: string
  kind: string
  rowCount: number
}

type AiSummaryContextSummary = {
  id: string
  name: string
  dataSourceId: string
  dataSourceName: string
  dataSourceKind: string
  prompt?: string
  dateColumn?: string
  periodStart?: string
  periodEnd?: string
  provider?: string
  model?: string
}

type ViewState = 'list' | 'create'

const view = ref<ViewState>('list')
const contexts = ref<AiSummaryContextSummary[]>([])

const newContextName = ref('')
const pickedSource = ref<PickedDataSource | null>(null)
const pickerRequestId = ref<string>('')

const canCreate = computed(() => {
  return !!newContextName.value.trim() && !!pickedSource.value?.id
})

const isReady = (c: AiSummaryContextSummary) => {
  const hasPeriod = !!(c.periodStart || c.periodEnd)
  return !!c.dataSourceId && !!c.prompt?.trim() && !!c.dateColumn && hasPeriod
}

const requestCanvasContext = () => {
  window.parent?.postMessage({ source: 'realpptx', type: 'request-canvas-context' }, '*')
}

const startCreate = () => {
  view.value = 'create'
  newContextName.value = ''
  pickedSource.value = null
  pickerRequestId.value = ''
}

const cancelCreate = () => {
  view.value = 'list'
  newContextName.value = ''
  pickedSource.value = null
  pickerRequestId.value = ''
  requestCanvasContext()
}

const openTablePicker = () => {
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  pickerRequestId.value = reqId
  window.parent?.postMessage({ source: 'realpptx', type: 'open-canvas-table-picker', payload: { requestId: reqId } }, '*')
}

const createContext = () => {
  if (!pickedSource.value) return
  window.parent?.postMessage({
    source: 'realpptx',
    type: 'create-ai-summary-context',
    payload: {
      name: newContextName.value.trim(),
      dataSourceId: pickedSource.value.id,
    },
  }, '*')
  cancelCreate()
}

const openContext = (contextId: string) => {
  window.parent?.postMessage({ source: 'realpptx', type: 'open-ai-summary-context', payload: { contextId } }, '*')
}

const analyzeContext = (contextId: string) => {
  window.parent?.postMessage({ source: 'realpptx', type: 'run-ai-summary-context', payload: { contextId } }, '*')
}

const deleteContext = (contextId: string) => {
  window.parent?.postMessage({ source: 'realpptx', type: 'delete-ai-summary-context', payload: { contextId } }, '*')
}

const handleMessage = (event: MessageEvent) => {
  if (typeof event.data !== 'object' || !event.data) return
  if (event.data.source !== 'realdata-host') return

  if (event.data.type === 'canvas-context') {
    const payload = event.data.payload as { aiSummaryContexts?: AiSummaryContextSummary[] } | undefined
    const nextContexts = Array.isArray(payload?.aiSummaryContexts) ? payload.aiSummaryContexts : []
    contexts.value = nextContexts
    return
  }

  if (event.data.type === 'canvas-table-picked') {
    const payload = event.data.payload as { requestId?: string; source?: PickedDataSource } | undefined
    if (!payload?.requestId || payload.requestId !== pickerRequestId.value) return
    if (!payload.source) return
    pickedSource.value = payload.source
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  requestCanvasContext()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<style lang="scss" scoped>
.ai-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  font-weight: 700;
  font-size: 13px;
  color: #111827;
}

.add {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 6px 10px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
}

.back {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 6px 10px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.context-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.context-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
  background: #fff;
  cursor: pointer;
}

.context-card.add-card {
  justify-content: center;
  border-style: dashed;
  color: #374151;
}

.context-card-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.context-name {
  font-weight: 700;
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #6b7280;
  min-width: 0;
}

.context-src {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.context-kind {
  font-weight: 700;
  font-size: 10px;
  white-space: nowrap;
}

.context-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.context-act {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px 10px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
  white-space: nowrap;
}

.context-act.primary {
  border-color: #6366f1;
  background: #eef2ff;
  color: #3730a3;
}

.context-act.danger {
  border-color: #fecaca;
  background: #fff1f2;
  color: #9f1239;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: #374151;
  font-weight: 700;
}

.input {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  outline: none;
}

.picker {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #111827;
}

.picked-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #6b7280;
}

.picked-kind {
  font-weight: 700;
  text-transform: uppercase;
}

.picked-rows {
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}

.action {
  width: 100%;
  display: flex;
  justify-content: center;
}
</style>

