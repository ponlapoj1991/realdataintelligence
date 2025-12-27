export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const parseFontSizePx = (value: unknown, fallbackPx = 16) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallbackPx
  const raw = String(value ?? '').trim()
  if (!raw) return fallbackPx
  const normalized = raw.toLowerCase().endsWith('px') ? raw.slice(0, -2).trim() : raw
  const n = Number(normalized)
  if (!Number.isFinite(n)) return fallbackPx
  return n
}

export const formatFontSizePx = (px: number) => {
  const rounded = Math.round(px * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}px`
}

export const normalizeFontSizePx = (value: unknown, fallbackPx = 16) => {
  const px = parseFontSizePx(value, fallbackPx)
  const safe = clamp(px, 1, 2000)
  return formatFontSizePx(safe)
}

export const nextPptFontSizePx = (currentPx: number, direction: 'up' | 'down') => {
  const cur = clamp(Number.isFinite(currentPx) ? currentPx : 16, 1, 2000)

  const step = (() => {
    if (cur < 12) return 1
    if (cur < 28) return 2
    if (cur < 72) return 4
    return 8
  })()

  const next = direction === 'up' ? cur + step : cur - step
  return clamp(next, 1, 2000)
}

export const FONT_SIZE_OPTIONS = Array.from({ length: 200 }, (_, i) => `${i + 1}px`)

// --- PowerPoint parity helpers (UI in points, internal stored as px) ---
// RealPPTX uses a virtual canvas where "px" values scale with viewportSize; PPT uses points.
// Use the same conversion as export: ratioPx2Pt = 96/72 * (viewportSize/960)
export const ratioPx2PtByViewportSize = (viewportSize: number) => (96 / 72) * (viewportSize / 960)

export const pxToPt = (px: number, viewportSize: number) => {
  const ratio = ratioPx2PtByViewportSize(viewportSize || 960)
  return ratio > 0 ? px / ratio : px
}

export const ptToPx = (pt: number, viewportSize: number) => {
  const ratio = ratioPx2PtByViewportSize(viewportSize || 960)
  return pt * ratio
}

export const parseFontSizePt = (value: unknown, fallbackPt = 12) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallbackPt
  const raw = String(value ?? '').trim()
  if (!raw) return fallbackPt
  const normalized = raw.toLowerCase().endsWith('pt') ? raw.slice(0, -2).trim() : raw
  const n = Number(normalized)
  if (!Number.isFinite(n)) return fallbackPt
  return n
}

export const formatFontSizePt = (pt: number) => {
  const rounded = Math.round(pt * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '')
}

export const normalizeFontSizePt = (value: unknown, fallbackPt = 12) => {
  const pt = parseFontSizePt(value, fallbackPt)
  return clamp(pt, 1, 2000)
}

export const ptToPxString = (value: unknown, viewportSize: number, fallbackPt = 12) => {
  const pt = normalizeFontSizePt(value, fallbackPt)
  const px = ptToPx(pt, viewportSize)
  return normalizeFontSizePx(px, px)
}

export const FONT_SIZE_OPTIONS_PT = Array.from({ length: 200 }, (_, i) => String(i + 1))

const PPT_FONT_SIZE_STEPS_PT = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  14, 16, 18, 20, 22, 24, 26, 28,
  32, 36, 40, 44, 48, 54, 60, 66, 72,
  80, 88, 96,
  104, 112, 120, 128, 136, 144, 152, 160, 168, 176, 184, 192, 200,
]

export const nextPptFontSizePt = (currentPt: number, direction: 'up' | 'down') => {
  const cur = clamp(Number.isFinite(currentPt) ? currentPt : 12, 1, 2000)
  const eps = 1e-6

  if (direction === 'up') {
    const next = PPT_FONT_SIZE_STEPS_PT.find((n) => n > cur + eps)
    return clamp(next ?? (cur + 1), 1, 2000)
  }

  for (let i = PPT_FONT_SIZE_STEPS_PT.length - 1; i >= 0; i -= 1) {
    const n = PPT_FONT_SIZE_STEPS_PT[i]
    if (n < cur - eps) return clamp(n, 1, 2000)
  }
  return 1
}

