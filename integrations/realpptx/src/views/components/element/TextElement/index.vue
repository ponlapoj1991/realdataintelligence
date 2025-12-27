<template>
  <div 
    class="editable-element-text" 
    :class="{ 'lock': elementInfo.lock }"
    :style="{
      top: elementInfo.top + 'px',
      left: elementInfo.left + 'px',
      width: elementInfo.width + 'px',
      height: elementInfo.height + 'px',
    }"
  >
    <div
      class="rotate-wrapper"
      :style="{ transform: `rotate(${elementInfo.rotate}deg)` }"
    >
      <div 
        class="element-content"
        ref="elementRef"
        :style="{
          width: elementInfo.vertical ? 'auto' : elementInfo.width + 'px',
          height: (elementInfo.vertical || elementInfo.autoResize === false) ? elementInfo.height + 'px' : 'auto',
          padding: (elementInfo.padding ?? 10) + 'px',
          display: elementInfo.autoResize === false ? 'flex' : undefined,
          flexDirection: elementInfo.autoResize === false ? 'column' : undefined,
          justifyContent: elementInfo.autoResize === false
            ? (elementInfo.valign === 'bottom' ? 'flex-end' : (elementInfo.valign === 'middle' ? 'center' : 'flex-start'))
            : undefined,
          overflow: elementInfo.autoResize === false ? 'hidden' : undefined,
          backgroundColor: elementInfo.fill,
          opacity: elementInfo.opacity,
          textShadow: shadowStyle,
          lineHeight: elementInfo.lineHeight,
          letterSpacing: (elementInfo.wordSpace || 0) + 'px',
          color: elementInfo.defaultColor,
          fontFamily: effectiveFontName,
          writingMode: elementInfo.vertical ? 'vertical-rl' : 'horizontal-tb',
        }"
        v-contextmenu="contextmenus"
        @mousedown="$event => handleSelectElement($event)"
        @touchstart="$event => handleSelectElement($event)"
      >
        <ElementOutline
          :width="elementInfo.width"
          :height="elementInfo.height"
          :outline="elementInfo.outline"
        />
        <ProsemirrorEditor
          class="text"
          :elementId="elementInfo.id"
          :defaultColor="elementInfo.defaultColor"
          :defaultFontName="effectiveFontName"
          :editable="!elementInfo.lock"
          :value="elementInfo.content"
          :style="{
            '--paragraphSpace': `${elementInfo.paragraphSpace === undefined ? 5 : elementInfo.paragraphSpace}px`,
            '--defaultFontSize': elementInfo.defaultFontSize || undefined,
          }"
          @update="({ value, ignore }) => updateContent(value, ignore)"
          @mousedown="$event => handleSelectElement($event, false)"
        />

        <!-- 当字号过大且行高较小时，会出现文字高度溢出的情况，导致拖拽区域无法被选中，因此添加了以下节点避免该情况 -->
        <div class="drag-handler top"></div>
        <div class="drag-handler bottom"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { debounce } from 'lodash'
import { useMainStore, useSlidesStore } from '@/store'
import type { PPTTextElement } from '@/types/slides'
import type { ContextmenuItem } from '@/components/Contextmenu/types'
import useElementShadow from '@/views/components/element/hooks/useElementShadow'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'

import ElementOutline from '@/views/components/element/ElementOutline.vue'
import ProsemirrorEditor from '@/views/components/element/ProsemirrorEditor.vue'

const props = defineProps<{
  elementInfo: PPTTextElement
  selectElement: (e: MouseEvent | TouchEvent, element: PPTTextElement, canMove?: boolean) => void
  contextmenus: () => ContextmenuItem[] | null
}>()

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const { handleElementId, isScaling } = storeToRefs(mainStore)

const effectiveFontName = computed(() => {
  return props.elementInfo.defaultFontName || slidesStore.theme.fontName || 'Tahoma'
})

const { addHistorySnapshot } = useHistorySnapshot()

const elementRef = useTemplateRef<HTMLElement>('elementRef')

const shadow = computed(() => props.elementInfo.shadow)
const { shadowStyle } = useElementShadow(shadow)

const handleSelectElement = (e: MouseEvent | TouchEvent, canMove = true) => {
  if (props.elementInfo.lock) return
  e.stopPropagation()

  props.selectElement(e, props.elementInfo, canMove)
}

// 监听文本元素的尺寸变化，当高度变化时，更新高度到vuex
// 如果高度变化时正处在缩放操作中，则等待缩放操作结束后再更新
const realHeightCache = ref(-1)
const realWidthCache = ref(-1)

watch(isScaling, () => {
  if (handleElementId.value !== props.elementInfo.id) return

  if (!isScaling.value) {
    if (!props.elementInfo.vertical && realHeightCache.value !== -1) {
      if (realHeightCache.value > props.elementInfo.height) {
        slidesStore.updateElement({
          id: props.elementInfo.id,
          props: { height: realHeightCache.value },
        })
      }
      realHeightCache.value = -1
    }
    if (props.elementInfo.vertical && realWidthCache.value !== -1) {
      if (realWidthCache.value > props.elementInfo.width) {
        slidesStore.updateElement({
          id: props.elementInfo.id,
          props: { width: realWidthCache.value },
        })
      }
      realWidthCache.value = -1
    }
  }
})

const roundPx = (value: number) => Math.round(value * 10) / 10

const updateTextElementHeight = (entries: ResizeObserverEntry[]) => {
  if (props.elementInfo.autoResize === false) return
  const contentRect = entries[0].contentRect
  if (!elementRef.value) return

  const realHeight = roundPx(contentRect.height)
  const realWidth = roundPx(contentRect.width)

  if (!props.elementInfo.vertical && realHeight > props.elementInfo.height) {
    if (!isScaling.value) {
      slidesStore.updateElement({
        id: props.elementInfo.id,
        props: { height: realHeight },
      })
    }
    else realHeightCache.value = Math.max(realHeightCache.value, realHeight)
  }
  if (props.elementInfo.vertical && realWidth > props.elementInfo.width) {
    if (!isScaling.value) {
      slidesStore.updateElement({
        id: props.elementInfo.id,
        props: { width: realWidth },
      })
    }
    else realWidthCache.value = Math.max(realWidthCache.value, realWidth)
  }
}
const resizeObserver = new ResizeObserver(updateTextElementHeight)

onMounted(() => {
  if (elementRef.value) resizeObserver.observe(elementRef.value)
})
onUnmounted(() => {
  if (elementRef.value) resizeObserver.unobserve(elementRef.value)
})

const updateContent = (content: string, ignore = false) => {
  slidesStore.updateElement({
    id: props.elementInfo.id,
    props: { content },
  })
  
  if (!ignore) addHistorySnapshot()
}

const checkEmptyText = debounce(function() {
  const pureText = props.elementInfo.content.replace(/<[^>]+>/g, '')
  if (!pureText) slidesStore.deleteElement(props.elementInfo.id)
}, 300, { trailing: true })

const isHandleElement = computed(() => handleElementId.value === props.elementInfo.id)
watch(isHandleElement, () => {
  if (!isHandleElement.value) checkEmptyText()
})

const isDashboardKpi = computed(() => {
  return (
    props.elementInfo.autoResize === false &&
    props.elementInfo.dashboardWidgetKind === 'kpi' &&
    !!props.elementInfo.widgetId &&
    !!props.elementInfo.dashboardId
  )
})

const isCanvasKpi = computed(() => {
  return (
    props.elementInfo.autoResize === false &&
    (props.elementInfo as any).canvasWidgetKind === 'kpi' &&
    !!(props.elementInfo as any).canvasWidgetId &&
    !!(props.elementInfo as any).canvasTableId
  )
})

const isKpiAutoFit = computed(() => isDashboardKpi.value || isCanvasKpi.value)

const extractPlainText = (html: string) => {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const parsePx = (value?: string) => {
  const n = Number(String(value || '').replace('px', '').trim())
  return Number.isFinite(n) ? n : null
}

const computeKpiAutoFontPx = () => {
  const padding = props.elementInfo.padding ?? 0
  const width = Math.max(1, (props.elementInfo.width || 0) - padding * 2)
  const height = Math.max(1, (props.elementInfo.height || 0) - padding * 2)
  const text = extractPlainText(props.elementInfo.content)
  const len = Math.max(1, text.length)
  const maxByHeight = height * 0.78
  const maxByWidth = width / (len * 0.62)
  const size = Math.min(maxByHeight, maxByWidth)
  return Math.max(4, Math.min(size, 320))
}

const applyKpiAutoFit = (mode: 'resize' | 'content') => {
  if (!isKpiAutoFit.value) return

  if (mode === 'resize') {
    if (handleElementId.value !== props.elementInfo.id) return
  }

  const fitPx = roundPx(computeKpiAutoFontPx())
  const currentPx = parsePx(props.elementInfo.defaultFontSize)
  const maxPx = parsePx(props.elementInfo.dashboardKpiMaxFontSize) ?? currentPx

  let nextPx: number | null = null
  if (mode === 'resize') {
    nextPx = fitPx
  }
  else {
    const clampUpper = Math.min(maxPx ?? fitPx, fitPx)
    if (currentPx !== null) {
      nextPx = Math.min(currentPx, clampUpper)
    }
    else {
      nextPx = clampUpper
    }
  }

  if (nextPx === null) return
  if (currentPx !== null && Math.abs(currentPx - nextPx) < 0.4) {
    // Ensure legacy KPI has max font size persisted for lock behavior
    if (!props.elementInfo.dashboardKpiMaxFontSize && currentPx !== null) {
      slidesStore.updateElement({
        id: props.elementInfo.id,
        props: { dashboardKpiMaxFontSize: `${roundPx(currentPx)}px` },
      })
    }
    return
  }

  slidesStore.updateElement({
    id: props.elementInfo.id,
    props: {
      defaultFontSize: `${nextPx}px`,
      ...(mode === 'resize' ? { dashboardKpiMaxFontSize: `${nextPx}px` } : {}),
      ...(!props.elementInfo.dashboardKpiMaxFontSize && maxPx !== null ? { dashboardKpiMaxFontSize: `${roundPx(maxPx)}px` } : {}),
    },
  })
}

const applyKpiAutoFitFromResizeDebounced = debounce(() => applyKpiAutoFit('resize'), 60, { trailing: true })
const applyKpiAutoFitFromContentDebounced = debounce(() => applyKpiAutoFit('content'), 80, { trailing: true })

watch(isScaling, () => {
  if (handleElementId.value !== props.elementInfo.id) return
  if (!isScaling.value) {
    applyKpiAutoFit('resize')
  }
})

watch(
  () => props.elementInfo.content,
  () => {
    applyKpiAutoFitFromContentDebounced()
  }
)

watch(
  () => [props.elementInfo.width, props.elementInfo.height, isScaling.value, handleElementId.value],
  () => {
    if (!isKpiAutoFit.value) return
    if (!isScaling.value) return
    if (handleElementId.value !== props.elementInfo.id) return
    applyKpiAutoFitFromResizeDebounced()
  }
)

onUnmounted(() => {
  applyKpiAutoFitFromResizeDebounced.cancel()
  applyKpiAutoFitFromContentDebounced.cancel()
})
</script>

<style lang="scss" scoped>
.editable-element-text {
  position: absolute;

  &.lock .element-content {
    cursor: default;
  }
}
.rotate-wrapper {
  width: 100%;
  height: 100%;
}
.element-content {
  position: relative;
  padding: 10px;
  line-height: 1.5;
  word-break: break-word;
  cursor: move;

  .text {
    position: relative;
  }

  ::v-deep(a) {
    cursor: text;
  }
}
.drag-handler {
  height: 10px;
  position: absolute;
  left: 0;
  right: 0;

  &.top {
    top: 0;
  }
  &.bottom {
    bottom: 0;
  }
}
</style>
