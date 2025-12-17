import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChartData, ChartOptions, ChartType } from '@/types/slides'
import useCreateElement from './useCreateElement'
import useSlideHandler from './useSlideHandler'
import { useMainStore, useSlidesStore } from '@/store'

interface DashboardChartMessage {
  chartType: ChartType
  data: ChartData
  options?: ChartOptions
  optionRaw?: any
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

  const hashString = (input: string) => {
    let hash = 5381
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
    }
    return (hash >>> 0).toString(16)
  }

  const hashSlides = (slides: unknown) => {
    try {
      return hashString(JSON.stringify(slides ?? null))
    }
    catch {
      return ''
    }
  }

  const runWhenIdle = (fn: () => void, timeoutMs = 1200) => {
    const w = window as any
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => fn(), { timeout: timeoutMs })
      return
    }
    window.setTimeout(fn, 0)
  }

  const applyHostSettings = (payload?: {
    globalSettings?: any
    chartTheme?: { palette?: string[]; typography?: { fontFamily?: string } }
  }) => {
    const palette = payload?.chartTheme?.palette
    const fontFamily = payload?.chartTheme?.typography?.fontFamily

    if (Array.isArray(palette) && palette.length > 0) {
      slidesStore.setTheme({ themeColors: palette })
      try {
        document.documentElement.style.setProperty('--realpptx-accent', palette[0])
      } catch {
        // ignore
      }
    }
    if (typeof fontFamily === 'string' && fontFamily.trim()) {
      slidesStore.setTheme({ fontName: fontFamily })
    }

    const background = payload?.globalSettings?.theme?.background
    if (typeof background === 'string' && background.trim().startsWith('#')) {
      try {
        document.documentElement.style.setProperty('--realpptx-bg', background.trim())
      } catch {
        // ignore
      }
    }
  }

  const migrateLegacyLocalStorage = () => {
    try {
      const id = presentationId.value
      if (!id) return

      const legacyKey = `pptist_presentation_draft_${id}`
      const nextKey = `realpptx_presentation_draft_${id}`
      const raw = localStorage.getItem(nextKey) || localStorage.getItem(legacyKey)
      if (!raw) return

      const parsed = JSON.parse(raw) as { slides?: any[]; title?: string; theme?: any } | null
      if (!parsed?.slides || !Array.isArray(parsed.slides)) return

      window.parent?.postMessage(
        {
          source: HOST_SOURCE,
          type: 'autosave-presentation',
          payload: {
            presentationId: id,
            slides: parsed.slides,
            title: parsed.title,
            theme: parsed.theme,
            migratedFrom: raw === localStorage.getItem(nextKey) ? nextKey : legacyKey,
          },
        },
        '*'
      )

      localStorage.removeItem(legacyKey)
      localStorage.removeItem(nextKey)
    } catch {
      // ignore
    }
  }

  const emitPresentationExport = () => {
    const slides = JSON.parse(JSON.stringify(slidesStore.slides || []))
    const theme = JSON.parse(JSON.stringify(slidesStore.theme || {}))
    const payload = {
      slides,
      title: slidesStore.title,
      theme,
    }
    window.parent?.postMessage({
      source: HOST_SOURCE,
      type: 'presentation-export',
      payload,
    }, '*')
  }

  const handleMessage = (event: MessageEvent) => {
    if (typeof event.data !== 'object' || !event.data) return
    if (event.data?.source !== 'realdata-host') return

    if (event.data?.type === 'host-settings') {
      applyingHostUpdate.value = true
      applyHostSettings(event.data?.payload)
      window.setTimeout(() => {
        applyingHostUpdate.value = false
      }, 0)
    }

    if (event.data?.type === 'project-context') {
      applyingHostUpdate.value = true
      applyHostSettings(event.data)
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
          optionRaw: payload.optionRaw,
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
      emitPresentationExport()
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
        migrateLegacyLocalStorage()
      }

      const incomingUpdatedAt = typeof payload?.updatedAt === 'number' ? payload.updatedAt : 0
      const incomingSlides = payload?.slides
      const hasIncomingSlides = Array.isArray(incomingSlides)

      if (hasIncomingSlides) {
        const currentSlidesHash = lastSlidesHash.value || hashSlides(slidesStore.slides)
        const incomingSlidesHash = hashSlides(incomingSlides)

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

          lastSlidesHash.value = incomingSlidesHash || hashSlides(slidesStore.slides)

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
      applyHostSettings(payload as any)

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
        optionRaw?: any
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
                optionRaw: payload.optionRaw ?? el.optionRaw,
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
        const nextSlidesHash = hashSlides(payload.slides)
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
