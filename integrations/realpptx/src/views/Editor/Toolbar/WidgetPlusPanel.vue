<template>
  <div class="widget-plus">
    <template v-if="view === 'home'">
      <Button class="action" type="primary" @click="openCreateWidgets()">
        Create Widgets
      </Button>

      <Button class="action" type="primary" @click="requestInsertDashboard()">
        Select Dashboard
      </Button>

      <div class="update-block">
        <Button class="action" @click="requestUpdateFromDashboard()">
          Update from Dashboard
        </Button>
      </div>
    </template>

    <template v-else-if="view === 'tables'">
      <div class="header">
        <button class="back" type="button" @click="view = 'home'">Back</button>
        <div class="title">Create Widgets</div>
      </div>

      <div class="table-list">
        <button class="table-card add" type="button" @click="startCreateTable()">
          + Table
        </button>

        <button
          v-for="t in tables"
          :key="t.id"
          class="table-card"
          type="button"
          :data-active="t.id === activeTableId"
          @click="openChartBuilder(t.id)"
        >
          <div class="table-card-main">
            <div class="table-name">{{ t.name }}</div>
            <div class="table-meta">
              <span class="table-src">{{ t.dataSourceName }}</span>
              <span class="table-kind">{{ t.dataSourceKind }}</span>
            </div>
          </div>
          <button class="table-del" type="button" @click.stop="deleteTable(t.id)">Delete</button>
        </button>
      </div>
    </template>

    <template v-else-if="view === 'create-table'">
      <div class="header">
        <button class="back" type="button" @click="cancelCreateTable()">Back</button>
        <div class="title">New Table</div>
      </div>

      <div class="form">
        <label class="label">Name</label>
        <input class="input" v-model.trim="newTableName" type="text" />

        <label class="label">Data Source</label>
        <button class="picker" type="button" @click="openTablePicker()">
          {{ pickedSource ? pickedSource.name : 'Select Data Source' }}
        </button>
        <div v-if="pickedSource" class="picked-meta">
          <span class="picked-kind">{{ pickedSource.kind }}</span>
          <span class="picked-rows">{{ pickedSource.rowCount }} rows</span>
        </div>

        <div class="actions">
          <Button class="action" :disabled="!canCreateTable" type="primary" @click="createTable()">
            Create
          </Button>
          <Button class="action" @click="cancelCreateTable()">
            Cancel
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSlidesStore } from '@/store'
import Button from '@/components/Button.vue'

const slidesStore = useSlidesStore()

type CanvasTableContext = {
  id: string
  name: string
  dataSourceId: string
  dataSourceName: string
  dataSourceKind: string
}

type PickedDataSource = {
  id: string
  name: string
  kind: string
  rowCount: number
}

type ViewState = 'home' | 'tables' | 'create-table'

const view = ref<ViewState>('home')
const tables = ref<CanvasTableContext[]>([])
const activeTableId = ref<string | null>(null)

const newTableName = ref('')
const pickedSource = ref<PickedDataSource | null>(null)
const pickerRequestId = ref<string>('')

const canCreateTable = computed(() => {
  return !!newTableName.value.trim() && !!pickedSource.value?.id
})

const requestInsertDashboard = () => {
  window.parent?.postMessage({ source: 'realpptx', type: 'open-dashboard-insert' }, '*')
}

const openCreateWidgets = () => {
  view.value = 'tables'
  window.parent?.postMessage({ source: 'realpptx', type: 'request-canvas-context' }, '*')
}

const startCreateTable = () => {
  view.value = 'create-table'
  newTableName.value = ''
  pickedSource.value = null
  pickerRequestId.value = ''
}

const cancelCreateTable = () => {
  view.value = 'tables'
  newTableName.value = ''
  pickedSource.value = null
  pickerRequestId.value = ''
}

const openTablePicker = () => {
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  pickerRequestId.value = reqId
  window.parent?.postMessage({ source: 'realpptx', type: 'open-canvas-table-picker', payload: { requestId: reqId } }, '*')
}

const createTable = () => {
  if (!pickedSource.value) return
  window.parent?.postMessage({
    source: 'realpptx',
    type: 'create-canvas-table',
    payload: {
      name: newTableName.value.trim(),
      dataSourceId: pickedSource.value.id,
    },
  }, '*')
}

const deleteTable = (tableId: string) => {
  window.parent?.postMessage({ source: 'realpptx', type: 'delete-canvas-table', payload: { tableId } }, '*')
}

const openChartBuilder = (tableId: string) => {
  activeTableId.value = tableId
  window.parent?.postMessage({ source: 'realpptx', type: 'set-active-canvas-table', payload: { tableId } }, '*')
  window.parent?.postMessage({ source: 'realpptx', type: 'open-canvas-widget-create', payload: { tableId } }, '*')
}

const collectDashboardLinks = () => {
  const linkedCharts: Array<{ elementId: string; widgetId: string; dashboardId: string; kind?: 'chart' | 'kpi' }> = []

  slidesStore.slides.forEach(slide => {
    slide.elements.forEach(element => {
      if (element.type === 'chart' && (element as any).widgetId && (element as any).dashboardId) {
        linkedCharts.push({
          elementId: element.id,
          widgetId: (element as any).widgetId,
          dashboardId: (element as any).dashboardId,
          kind: 'chart',
        })
      }
      if (
        element.type === 'text' &&
        (element as any).dashboardWidgetKind === 'kpi' &&
        (element as any).widgetId &&
        (element as any).dashboardId
      ) {
        linkedCharts.push({
          elementId: element.id,
          widgetId: (element as any).widgetId,
          dashboardId: (element as any).dashboardId,
          kind: 'kpi',
        })
      }
    })
  })

  return linkedCharts
}

const requestUpdateFromDashboard = () => {
  const linkedCharts = collectDashboardLinks()
  if (linkedCharts.length === 0) {
    window.parent?.postMessage({ source: 'realpptx', type: 'no-linked-charts' }, '*')
    return
  }

  window.parent?.postMessage({
    source: 'realpptx',
    type: 'request-chart-updates',
    payload: { mode: 'dashboard', linkedCharts },
  }, '*')
}

const handleMessage = (event: MessageEvent) => {
  if (typeof event.data !== 'object' || !event.data) return
  if (event.data.source !== 'realdata-host') return

  if (event.data.type === 'canvas-context') {
    const payload = event.data.payload as { tables?: CanvasTableContext[]; activeTableId?: string } | undefined
    const nextTables = Array.isArray(payload?.tables) ? payload?.tables : []
    tables.value = nextTables
    activeTableId.value = payload?.activeTableId || (nextTables[0]?.id ?? null)
    if (view.value === 'create-table') {
      cancelCreateTable()
    }
  }

  if (event.data.type === 'canvas-table-picked') {
    const payload = event.data.payload as { requestId?: string; source?: PickedDataSource } | undefined
    if (!payload?.requestId || payload.requestId !== pickerRequestId.value) return
    if (!payload.source) return
    pickedSource.value = payload.source
  }

  if (event.data.type === 'canvas-table-create-error') {
    if (view.value === 'create-table') {
      // keep the form; host will show toast with details
      return
    }
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})

</script>

<style lang="scss" scoped>
.widget-plus {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action {
  width: 100%;
  display: flex;
  justify-content: center;
}

.update-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
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

.title {
  font-weight: 700;
  font-size: 13px;
  color: #111827;
}

.table-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.table-card {
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

.table-card[data-active='true'] {
  border-color: #6366f1;
  background: #eef2ff;
}

.table-card.add {
  justify-content: center;
  border-style: dashed;
  color: #374151;
}

.table-card-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.table-name {
  font-weight: 700;
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #6b7280;
  min-width: 0;
}

.table-src {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.table-kind {
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  color: #9ca3af;
}

.table-del {
  border: 1px solid #fecaca;
  color: #b91c1c;
  background: #fff;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.label {
  font-size: 12px;
  font-weight: 700;
  color: #374151;
}

.input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}

.picker {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.picked-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: #6b7280;
}

.picked-kind {
  font-weight: 700;
  text-transform: uppercase;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}
</style>
