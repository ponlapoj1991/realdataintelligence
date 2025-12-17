import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChartData, ChartOptions, ChartType } from '@/types/slides'
import useCreateElement from './useCreateElement'
import useSlideHandler from './useSlideHandler'
import { useSlidesStore } from '@/store'

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
  const slidesStore = useSlidesStore()
  const { resetSlides } = useSlideHandler()
  const HOST_SOURCE = 'realpptx'
  const presentationId = ref<string>('')
  const autosaveTimer = ref<number | null>(null)

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
      applyHostSettings(event.data?.payload)
    }

    if (event.data?.type === 'project-context') {
      applyHostSettings(event.data)
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
      const payload = event.data?.payload as { presentationId?: string; slides?: any[]; title?: string; theme?: any; globalSettings?: any; chartTheme?: any } | undefined
      if (payload?.presentationId && typeof payload.presentationId === 'string') {
        presentationId.value = payload.presentationId
        migrateLegacyLocalStorage()
      }
      if (payload?.slides && Array.isArray(payload.slides)) {
        if (payload.slides.length === 0) {
          resetSlides()
        }
        else {
          slidesStore.setSlides(payload.slides)
          slidesStore.updateSlideIndex(0)
        }
      }
      if (payload?.title) {
        slidesStore.setTitle(payload.title)
      }
      if (payload?.theme) {
        slidesStore.setTheme(payload.theme)
      }
      applyHostSettings(payload as any)
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

  watch(
    () => [slidesStore.slides, slidesStore.title, slidesStore.theme, presentationId.value],
    () => {
      if (!presentationId.value) return
      if (autosaveTimer.value) window.clearTimeout(autosaveTimer.value)
      autosaveTimer.value = window.setTimeout(() => {
        const slides = JSON.parse(JSON.stringify(slidesStore.slides || []))
        const theme = JSON.parse(JSON.stringify(slidesStore.theme || {}))
        window.parent?.postMessage(
          {
            source: HOST_SOURCE,
            type: 'autosave-presentation',
            payload: {
              presentationId: presentationId.value,
              slides,
              title: slidesStore.title,
              theme,
            },
          },
          '*'
        )
      }, 1200)
    },
    { deep: true }
  )
}
