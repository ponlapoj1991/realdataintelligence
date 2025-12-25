<template>
  <div class="widget-plus">
    <Button class="action" type="primary" @click="requestInsertDashboard()">
      Select Dashboard
    </Button>
    <Button class="action" type="primary" @click="requestUpdateLinkedWidgets()">
      Update Linked Widgets
    </Button>
  </div>
</template>

<script lang="ts" setup>
import { useSlidesStore } from '@/store'
import Button from '@/components/Button.vue'

const slidesStore = useSlidesStore()

const requestInsertDashboard = () => {
  window.parent?.postMessage({ source: 'realpptx', type: 'open-dashboard-insert' }, '*')
}

const requestUpdateLinkedWidgets = () => {
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

  if (linkedCharts.length === 0) {
    window.parent?.postMessage({ source: 'realpptx', type: 'no-linked-charts' }, '*')
    return
  }

  window.parent?.postMessage({
    source: 'realpptx',
    type: 'request-chart-updates',
    payload: { linkedCharts },
  }, '*')
}
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
</style>

