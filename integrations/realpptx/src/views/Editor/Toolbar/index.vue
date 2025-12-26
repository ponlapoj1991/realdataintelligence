<template>
  <div class="toolbar">
    <Tabs
      :tabs="currentTabs"
      :value="toolbarState"
      card
      @update:value="key => setToolbarState(key as ToolbarStates)"
    />
    <div class="content">
      <component :is="currentPanelComponent"></component>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import { ToolbarStates } from '@/types/toolbar'
import { ElementTypes } from '@/types/slides'

import ElementStylePanel from './ElementStylePanel/index.vue'
import ElementPositionPanel from './ElementPositionPanel.vue'
import SlideDesignPanel from './SlideDesignPanel/index.vue'
import MultiPositionPanel from './MultiPositionPanel.vue'
import MultiStylePanel from './MultiStylePanel.vue'
import WidgetPlusPanel from './WidgetPlusPanel.vue'
import AISummaryPanel from './AISummaryPanel.vue'
import Tabs from '@/components/Tabs.vue'

const mainStore = useMainStore()
const { activeElementIdList, activeElementList, activeGroupElementId, toolbarState } = storeToRefs(mainStore)

const elementTabs = [
  { label: 'Style', key: ToolbarStates.EL_STYLE },
  { label: 'Position', key: ToolbarStates.EL_POSITION },
]
const elementTabsChart = [
  { label: 'Style', key: ToolbarStates.EL_STYLE },
]
const slideTabs = [
  { label: 'Design', key: ToolbarStates.SLIDE_DESIGN },
  { label: 'Widget+', key: ToolbarStates.WIDGET_PLUS },
  { label: 'AI Summary', key: ToolbarStates.AI_SUMMARY },
]
const multiSelectTabs = [
  { label: 'Style (Multi)', key: ToolbarStates.MULTI_STYLE },
  { label: 'Position (Multi)', key: ToolbarStates.MULTI_POSITION },
]
const multiSelectTabsChart = [
  { label: 'Style (Multi)', key: ToolbarStates.MULTI_STYLE },
]

const setToolbarState = (value: ToolbarStates) => {
  mainStore.setToolbarState(value)
}

const hasChart = computed(() => activeElementList.value.some(item => item.type === ElementTypes.CHART))

const currentTabs = computed(() => {
  if (!activeElementIdList.value.length) return slideTabs

  // Multi-select
  if (activeElementIdList.value.length > 1) {
    // any chart in selection -> only Multi Style
    if (hasChart.value) return multiSelectTabsChart

    // if grouped selection but no chart
    if (activeGroupElementId.value) {
      const activeGroupElement = activeElementList.value.find(item => item.id === activeGroupElementId.value)
      if (activeGroupElement) return elementTabs
    }
    return multiSelectTabs
  }

  // Single select
  const activeElement = activeElementList.value[0]
  if (activeElement && activeElement.type === ElementTypes.CHART) return elementTabsChart
  return elementTabs
})

watch(currentTabs, () => {
  const currentTabsValue: ToolbarStates[] = currentTabs.value.map(tab => tab.key)
  if (!currentTabsValue.includes(toolbarState.value)) {
    mainStore.setToolbarState(currentTabsValue[0])
  }
})

const currentPanelComponent = computed(() => {
  const panelMap: Partial<Record<ToolbarStates, unknown>> = {
    [ToolbarStates.EL_STYLE]: ElementStylePanel,
    [ToolbarStates.EL_POSITION]: ElementPositionPanel,
    [ToolbarStates.SLIDE_DESIGN]: SlideDesignPanel,
    [ToolbarStates.WIDGET_PLUS]: WidgetPlusPanel,
    [ToolbarStates.AI_SUMMARY]: AISummaryPanel,
    [ToolbarStates.MULTI_STYLE]: MultiStylePanel,
    [ToolbarStates.MULTI_POSITION]: MultiPositionPanel,
  }
  return panelMap[toolbarState.value] || null
})
</script>

<style lang="scss" scoped>
.toolbar {
  border-left: solid 1px $borderColor;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}
.content {
  padding: 12px;
  font-size: 13px;

  @include overflow-overlay();
}
</style>
