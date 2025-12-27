import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { parse, type Shape, type Element, type ChartItem, type BaseElement } from 'pptxtojson'
import { nanoid } from 'nanoid'
import tinycolor from 'tinycolor2'
import { useSlidesStore } from '@/store'
import { decrypt } from '@/utils/crypto'
import { type ShapePoolItem, SHAPE_LIST, SHAPE_PATH_FORMULAS } from '@/configs/shapes'
import useAddSlidesOrElements from '@/hooks/useAddSlidesOrElements'
import useSlideHandler from '@/hooks/useSlideHandler'
import useHistorySnapshot from './useHistorySnapshot'
import message from '@/utils/message'
import { getSvgPathRange } from '@/utils/svgPathParser'
import type {
  Slide,
  TableCellStyle,
  TableCell,
  ChartType,
  SlideBackground,
  LineStyleType,
  PPTElementOutline,
  PPTShapeElement,
  PPTLineElement,
  PPTImageElement,
  ShapeTextAlign,
  PPTTextElement,
  ChartOptions,
  Gradient,
} from '@/types/slides'

const PPTX_PT_TO_PX_RATIO = 96 / 72
const DEFAULT_VIEWPORT_SIZE = 1000

const normalizeFontSizeToPx = (html: string, ratio: number) => {
  if (!html) return html

  const pxScale = ratio / PPTX_PT_TO_PX_RATIO

  return html.replace(/font-size:\s*([\d.]+)\s*(pt|px)?/gi, (match, p1, unitRaw) => {
    const size = parseFloat(p1)
    if (!Number.isFinite(size)) return match

    const unit = (unitRaw || '').toLowerCase()
    const scaled = unit === 'pt' ? size * ratio : size * pxScale
    return `font-size: ${scaled.toFixed(1)}px`
  })
}

const parseFontSizeToPx = (value: string, ratio: number) => {
  const raw = value.trim()
  if (!raw) return ''
  const match = raw.match(/^([\d.]+)\s*(pt|px)?$/i)
  if (!match) return ''

  const size = parseFloat(match[1])
  if (!Number.isFinite(size)) return ''

  const unit = (match[2] || 'px').toLowerCase()
  const scaled = unit === 'pt' ? size * ratio : size * (ratio / PPTX_PT_TO_PX_RATIO)
  return `${scaled.toFixed(1)}px`
}

const normalizeColorInput = (value: string) => {
  const raw = value.trim()
  if (!raw) return ''
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{8}$/i.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{4}$/i.test(raw)) return `#${raw}`
  return raw
}

const parseHexColor = (value: string) => {
  const raw = value.trim()
  const match = raw.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return null

  const hex = match[1].toLowerCase()
  const expand = (c: string) => c + c

  const rgb = hex.length === 3 || hex.length === 4
    ? [expand(hex[0]), expand(hex[1]), expand(hex[2])]
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]

  const alphaHex = hex.length === 4
    ? expand(hex[3])
    : (hex.length === 8 ? hex.slice(6, 8) : 'ff')

  const r = parseInt(rgb[0], 16)
  const g = parseInt(rgb[1], 16)
  const b = parseInt(rgb[2], 16)
  const a = parseInt(alphaHex, 16) / 255

  if (![r, g, b, a].every(n => Number.isFinite(n))) return null

  return { r, g, b, a }
}

const toRgbaString = (rgba: { r: number; g: number; b: number; a: number }) => {
  const alpha = Number(rgba.a.toFixed(4))
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`
}

const normalizeCssColorInput = (value: string) => {
  const normalized = normalizeColorInput(value)
  const parsed = parseHexColor(normalized)
  if (parsed && parsed.a < 1) return toRgbaString(parsed)
  return normalized
}

const toFiniteNumber = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const toLineStyleType = (value: unknown): LineStyleType => {
  if (value === 'dashed' || value === 'dotted' || value === 'solid') return value
  return 'solid'
}

const resolveSchemeColor = (value: string, themeColors: string[]) => {
  const key = value.trim().toLowerCase()
  const accentMatch = key.match(/^accent([1-6])$/)
  if (accentMatch) {
    const index = Number(accentMatch[1]) - 1
    const c = themeColors[index]
    return c ? normalizeColorInput(c) : ''
  }
  if (key === 'hlink') return '#0563C1'
  if (key === 'folhlink') return '#954F72'
  if (key === 'tx1' || key === 'dk1' || key === 'dk2') return '#000000'
  if (key === 'bg1' || key === 'lt1' || key === 'lt2') return '#FFFFFF'
  return ''
}

const resolveColor = (value: string, themeColors: string[], fallback: string) => {
  const scheme = resolveSchemeColor(value, themeColors)
  const normalized = normalizeCssColorInput(scheme || value)
  const c = tinycolor(normalized)
  if (c.isValid()) return c.getAlpha() < 1 ? c.toRgbString() : c.toHexString()

  const fallbackNormalized = normalizeCssColorInput(fallback)
  const fc = tinycolor(fallbackNormalized)
  if (!fc.isValid()) return ''
  return fc.getAlpha() < 1 ? fc.toRgbString() : fc.toHexString()
}

const buildOutline = (value: { borderWidth?: unknown; borderColor?: unknown; borderType?: unknown }, ratio: number, themeColors: string[]): PPTElementOutline | undefined => {
  const widthRaw = toFiniteNumber(value.borderWidth)
  if (!widthRaw || widthRaw <= 0) return undefined

  const colorInput = typeof value.borderColor === 'string' ? value.borderColor : ''
  const color = resolveColor(colorInput, themeColors, '')
  if (!color) return undefined

  const c = tinycolor(color)
  if (!c.isValid() || c.getAlpha() === 0) return undefined

  const style = toLineStyleType(value.borderType)
  return {
    color,
    width: +((widthRaw * ratio).toFixed(2)),
    style,
  }
}

const sanitizeFontFamily = (value: string, fallback: string) => {
  const raw = value.trim()
  if (!raw) return fallback
  const first = raw.split(',')[0]?.trim() || ''
  const cleaned = first
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/['"]/g, '')
    .trim()

  const lower = cleaned.toLowerCase()
  if (!cleaned) return fallback
  if (lower.startsWith('+')) return fallback
  if (['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'system-ui'].includes(lower)) return fallback
  return cleaned
}

const extractTextDefaults = (html: string) => {
  if (!html) return { fontFamily: '', color: '', fontSize: '' }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const nodes = Array.from(doc.body.querySelectorAll<HTMLElement>('*'))
  let fontFamily = ''
  let color = ''
  let fontSize = ''

  for (const node of nodes) {
    if (!fontFamily && node.style.fontFamily) fontFamily = node.style.fontFamily
    if (!color && node.style.color) color = node.style.color
    if (!fontSize && node.style.fontSize) fontSize = node.style.fontSize
    if (fontFamily && color && fontSize) break
  }

  if (!fontSize) {
    const match = html.match(/font-size:\s*([\d.]+px)/i)
    if (match) fontSize = match[1]
  }

  return { fontFamily, color, fontSize }
}

export default () => {
  const slidesStore = useSlidesStore()
  const { theme } = storeToRefs(useSlidesStore())

  const { addHistorySnapshot } = useHistorySnapshot()
  const { addSlidesFromData } = useAddSlidesOrElements()
  const { isEmptySlide } = useSlideHandler()

  const exporting = ref(false)

  // 导入JSON文件
  const importJSON = (files: FileList | File[], cover = false) => {
    const file = files[0]

    const reader = new FileReader()
    reader.addEventListener('load', () => {
      try {
        const { slides } = JSON.parse(reader.result as string)
        if (cover) {
          slidesStore.updateSlideIndex(0)
          slidesStore.setSlides(slides)
          addHistorySnapshot()
        }
        else if (isEmptySlide.value) {
          slidesStore.setSlides(slides)
          addHistorySnapshot()
        }
        else addSlidesFromData(slides)
      }
      catch {
        message.error('无法正确读取 / 解析该文件')
      }
    })
    reader.readAsText(file)
  }

  // 导入 RealPPTX 文件（兼容 .pptist）
  const importSpecificFile = (files: FileList | File[], cover = false) => {
    const file = files[0]

    const reader = new FileReader()
    reader.addEventListener('load', () => {
      try {
        const { slides } = JSON.parse(decrypt(reader.result as string))
        if (cover) {
          slidesStore.updateSlideIndex(0)
          slidesStore.setSlides(slides)
          addHistorySnapshot()
        }
        else if (isEmptySlide.value) {
          slidesStore.setSlides(slides)
          addHistorySnapshot()
        }
        else addSlidesFromData(slides)
      }
      catch {
        message.error('无法正确读取 / 解析该文件')
      }
    })
    reader.readAsText(file)
  }

  const rotateLine = (line: PPTLineElement, angleDeg: number) => {
    const { start, end } = line
      
    const angleRad = angleDeg * Math.PI / 180
    
    const midX = (start[0] + end[0]) / 2
    const midY = (start[1] + end[1]) / 2
    
    const startTransX = start[0] - midX
    const startTransY = start[1] - midY
    const endTransX = end[0] - midX
    const endTransY = end[1] - midY
    
    const cosA = Math.cos(angleRad)
    const sinA = Math.sin(angleRad)
    
    const startRotX = startTransX * cosA - startTransY * sinA
    const startRotY = startTransX * sinA + startTransY * cosA
    
    const endRotX = endTransX * cosA - endTransY * sinA
    const endRotY = endTransX * sinA + endTransY * cosA
    
    const startNewX = startRotX + midX
    const startNewY = startRotY + midY
    const endNewX = endRotX + midX
    const endNewY = endRotY + midY
    
    const beforeMinX = Math.min(start[0], end[0])
    const beforeMinY = Math.min(start[1], end[1])
    
    const afterMinX = Math.min(startNewX, endNewX)
    const afterMinY = Math.min(startNewY, endNewY)
    
    const startAdjustedX = startNewX - afterMinX
    const startAdjustedY = startNewY - afterMinY
    const endAdjustedX = endNewX - afterMinX
    const endAdjustedY = endNewY - afterMinY
    
    const startAdjusted: [number, number] = [startAdjustedX, startAdjustedY]
    const endAdjusted: [number, number] = [endAdjustedX, endAdjustedY]
    const offset = [afterMinX - beforeMinX, afterMinY - beforeMinY]
    
    return {
      start: startAdjusted,
      end: endAdjusted,
      offset,
    }
  }

  const parseLineElement = (el: Shape, ratio: number, themeColors: string[]) => {
    let start: [number, number] = [0, 0]
    let end: [number, number] = [0, 0]

    if (!el.isFlipV && !el.isFlipH) { // 右下
      start = [0, 0]
      end = [el.width, el.height]
    }
    else if (el.isFlipV && el.isFlipH) { // 左上
      start = [el.width, el.height]
      end = [0, 0]
    }
    else if (el.isFlipV && !el.isFlipH) { // 右上
      start = [0, el.height]
      end = [el.width, 0]
    }
    else { // 左下
      start = [el.width, 0]
      end = [0, el.height]
    }

    const data: PPTLineElement = {
      type: 'line',
      id: nanoid(10),
      width: +((el.borderWidth || 1) * ratio).toFixed(2),
      left: el.left,
      top: el.top,
      start,
      end,
      style: toLineStyleType(el.borderType),
      color: resolveColor(el.borderColor, themeColors, el.borderColor),
      points: ['', /straightConnector/.test(el.shapType) ? 'arrow' : '']
    }
    if (el.rotate) {
      const { start, end, offset } = rotateLine(data, el.rotate)

      data.start = start
      data.end = end
      data.left = data.left + offset[0]
      data.top = data.top + offset[1]
    }
    if (/bentConnector/.test(el.shapType)) {
      data.broken2 = [
        Math.abs(data.start[0] - data.end[0]) / 2,
        Math.abs(data.start[1] - data.end[1]) / 2,
      ]
    }
    if (/curvedConnector/.test(el.shapType)) {
      const cubic: [number, number] = [
        Math.abs(data.start[0] - data.end[0]) / 2,
        Math.abs(data.start[1] - data.end[1]) / 2,
      ]
      data.cubic = [cubic, cubic]
    }

    return data
  }

  const flipGroupElements = (elements: BaseElement[], axis: 'x' | 'y') => {
    const minX = Math.min(...elements.map(el => el.left))
    const maxX = Math.max(...elements.map(el => el.left + el.width))
    const minY = Math.min(...elements.map(el => el.top))
    const maxY = Math.max(...elements.map(el => el.top + el.height))

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    return elements.map(element => {
      const newElement = { ...element }

      if (axis === 'y') newElement.left = 2 * centerX - element.left - element.width
      if (axis === 'x') newElement.top = 2 * centerY - element.top - element.height
  
      return newElement
    })
  }

  const calculateRotatedPosition = (
    x: number,
    y: number,
    w: number,
    h: number,
    ox: number,
    oy: number,
    k: number,
  ) => {
    const radians = k * (Math.PI / 180)

    const containerCenterX = x + w / 2
    const containerCenterY = y + h / 2

    const relativeX = ox - w / 2
    const relativeY = oy - h / 2

    const rotatedX = relativeX * Math.cos(radians) + relativeY * Math.sin(radians)
    const rotatedY = -relativeX * Math.sin(radians) + relativeY * Math.cos(radians)

    const graphicX = containerCenterX + rotatedX
    const graphicY = containerCenterY + rotatedY

    return { x: graphicX, y: graphicY }
  }

  // 导入PPTX文件
  const importPPTXFile = (files: FileList | File[], options?: { cover?: boolean; fixedViewport?: boolean }) => {
    const defaultOptions = {
      cover: false,
      fixedViewport: false, 
    }
    const { cover, fixedViewport } = { ...defaultOptions, ...options }

    const file = files[0]
    if (!file) return

    exporting.value = true

    const shapeList: ShapePoolItem[] = []
    for (const item of SHAPE_LIST) {
      shapeList.push(...item.children)
    }
    
    const reader = new FileReader()
    reader.onload = async e => {
      let json = null
      try {
        json = await parse(e.target!.result as ArrayBuffer)
      }
      catch {
        exporting.value = false
        message.error('无法正确读取 / 解析该文件')
        return
      }

      const width = json.size.width
      const height = json.size.height
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        exporting.value = false
        message.error('无法正确读取 / 解析该文件')
        return
      }
      slidesStore.setViewportRatio(height / width)

      let ratio = PPTX_PT_TO_PX_RATIO
      
      if (fixedViewport) {
        slidesStore.setViewportSize(DEFAULT_VIEWPORT_SIZE)
        ratio = DEFAULT_VIEWPORT_SIZE / width
      }
      else slidesStore.setViewportSize(width * ratio)

      const pptxThemeColors = (json.themeColors || []).map(c => normalizeColorInput(c) || c)
      slidesStore.setTheme({ themeColors: pptxThemeColors })

      let slides: Slide[] = []
      try {
      for (const item of json.slides) {
        const { type, value } = item.fill
        let background: SlideBackground
        if (type === 'image') {
          background = {
            type: 'image',
            image: {
              src: value.picBase64,
              size: 'cover',
            },
          }
        }
        else if (type === 'gradient') {
          background = {
            type: 'gradient',
            gradient: {
              type: value.path === 'line' ? 'linear' : 'radial',
              colors: value.colors.map(item => ({
                ...item,
                pos: parseInt(item.pos),
                color: resolveColor(item.color, pptxThemeColors, '#000000'),
              })),
              rotate: value.rot + 90,
            },
          }
        }
        else {
          background = {
            type: 'solid',
            color: resolveColor(value || '#fff', pptxThemeColors, '#fff'),
          }
        }

        const slide: Slide = {
          id: nanoid(10),
          elements: [],
          background,
          remark: item.note || '',
        }

        const parseElements = (elements: Element[]) => {
          const sortedElements = elements.sort((a, b) => a.order - b.order)

          for (const el of sortedElements) {
            const originWidth = el.width || 1
            const originHeight = el.height || 1
            const originLeft = el.left
            const originTop = el.top

            el.width = el.width * ratio
            el.height = el.height * ratio
            el.left = el.left * ratio
            el.top = el.top * ratio
  
            if (el.type === 'text') {
              const vAlignMap: Record<string, 'top' | 'middle' | 'bottom'> = {
                mid: 'middle',
                down: 'bottom',
                up: 'top',
              }

              const content = normalizeFontSizeToPx(el.content, ratio)
              const defaults = extractTextDefaults(content)
              const fallbackFontName = theme.value.fontName || 'Tahoma'
              const fallbackColor = theme.value.fontColor || '#333'

               const textEl: PPTTextElement = {
                 type: 'text',
                 id: nanoid(10),
                 width: el.width,
                 height: el.height,
                left: el.left,
                top: el.top,
                rotate: el.rotate,
                defaultFontName: sanitizeFontFamily(defaults.fontFamily || fallbackFontName, fallbackFontName),
                defaultColor: resolveColor(defaults.color || fallbackColor, pptxThemeColors, fallbackColor),
                defaultFontSize: defaults.fontSize || undefined,
                content,
                padding: 0,
                 lineHeight: 1,
                 paragraphSpace: 0,
                 valign: vAlignMap[el.vAlign] || 'top',
                 autoResize: false,
                 fill: el.fill.type === 'color' ? resolveColor(el.fill.value, pptxThemeColors, '') : '',
                 vertical: el.isVertical,
               }
               const outline = buildOutline({ borderWidth: el.borderWidth, borderColor: el.borderColor, borderType: el.borderType }, ratio, pptxThemeColors)
               if (outline) textEl.outline = outline
               if (el.shadow) {
                 textEl.shadow = {
                   h: el.shadow.h * ratio,
                   v: el.shadow.v * ratio,
                  blur: el.shadow.blur * ratio,
                  color: resolveColor(el.shadow.color, pptxThemeColors, el.shadow.color),
                }
              }
              slide.elements.push(textEl)
            }
            else if (el.type === 'image') {
              const element: PPTImageElement = {
                type: 'image',
                id: nanoid(10),
                src: el.src,
                width: el.width,
                height: el.height,
                left: el.left,
                top: el.top,
                fixedRatio: true,
                 rotate: el.rotate,
                 flipH: el.isFlipH,
                 flipV: el.isFlipV,
               }
               const outline = buildOutline({ borderWidth: el.borderWidth, borderColor: el.borderColor, borderType: el.borderType }, ratio, pptxThemeColors)
               if (outline) element.outline = outline
               const clipShapeTypes = ['roundRect', 'ellipse', 'triangle', 'rhombus', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'parallelogram', 'trapezoid']
               if (el.rect) {
                 element.clip = {
                   shape: (el.geom && clipShapeTypes.includes(el.geom)) ? el.geom : 'rect',
                  range: [
                    [
                      el.rect.l || 0,
                      el.rect.t || 0,
                    ],
                    [
                      100 - (el.rect.r || 0),
                      100 - (el.rect.b || 0),
                    ],
                  ]
                }
              }
              else if (el.geom && clipShapeTypes.includes(el.geom)) {
                element.clip = {
                  shape: el.geom,
                  range: [[0, 0], [100, 100]]
                }
              }
              slide.elements.push(element)
            }
            else if (el.type === 'math') {
              slide.elements.push({
                type: 'image',
                id: nanoid(10),
                src: el.picBase64,
                width: el.width,
                height: el.height,
                left: el.left,
                top: el.top,
                fixedRatio: true,
                rotate: 0,
              })
            }
            else if (el.type === 'audio') {
              slide.elements.push({
                type: 'audio',
                id: nanoid(10),
                src: el.blob,
                width: el.width,
                height: el.height,
                left: el.left,
                top: el.top,
                rotate: 0,
                fixedRatio: false,
                color: theme.value.themeColors[0],
                loop: false,
                autoplay: false,
              })
            }
            else if (el.type === 'video') {
              slide.elements.push({
                type: 'video',
                id: nanoid(10),
                src: (el.blob || el.src)!,
                width: el.width,
                height: el.height,
                left: el.left,
                top: el.top,
                rotate: 0,
                autoplay: false,
              })
            }
            else if (el.type === 'shape') {
              if (el.shapType === 'line' || /Connector/.test(el.shapType)) {
                const lineElement = parseLineElement(el, ratio, pptxThemeColors)
                slide.elements.push(lineElement)
              }
              else {
                const shape = shapeList.find(item => item.pptxShapeType === el.shapType)

                const vAlignMap: { [key: string]: ShapeTextAlign } = {
                  'mid': 'middle',
                  'down': 'bottom',
                  'up': 'top',
                }

                const gradient: Gradient | undefined = el.fill?.type === 'gradient' ? {
                  type: el.fill.value.path === 'line' ? 'linear' : 'radial',
                  colors: el.fill.value.colors.map(item => ({
                    ...item,
                    pos: parseInt(item.pos),
                    color: resolveColor(item.color, pptxThemeColors, '#000000'),
                  })),
                  rotate: el.fill.value.rot,
                } : undefined

                const pattern: string | undefined = el.fill?.type === 'image' ? el.fill.value.picBase64 : undefined

                const fill = el.fill?.type === 'color' ? resolveColor(el.fill.value, pptxThemeColors, '') : ''

                const textContent = normalizeFontSizeToPx(el.content, ratio)
                const textDefaults = extractTextDefaults(textContent)
                const fallbackFontName = theme.value.fontName || 'Tahoma'
                const fallbackColor = theme.value.fontColor || '#333'
                
                 const element: PPTShapeElement = {
                   type: 'shape',
                   id: nanoid(10),
                   width: el.width,
                   height: el.height,
                  left: el.left,
                  top: el.top,
                  viewBox: [200, 200],
                  path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
                  fill,
                  gradient,
                   pattern,
                   fixedRatio: false,
                   rotate: el.rotate,
                   text: {
                     content: textContent,
                     defaultFontName: sanitizeFontFamily(textDefaults.fontFamily || fallbackFontName, fallbackFontName),
                     defaultColor: resolveColor(textDefaults.color || fallbackColor, pptxThemeColors, fallbackColor),
                     defaultFontSize: textDefaults.fontSize || undefined,
                     align: vAlignMap[el.vAlign] || 'middle',
                     padding: 0,
                     lineHeight: 1,
                     paragraphSpace: 0,
                     clip: true,
                   },
                   flipH: el.isFlipH,
                   flipV: el.isFlipV,
                 }
                 const outline = buildOutline({ borderWidth: el.borderWidth, borderColor: el.borderColor, borderType: el.borderType }, ratio, pptxThemeColors)
                 if (outline) element.outline = outline
                 if (el.shadow) {
                   element.shadow = {
                     h: el.shadow.h * ratio,
                     v: el.shadow.v * ratio,
                    blur: el.shadow.blur * ratio,
                    color: resolveColor(el.shadow.color, pptxThemeColors, el.shadow.color),
                  }
                }
    
                if (shape) {
                  element.path = shape.path
                  element.viewBox = shape.viewBox
    
                  if (shape.pathFormula) {
                    element.pathFormula = shape.pathFormula
                    element.viewBox = [el.width, el.height]
    
                    const pathFormula = SHAPE_PATH_FORMULAS[shape.pathFormula]
                    if ('editable' in pathFormula && pathFormula.editable) {
                      element.path = pathFormula.formula(el.width, el.height, pathFormula.defaultValue)
                      element.keypoints = pathFormula.defaultValue
                    }
                    else element.path = pathFormula.formula(el.width, el.height)
                  }
                }
                else if (el.path && el.path.indexOf('NaN') === -1) {
                  const { maxX, maxY } = getSvgPathRange(el.path)
                  element.path = el.path
                  if ((maxX / maxY) > (originWidth / originHeight)) {
                    element.viewBox = [maxX, maxX * originHeight / originWidth]
                  }
                  else {
                    element.viewBox = [maxY * originWidth / originHeight, maxY]
                  }
                }
                if (el.shapType === 'custom') {
                  if (el.path!.indexOf('NaN') !== -1) {
                    if (element.width === 0) element.width = 0.1
                    if (element.height === 0) element.height = 0.1
                    element.path = el.path!.replace(/NaN/g, '0')
                  }
                  else {
                    element.special = true
                    element.path = el.path!
                  }
                  const { maxX, maxY } = getSvgPathRange(element.path)
                  if ((maxX / maxY) > (originWidth / originHeight)) {
                    element.viewBox = [maxX, maxX * originHeight / originWidth]
                  }
                  else {
                    element.viewBox = [maxY * originWidth / originHeight, maxY]
                  }
                }
    
                if (element.path) slide.elements.push(element)
              }
            }
            else if (el.type === 'table') {
              const row = el.data.length
              const col = el.data[0].length
  
              const fallbackFontName = theme.value.fontName || 'Tahoma'
              const fallbackColor = theme.value.fontColor || '#333'
              const scaledRowHeights = Array.isArray(el.rowHeights)
                ? el.rowHeights.map(item => {
                    const n = toFiniteNumber(item)
                    return n && n > 0 ? +((n * ratio).toFixed(2)) : 0
                  })
                : []
              const rowHeights = scaledRowHeights.length === row && scaledRowHeights.every(item => item > 0)
                ? scaledRowHeights
                : undefined

              const style: TableCellStyle = {
                fontname: fallbackFontName,
                color: fallbackColor,
              }
              const data: TableCell[][] = []
              for (let i = 0; i < row; i++) {
                const rowCells: TableCell[] = []
                for (let j = 0; j < col; j++) {
                  const cellData = el.data[i][j]

                  let textDiv: HTMLDivElement | null = document.createElement('div')
                  textDiv.innerHTML = normalizeFontSizeToPx(cellData.text, PPTX_PT_TO_PX_RATIO)
                  const p = textDiv.querySelector('p')
                  const align = p?.style.textAlign || 'left'
 
                  const span = textDiv.querySelector('span')
                  const fontsize = span?.style.fontSize ? parseFontSizeToPx(span.style.fontSize, ratio) : ''
                  const fontname = sanitizeFontFamily(span?.style.fontFamily || '', fallbackFontName)
                  const color = span?.style.color || cellData.fontColor

                  rowCells.push({
                    id: nanoid(10),
                    colspan: cellData.colSpan || 1,
                    rowspan: cellData.rowSpan || 1,
                    text: textDiv.innerText,
                    style: {
                      ...style,
                      align: ['left', 'right', 'center'].includes(align) ? (align as 'left' | 'right' | 'center') : 'left',
                      fontsize,
                      fontname,
                      color: resolveColor(color || fallbackColor, pptxThemeColors, fallbackColor),
                      bold: cellData.fontBold,
                      backcolor: resolveColor(cellData.fillColor || '', pptxThemeColors, ''),
                    },
                  })
                  textDiv = null
                }
                data.push(rowCells)
              }
  
              const widthValues = Array.isArray(el.colWidths) && el.colWidths.length === col
                ? el.colWidths.map(item => {
                    const n = toFiniteNumber(item)
                    return n && n > 0 ? n : 0
                  })
                : []
              const allWidth = widthValues.reduce((a, b) => a + b, 0)
              const colWidths: number[] = allWidth > 0
                ? widthValues.map(item => item / allWidth)
                : new Array(col).fill(1 / col)

              const firstCell = el.data[0][0]
              const border = firstCell.borders.top ||
                firstCell.borders.bottom ||
                el.borders.top ||
                el.borders.bottom ||
                firstCell.borders.left ||
                firstCell.borders.right ||
                el.borders.left ||
                el.borders.right
              const borderWidth = border?.borderWidth || 0
              const borderStyle = border?.borderType || 'solid'
              const borderColor = border?.borderColor || '#eeece1'
              const outline = buildOutline({ borderWidth, borderColor, borderType: borderStyle }, ratio, pptxThemeColors) || {
                width: 0,
                style: 'solid',
                color: 'transparent',
              }
              const cellMinHeight = rowHeights?.length ? Math.min(...rowHeights) : (scaledRowHeights[0] || 36)
              const height = rowHeights?.length ? rowHeights.reduce((sum, item) => sum + item, 0) : el.height
  
              slide.elements.push({
                type: 'table',
                id: nanoid(10),
                width: el.width,
                height,
                left: el.left,
                top: el.top,
                colWidths,
                rowHeights,
                rotate: 0,
                data,
                outline,
                cellMinHeight,
              })
            }
            else if (el.type === 'chart') {
              // Validate chart data before processing
              const chartData = el.data
              if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
                console.warn('Chart import skipped: invalid or empty chart data', el.chartType)
                continue
              }

              let labels: string[] = []
              let legends: string[] = []
              let series: number[][] = []

              try {
                if (el.chartType === 'scatterChart' || el.chartType === 'bubbleChart') {
                  const firstRow = chartData[0]
                  if (!firstRow || !Array.isArray(firstRow)) {
                    console.warn('Chart import skipped: scatter/bubble chart has invalid first row')
                    continue
                  }
                  labels = firstRow.map((_, index) => `坐标${index + 1}`)
                  legends = ['X', 'Y']
                  series = chartData as number[][]
                }
                else {
                  const data = chartData as ChartItem[]
                  const firstItem = data[0]
                  if (!firstItem || !firstItem.xlabels || !firstItem.values) {
                    console.warn('Chart import skipped: chart data structure invalid', el.chartType)
                    continue
                  }
                  labels = Object.values(firstItem.xlabels)
                  legends = data.map(item => item.key || '')
                  series = data.map(item => {
                    if (!item.values || !Array.isArray(item.values)) return []
                    return item.values.map(v => {
                      const num = typeof v?.y === 'number' ? v.y : Number(v?.y)
                      return Number.isFinite(num) ? num : 0
                    })
                  })
                }

                // Ensure we have valid data
                if (labels.length === 0 || series.length === 0) {
                  console.warn('Chart import skipped: no valid labels or series', el.chartType)
                  continue
                }
              }
              catch (chartParseErr) {
                console.warn('Chart import skipped: parsing error', el.chartType, chartParseErr)
                continue
              }

              // Guard: extremely large charts can make import feel stuck.
              // Limit the in-canvas chart payload size while preserving the visible part of the chart.
              if (labels.length > 300) {
                labels = labels.slice(0, 300)
                series = series.map(row => row.slice(0, 300))
              }

              const options: ChartOptions = {}

              let chartType: ChartType = 'bar'

              switch (el.chartType) {
                case 'barChart':
                case 'bar3DChart':
                  chartType = 'bar'
                  // OOXML uses barDir="col" for column charts, and barDir="bar" for horizontal bar charts.
                  if (el.barDir === 'col') chartType = 'column'
                  if (el.grouping === 'stacked' || el.grouping === 'percentStacked') options.stack = true
                  break
                case 'lineChart':
                case 'line3DChart':
                  if (el.grouping === 'stacked' || el.grouping === 'percentStacked') options.stack = true
                  chartType = 'line'
                  break
                case 'areaChart':
                case 'area3DChart':
                  if (el.grouping === 'stacked' || el.grouping === 'percentStacked') options.stack = true
                  chartType = 'area'
                  break
                case 'scatterChart':
                case 'bubbleChart':
                  chartType = 'scatter'
                  break
                case 'pieChart':
                case 'pie3DChart':
                  chartType = 'pie'
                  break
                case 'radarChart':
                  chartType = 'radar'
                  break
                case 'doughnutChart':
                  chartType = 'ring'
                  break
                default:
              }

              slide.elements.push({
                type: 'chart',
                id: nanoid(10),
                chartType: chartType,
                width: el.width,
                height: el.height,
                left: el.left,
                top: el.top,
                rotate: 0,
                themeColors: (el.colors && el.colors.length ? el.colors : theme.value.themeColors).map(c => resolveColor(c, pptxThemeColors, c)),
                textColor: theme.value.fontColor,
                data: {
                  labels,
                  legends,
                  series,
                },
                options,
              })
            }
            else if (el.type === 'group') {
              let elements: BaseElement[] = el.elements.map(_el => {
                let left = _el.left + originLeft
                let top = _el.top + originTop

                if (el.rotate) {
                  const { x, y } = calculateRotatedPosition(originLeft, originTop, originWidth, originHeight, _el.left, _el.top, el.rotate)
                  left = x
                  top = y
                }

                const element = {
                  ..._el,
                  left,
                  top,
                }
                if (el.isFlipH && 'isFlipH' in element) element.isFlipH = true
                if (el.isFlipV && 'isFlipV' in element) element.isFlipV = true

                return element
              })
              if (el.isFlipH) elements = flipGroupElements(elements, 'y')
              if (el.isFlipV) elements = flipGroupElements(elements, 'x')
              parseElements(elements)
            }
            else if (el.type === 'diagram') {
              const elements = el.elements.map(_el => ({
                ..._el,
                left: _el.left + originLeft,
                top: _el.top + originTop,
              }))
              parseElements(elements)
            }
          }
        }
        parseElements([...item.elements, ...item.layoutElements])
        slides.push(slide)
      }
      }
      catch (parseErr) {
        console.error('PPTX parse error:', parseErr)
        exporting.value = false
        message.error('Failed to parse PPTX file')
        return
      }

      if (cover) {
        slidesStore.updateSlideIndex(0)
        slidesStore.setSlides(slides)
        addHistorySnapshot()
      }
      else if (isEmptySlide.value) {
        slidesStore.setSlides(slides)
        addHistorySnapshot()
      }
      else addSlidesFromData(slides)

      exporting.value = false
    }
    reader.readAsArrayBuffer(file)
  }

  return {
    importSpecificFile,
    importJSON,
    importPPTXFile,
    exporting,
  }
}
