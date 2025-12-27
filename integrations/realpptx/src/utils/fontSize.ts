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

