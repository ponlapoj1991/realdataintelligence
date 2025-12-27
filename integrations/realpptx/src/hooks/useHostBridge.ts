import { computed, markRaw, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { ChartData, ChartOptions, ChartType } from '@/types/slides'
import useCreateElement from './useCreateElement'
import useSlideHandler from './useSlideHandler'
import { useMainStore, useSlidesStore } from '@/store'
import { hashJson, hashString } from './hostBridge/hash'
import { runWhenIdle } from './hostBridge/idle'
import { applyHostSettingsToSlides, emitPresentationExportToHost, migrateLegacyDraftToHost } from './hostBridge/messages'

interface DashboardChartMessage {
  chartType: ChartType | 'kpi'
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

const cloneForPostMessage = (value: any) => {
  try {
    return JSON.parse(JSON.stringify(toRaw(value)))
  } catch {
    return toRaw(value)
  }
}

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')

const extractFirstTextFromHtml = (html: string) => {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    const text = (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim()
    return text
  } catch {
    return String(html || '').replace(/<[^>]*>/g, '').trim()
  }
}

const extractTextStyles = (html: string): { pStyle: string; spanStyle: string } => {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    const p = doc.querySelector('p')
    const span = doc.querySelector('span')
    const pStyle = p?.getAttribute('style') || ''
    const spanStyle = span?.getAttribute('style') || ''
    return { pStyle, spanStyle }
  } catch {
    return { pStyle: '', spanStyle: '' }
  }
}

const buildTextHtml = (text: string, styles?: { pStyle?: string; spanStyle?: string }) => {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const pAttr = styles?.pStyle ? ` style="${styles.pStyle}"` : ''
  const spanAttr = styles?.spanStyle ? ` style="${styles.spanStyle}"` : ''

  return lines
    .map((line) => {
      const safe = escapeHtml(line)
      const inner = safe ? safe : '&nbsp;'
      return `<p${pAttr}><span${spanAttr}>${inner}</span></p>`
    })
    .join('')
}

export default () => {
  const { createImageElement, createChartElement, createTextElement } = useCreateElement()
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

  const findTextElementById = (id: string) => {
    if (!id) return null
    for (const slide of slidesStore.slides || []) {
      const els = Array.isArray((slide as any)?.elements) ? ((slide as any).elements as any[]) : []
      const found = els.find((el) => el?.id === id)
      if (found && found.type === 'text') return found as any
    }
    return null
  }

  const isInteracting = computed(() => {
    return (
      mainStore.canvasDragged ||
      mainStore.isScaling ||
      !!mainStore.creatingElement ||
      mainStore.creatingCustomShape ||
      mainStore.isTyping
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

    if (event.data?.type === 'request-canvas-elements') {
      const requestId = String(event.data?.payload?.requestId || '')
      const elements = (slidesStore.slides || []).flatMap((slide) => {
        const slideElements = Array.isArray((slide as any)?.elements) ? (slide as any).elements : []
        return slideElements
          .map((el: any) => {
            if (!el?.id || !el?.canvasWidgetId || !el?.canvasTableId || !el?.canvasWidgetConfig) return null
            if (el.type === 'chart') {
              return {
                elementId: el.id,
                tableId: el.canvasTableId,
                kind: 'chart' as const,
                widget: cloneForPostMessage(el.canvasWidgetConfig),
              }
            }
            if (el.type === 'text' && el.canvasWidgetKind === 'kpi') {
              return {
                elementId: el.id,
                tableId: el.canvasTableId,
                kind: 'kpi' as const,
                widget: cloneForPostMessage(el.canvasWidgetConfig),
              }
            }
            return null
          })
          .filter(Boolean)
      })

      window.parent?.postMessage(
        {
          source: HOST_SOURCE,
          type: 'canvas-elements',
          payload: { requestId, elements },
        },
        '*',
      )
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
        if (payload.chartType === 'kpi') {
          const escapeHtml = (input: string) =>
            input
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\"/g, '&quot;')
              .replace(/'/g, '&#39;')

          const toNumber = (raw: unknown) => {
            if (raw === null || raw === undefined) return 0
            if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
            if (typeof raw === 'object' && (raw as any).value !== undefined) {
              const n = Number((raw as any).value)
              return Number.isFinite(n) ? n : 0
            }
            const n = Number(raw)
            return Number.isFinite(n) ? n : 0
          }

          const formatKpiValue = (
            value: number,
            mode?: 'auto' | 'text' | 'number' | 'compact' | 'accounting',
          ) => {
            if (!Number.isFinite(value)) return '0'
            switch (mode) {
              case 'text':
                return String(value)
              case 'number':
                return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
              case 'compact':
                return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
              case 'accounting':
                return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
              case 'auto':
              default: {
                const abs = Math.abs(value)
                if (abs >= 1_000_000) {
                  return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
                }
                if (Number.isInteger(value)) {
                  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
                }
                return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
              }
            }
          }

          const raw = payload.data?.series?.[0]?.[0]
          const value = toNumber(raw)
          const valueFormat = payload.options?.dataLabelValueFormat
          const text = formatKpiValue(value, valueFormat)
          const fontSize = typeof payload.options?.dataLabelFontSize === 'number' ? payload.options.dataLabelFontSize : 72
          const fontWeight = payload.options?.dataLabelFontWeight || 'bold'
          const fontFamily = payload.options?.dataLabelFontFamily

          const themeAccent = payload.theme?.colors?.[0] || payload.theme?.textColor || '#111827'
          const color = payload.options?.dataLabelColor || themeAccent

          const safeText = escapeHtml(text)
          const content = `<p style="text-align:center;"><span style="font-weight:${fontWeight};${fontFamily ? ` font-family:${fontFamily};` : ''}">${safeText}</span></p>`

          const slideW = slidesStore.viewportSize
          const slideH = slidesStore.viewportSize * slidesStore.viewportRatio
          const boxW = Math.min(700, Math.max(260, slideW * 0.7))
          const boxH = Math.min(260, Math.max(140, slideH * 0.28))

          const id = createTextElement(
            {
              left: (slideW - boxW) / 2,
              top: (slideH - boxH) / 2,
              width: boxW,
              height: boxH,
            },
            { content, autoFocus: false },
          )

          slidesStore.updateElement({
            id,
            props: {
              autoResize: false,
              padding: 0,
              lineHeight: 1,
              paragraphSpace: 0,
              valign: 'middle',
              defaultColor: color,
              defaultFontSize: `${fontSize}px`,
              dashboardKpiMaxFontSize: `${fontSize}px`,
              ...(fontFamily ? { defaultFontName: fontFamily } : {}),
              name: payload.meta?.widgetTitle,
              widgetId: payload.meta?.widgetId,
              dashboardId: payload.meta?.sourceDashboardId,
              dashboardWidgetKind: 'kpi' as const,
            },
          })
        }
        else {
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
    }

    if (event.data?.type === 'upsert-canvas-widget') {
      const payload = event.data?.payload as
        | {
            elementId?: string
            chart: DashboardChartMessage
            canvas: { tableId: string; widget: any }
          }
        | undefined

      const chart = payload?.chart
      const tableId = payload?.canvas?.tableId
      const widget = payload?.canvas?.widget
      if (!chart?.chartType || !chart.data || !tableId || !widget) return

      const canvasWidgetId = widget?.id || chart.meta?.widgetId || ''
      const elementId = payload?.elementId

      if (chart.chartType === 'kpi') {
        const escapeHtml = (input: string) =>
          input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;')

        const toNumber = (raw: unknown) => {
          if (raw === null || raw === undefined) return 0
          if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
          if (typeof raw === 'object' && (raw as any).value !== undefined) {
            const n = Number((raw as any).value)
            return Number.isFinite(n) ? n : 0
          }
          const n = Number(raw)
          return Number.isFinite(n) ? n : 0
        }

        const formatKpiValue = (
          value: number,
          mode?: 'auto' | 'text' | 'number' | 'compact' | 'accounting',
        ) => {
          if (!Number.isFinite(value)) return '0'
          switch (mode) {
            case 'text':
              return String(value)
            case 'number':
              return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
            case 'compact':
              return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
            case 'accounting':
              return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
            case 'auto':
            default: {
              const abs = Math.abs(value)
              if (abs >= 1_000_000) {
                return new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)
              }
              if (Number.isInteger(value)) {
                return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
              }
              return new Intl.NumberFormat(undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
            }
          }
        }

        const raw = chart.data?.series?.[0]?.[0]
        const value = toNumber(raw)
        const valueFormat = chart.options?.dataLabelValueFormat
        const text = formatKpiValue(value, valueFormat)
        const fontSize = typeof chart.options?.dataLabelFontSize === 'number' ? chart.options.dataLabelFontSize : 72
        const fontWeight = chart.options?.dataLabelFontWeight || 'bold'
        const fontFamily = chart.options?.dataLabelFontFamily

        const themeAccent = chart.theme?.colors?.[0] || chart.theme?.textColor || '#111827'
        const color = chart.options?.dataLabelColor || themeAccent

        const safeText = escapeHtml(text)
        const content = `<p style="text-align:center;"><span style="font-weight:${fontWeight};${fontFamily ? ` font-family:${fontFamily};` : ''}">${safeText}</span></p>`

        const nextProps: any = {
          content,
          autoResize: false,
          padding: 0,
          lineHeight: 1,
          paragraphSpace: 0,
          valign: 'middle',
          defaultColor: color,
          ...(fontFamily ? { defaultFontName: fontFamily } : {}),
          name: widget?.title || chart.meta?.widgetTitle,
          canvasWidgetId,
          canvasTableId: tableId,
          canvasWidgetKind: 'kpi' as const,
          canvasWidgetConfig: markRaw(widget),
          dashboardWidgetKind: 'kpi' as const,
        }

        if (elementId) {
          slidesStore.updateElement({ id: elementId, props: nextProps })
          return
        }

        const slideW = slidesStore.viewportSize
        const slideH = slidesStore.viewportSize * slidesStore.viewportRatio
        const boxW = Math.min(700, Math.max(260, slideW * 0.7))
        const boxH = Math.min(260, Math.max(140, slideH * 0.28))

        const id = createTextElement(
          {
            left: (slideW - boxW) / 2,
            top: (slideH - boxH) / 2,
            width: boxW,
            height: boxH,
          },
          { content, autoFocus: false },
        )

        slidesStore.updateElement({
          id,
          props: {
            ...nextProps,
            defaultFontSize: `${fontSize}px`,
            dashboardKpiMaxFontSize: `${fontSize}px`,
          },
        })
        return
      }

      const nextProps: any = {
        data: chart.data,
        optionRaw: undefined,
      }
      if (chart.options) nextProps.options = chart.options
      if (chart.theme?.colors) nextProps.themeColors = chart.theme.colors
      if (chart.theme?.textColor) nextProps.textColor = chart.theme.textColor
      if (chart.theme?.lineColor) nextProps.lineColor = chart.theme.lineColor
      nextProps.name = widget?.title || chart.meta?.widgetTitle
      nextProps.canvasWidgetId = canvasWidgetId
      nextProps.canvasTableId = tableId
      nextProps.canvasWidgetConfig = markRaw(widget)

      if (elementId) {
        slidesStore.updateElement({ id: elementId, props: nextProps })
        return
      }

      createChartElement(chart.chartType, nextProps)
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
        const nextProps: any = {
          data: payload.data,
          optionRaw: undefined,
        }
        if (payload.options) nextProps.options = payload.options
        if (payload.theme?.colors) nextProps.themeColors = payload.theme.colors
        if (payload.theme?.textColor) nextProps.textColor = payload.theme.textColor
        if (payload.theme?.lineColor) nextProps.lineColor = payload.theme.lineColor

        slidesStore.updateElement({
          id: payload.elementId,
          props: nextProps,
        })
      }
    }

    // Automation Report: Handle updated KPI text from Dashboard
    if (event.data?.type === 'update-kpi-text') {
      const payload = event.data?.payload as {
        elementId: string
        content: string
        defaultColor?: string
        defaultFontName?: string
      } | undefined

      if (payload?.elementId && typeof payload.content === 'string') {
        const existing = findTextElementById(payload.elementId)
        if (existing) {
          const text = extractFirstTextFromHtml(payload.content)
          const styles = extractTextStyles(existing.content || '')
          const content = buildTextHtml(text, styles)
          slidesStore.updateElement({
            id: payload.elementId,
            props: {
              content,
              dashboardWidgetKind: 'kpi' as const,
            } as any,
          })
          return
        }

        slidesStore.updateElement({
          id: payload.elementId,
          props: {
            content: payload.content,
            ...(payload.defaultColor ? { defaultColor: payload.defaultColor } : {}),
            ...(payload.defaultFontName ? { defaultFontName: payload.defaultFontName } : {}),
            dashboardWidgetKind: 'kpi' as const,
          } as any,
        })
      }
    }

    if (event.data?.type === 'ai-summary-create-or-update-text') {
      const payload = event.data?.payload as { contextId?: string; elementId?: string; text?: string } | undefined
      const contextId = String(payload?.contextId || '').trim()
      const elementId = String(payload?.elementId || '').trim()
      const text = String(payload?.text || '')
      if (!contextId) return

      let nextElementId = elementId
      const existing = findTextElementById(elementId)

      if (existing) {
        const styles = extractTextStyles(existing.content || '')
        const content = buildTextHtml(text, styles)
        const nextProps: any = { content }

        const isKpiText =
          existing.autoResize === false &&
          (existing.dashboardWidgetKind === 'kpi' || existing.canvasWidgetKind === 'kpi')

        const isAiSummaryBox = typeof existing.name === 'string' && existing.name.startsWith('AI Summary')
        const isLegacyAiSummaryBox = isAiSummaryBox && !isKpiText && (existing.autoResize === false || existing.padding === 0)

        if (isLegacyAiSummaryBox) {
          nextProps.autoResize = true
          nextProps.padding = 10
          if (existing.lineHeight === 1) nextProps.lineHeight = 1.3
          if (existing.paragraphSpace === 0) nextProps.paragraphSpace = 6
          if (existing.valign && existing.valign !== 'top') nextProps.valign = 'top'
        }

        slidesStore.updateElement({ id: existing.id, props: nextProps })
        nextElementId = existing.id
      } else {
        const slideW = slidesStore.viewportSize
        const slideH = slidesStore.viewportSize * slidesStore.viewportRatio
        const boxW = Math.min(820, Math.max(340, slideW * 0.76))
        const boxH = Math.min(520, Math.max(200, slideH * 0.38))

        const content = buildTextHtml(text)
        const id = createTextElement(
          {
            left: (slideW - boxW) / 2,
            top: (slideH - boxH) / 2,
            width: boxW,
            height: boxH,
          },
          { content, autoFocus: false },
        )

        slidesStore.updateElement({
          id,
          props: {
            autoResize: true,
            padding: 10,
            lineHeight: 1.3,
            paragraphSpace: 6,
            valign: 'top',
            name: `AI Summary ${contextId}`,
          } as any,
        })
        nextElementId = id
      }

      if (nextElementId) {
        window.parent?.postMessage(
          { source: HOST_SOURCE, type: 'ai-summary-text-linked', payload: { contextId, elementId: nextElementId } },
          '*',
        )
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
    () => [slidesStore.mutationTick, slidesStore.title, slidesStore.theme, presentationId.value],
    () => {
      if (!presentationId.value) return
      if (applyingHostUpdate.value) return
      autosaveDirty.value = true
      lastLocalMutationAt.value = Date.now()
      if (isInteracting.value) return
      scheduleAutosave(1200)
    },
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
