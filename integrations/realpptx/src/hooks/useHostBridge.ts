import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChartData, ChartOptions, ChartType } from '@/types/slides'
import useCreateElement from './useCreateElement'
import useSlideHandler from './useSlideHandler'
import { useMainStore, useSlidesStore } from '@/store'
import { hashJson, hashString } from './hostBridge/hash'
import { runWhenIdle } from './hostBridge/idle'
import { applyHostSettingsToSlides, emitPresentationExportToHost, migrateLegacyDraftToHost } from './hostBridge/messages'

interface DashboardChartMessage {
  chartType: ChartType
  data: ChartData
  options?: ChartOptions
  theme?: {
    colors?: string[]
    textColor?: string
    lineColor?: string
  }
  meta?: {
    widgetTitle?: string
    widgetId?: string
    sourceDashboardId?: string
  }
}

export default () => {
  const { createImageElement, createChartElement } = useCreateElement()
  const mainStore = useMainStore()
  const slidesStore = useSlidesStore()
  const { resetSlides } = useSlideHandler()
  const HOST_SOURCE = 'realpptx'
  const presentationId = ref<string>('')
  const autosaveTimer = ref<number | null>(null)
  const applyingHostUpdate = ref(false)
  const lastAppliedHostUpdatedAt = ref<number>(0)
  const lastLocalMutationAt = ref<number>(0)
  const lastSentAutosaveAt = ref<number>(0)
  const lastSlidesHash = ref<string>('')
  const lastStateHash = ref<string>('')
  const autosaveDirty = ref(false)

  const isInteracting = computed(() => {
    return (
      mainStore.canvasDragged ||
      mainStore.isScaling ||
      !!mainStore.creatingElement ||
      mainStore.creatingCustomShape
    )
  })

  const handleMessage = (event: MessageEvent) => {
    if (typeof event.data !== 'object' || !event.data) return
    if (event.data?.source !== 'realdata-host') return

    if (event.data?.type === 'host-settings') {
      applyingHostUpdate.value = true
      applyHostSettingsToSlides({ slidesStore, payload: event.data?.payload })
      window.setTimeout(() => {
        applyingHostUpdate.value = false
      }, 0)
    }

    if (event.data?.type === 'project-context') {
      applyingHostUpdate.value = true
      applyHostSettingsToSlides({ slidesStore, payload: event.data })
      window.setTimeout(() => {
        applyingHostUpdate.value = false
      }, 0)
    }

    if (event.data?.type === 'insert-dashboard-image') {
      const dataUrl = event.data?.payload?.dataUrl
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
        createImageElement(dataUrl)
      }
    }

    if (event.data?.type === 'insert-dashboard-chart') {
      const payload = event.data?.payload as DashboardChartMessage | undefined
      if (payload?.chartType && payload.data) {
        createChartElement(payload.chartType, {
          data: payload.data,
          options: payload.options,
          themeColors: payload.theme?.colors,
          textColor: payload.theme?.textColor,
          lineColor: payload.theme?.lineColor,
          name: payload.meta?.widgetTitle,
          // Automation Report: Store link to Dashboard widget
          widgetId: payload.meta?.widgetId,
          dashboardId: payload.meta?.sourceDashboardId,
        })
      }
    }

    if (event.data?.type === 'request-presentation-export') {
      emitPresentationExportToHost({ slidesStore, hostSource: HOST_SOURCE })
    }

    if (event.data?.type === 'load-presentation') {
      const payload = event.data?.payload as {
        presentationId?: string
        slides?: any[]
        title?: string
        theme?: any
        updatedAt?: number
        globalSettings?: any
        chartTheme?: any
      } | undefined

      const nextPresentationId = typeof payload?.presentationId === 'string' ? payload.presentationId : ''
      if (!nextPresentationId) return

      applyingHostUpdate.value = true
      const isNewPresentation = presentationId.value !== nextPresentationId
      if (isNewPresentation) {
        presentationId.value = nextPresentationId
        migrateLegacyDraftToHost({ presentationId: nextPresentationId, hostSource: HOST_SOURCE })
      }

      const incomingUpdatedAt = typeof payload?.updatedAt === 'number' ? payload.updatedAt : 0
      const incomingSlides = payload?.slides
      const hasIncomingSlides = Array.isArray(incomingSlides)

      if (hasIncomingSlides) {
        const currentSlidesHash = lastSlidesHash.value || hashJson(slidesStore.slides)
        const incomingSlidesHash = hashJson(incomingSlides)

        const isDuplicate = incomingSlidesHash && incomingSlidesHash === currentSlidesHash
        const isOlderThanAppliedHost =
          incomingUpdatedAt > 0 && lastAppliedHostUpdatedAt.value > 0 && incomingUpdatedAt < lastAppliedHostUpdatedAt.value
        const isLikelyStaleDuringEdit =
          !isNewPresentation &&
          lastLocalMutationAt.value > 0 &&
          incomingUpdatedAt > 0 &&
          lastLocalMutationAt.value > incomingUpdatedAt &&
          (Array.isArray(slidesStore.slides) ? (incomingSlides.length <= slidesStore.slides.length) : true)

        if (!isDuplicate && !isOlderThanAppliedHost && !isLikelyStaleDuringEdit) {
          if (incomingSlides.length === 0) {
            if (isNewPresentation) {
              resetSlides()
            }
          }
          else {
            slidesStore.setSlides(incomingSlides)
          }

          if (incomingUpdatedAt > 0) lastAppliedHostUpdatedAt.value = incomingUpdatedAt
          else lastAppliedHostUpdatedAt.value = Date.now()

          lastSlidesHash.value = incomingSlidesHash || hashJson(slidesStore.slides)

          if (isNewPresentation) {
            slidesStore.updateSlideIndex(0)
          }

        }
      }

      if (typeof payload?.title === 'string' && payload.title.trim() && payload.title.trim() !== slidesStore.title) {
        slidesStore.setTitle(payload.title)
      }
      if (payload?.theme) {
        slidesStore.setTheme(payload.theme)
      }
      applyHostSettingsToSlides({ slidesStore, payload: payload as any })

      window.setTimeout(() => {
        applyingHostUpdate.value = false
      }, 0)
    }

    // Automation Report: Handle updated chart data from Dashboard
    if (event.data?.type === 'update-chart-data') {
      const payload = event.data?.payload as {
        elementId: string
        data: ChartData
        options?: ChartOptions
        theme?: { colors?: string[]; textColor?: string; lineColor?: string }
      } | undefined

      if (payload?.elementId && payload.data) {
        // Find the chart element and update it
        const slides = slidesStore.slides.map(slide => ({
          ...slide,
          elements: slide.elements.map(el => {
            if (el.id === payload.elementId && el.type === 'chart') {
              return {
                ...el,
                data: payload.data,
                options: payload.options || el.options,
                optionRaw: undefined,
                themeColors: payload.theme?.colors || el.themeColors,
                textColor: payload.theme?.textColor || el.textColor,
                lineColor: payload.theme?.lineColor || el.lineColor,
              }
            }
            return el
          }),
        }))
        slidesStore.setSlides(slides)
      }
    }
  }

  onMounted(() => {
    window.addEventListener('message', handleMessage)
    window.parent?.postMessage({
      source: HOST_SOURCE,
      type: 'ready',
    }, '*')
  })

  onBeforeUnmount(() => {
    window.removeEventListener('message', handleMessage)
  })

  const scheduleAutosave = (delayMs = 1200) => {
    if (!presentationId.value) return
    if (!autosaveDirty.value) return
    if (autosaveTimer.value) window.clearTimeout(autosaveTimer.value)
    autosaveTimer.value = window.setTimeout(() => {
      if (!presentationId.value) return
      if (!autosaveDirty.value) return
      if (applyingHostUpdate.value) return
      if (isInteracting.value) {
        scheduleAutosave(800)
        return
      }

      runWhenIdle(() => {
        if (!presentationId.value) return
        if (!autosaveDirty.value) return
        if (applyingHostUpdate.value) return
        if (isInteracting.value) return

        const payloadJson = JSON.stringify({
          slides: slidesStore.slides || [],
          title: slidesStore.title,
          theme: slidesStore.theme || {},
        })

        const nextStateHash = hashString(payloadJson)
        if (nextStateHash && nextStateHash === lastStateHash.value) {
          autosaveDirty.value = false
          return
        }

        const payload = JSON.parse(payloadJson) as { slides: any[]; title: string; theme: any }

        lastStateHash.value = nextStateHash
        const nextSlidesHash = hashJson(payload.slides)
        if (nextSlidesHash) lastSlidesHash.value = nextSlidesHash

        const now = Date.now()
        if (lastSentAutosaveAt.value > 0 && now - lastSentAutosaveAt.value < 800) return
        lastSentAutosaveAt.value = now

        window.parent?.postMessage(
          {
            source: HOST_SOURCE,
            type: 'autosave-presentation',
            payload: {
              presentationId: presentationId.value,
              slides: payload.slides,
              title: payload.title,
              theme: payload.theme,
            },
          },
          '*'
        )

        autosaveDirty.value = false
      }, 1500)
    }, delayMs)
  }

  watch(
    () => [slidesStore.slides, slidesStore.title, slidesStore.theme, presentationId.value],
    () => {
      if (!presentationId.value) return
      if (applyingHostUpdate.value) return
      autosaveDirty.value = true
      lastLocalMutationAt.value = Date.now()
      if (isInteracting.value) return
      scheduleAutosave(1200)
    },
    { deep: true }
  )

  watch(
    () => isInteracting.value,
    (now, prev) => {
      if (prev && !now && autosaveDirty.value) {
        scheduleAutosave(500)
      }
    }
  )
}
