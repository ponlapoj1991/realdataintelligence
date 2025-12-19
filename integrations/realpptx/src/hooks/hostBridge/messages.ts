type SlidesStoreLike = {
  slides: any
  theme: any
  title: string
  setTheme: (theme: any) => void
}

export const applyHostSettingsToSlides = (params: {
  slidesStore: SlidesStoreLike
  payload?: {
    globalSettings?: any
    chartTheme?: { palette?: string[]; typography?: { fontFamily?: string } }
  }
}) => {
  const { slidesStore, payload } = params
  const palette = payload?.chartTheme?.palette
  const fontFamily = payload?.chartTheme?.typography?.fontFamily

  if (Array.isArray(palette) && palette.length > 0) {
    slidesStore.setTheme({ themeColors: palette })
    try {
      document.documentElement.style.setProperty('--realpptx-accent', palette[0])
    }
    catch {
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
    }
    catch {
      // ignore
    }
  }
}

export const migrateLegacyDraftToHost = (params: {
  presentationId: string
  hostSource: string
}) => {
  const { presentationId, hostSource } = params
  try {
    if (!presentationId) return

    const legacyKey = `pptist_presentation_draft_${presentationId}`
    const nextKey = `realpptx_presentation_draft_${presentationId}`
    const raw = localStorage.getItem(nextKey) || localStorage.getItem(legacyKey)
    if (!raw) return

    const parsed = JSON.parse(raw) as { slides?: any[]; title?: string; theme?: any } | null
    if (!parsed?.slides || !Array.isArray(parsed.slides)) return

    window.parent?.postMessage(
      {
        source: hostSource,
        type: 'autosave-presentation',
        payload: {
          presentationId,
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
  }
  catch {
    // ignore
  }
}

export const emitPresentationExportToHost = (params: {
  slidesStore: SlidesStoreLike
  hostSource: string
}) => {
  const { slidesStore, hostSource } = params
  const slides = JSON.parse(JSON.stringify(slidesStore.slides || []))
  const theme = JSON.parse(JSON.stringify(slidesStore.theme || {}))
  const payload = { slides, title: slidesStore.title, theme }
  window.parent?.postMessage(
    {
      source: hostSource,
      type: 'presentation-export',
      payload,
    },
    '*'
  )
}
