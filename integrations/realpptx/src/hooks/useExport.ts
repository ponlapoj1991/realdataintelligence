import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { trim } from 'lodash'
import { saveAs } from 'file-saver'
import pptxgen from 'pptxgenjs'
import tinycolor from 'tinycolor2'
import { toPng, toJpeg } from 'html-to-image'
import { useSlidesStore } from '@/store'
import type { PPTElementOutline, PPTElementShadow, PPTElementLink, Slide } from '@/types/slides'
import { getElementRange, getLineElementPath, getTableSubThemeColor } from '@/utils/element'
import { type AST, toAST } from '@/utils/htmlParser'
import { type SvgPoints, toPoints } from '@/utils/svgPathParser'
import { encrypt } from '@/utils/crypto'
import { svg2Base64 } from '@/utils/svg2Base64'
import { addChartElementToSlide } from '@/utils/pptxChartExport'
import type { ChartPostprocessItem } from '@/utils/pptxChartPostprocess'
import { postprocessPptxCharts } from '@/utils/pptxChartPostprocess'
import message from '@/utils/message'

interface ExportImageConfig {
  quality: number
  width: number
  fontEmbedCSS?: string
}

export default () => {
  const slidesStore = useSlidesStore()
  const { slides, theme, viewportRatio, title, viewportSize } = storeToRefs(slidesStore)

  const defaultFontSize = 16

  const ratioPx2Inch = computed(() => {
    return 96 * (viewportSize.value / 960)
  })
  const ratioPx2Pt = computed(() => {
    return 96 / 72 * (viewportSize.value / 960)
  })

  const exporting = ref(false)

  // 导出图片
  const exportImage = (domRef: HTMLElement, format: string, quality: number, ignoreWebfont = true) => {
    exporting.value = true
    const toImage = format === 'png' ? toPng : toJpeg

    const foreignObjectSpans = domRef.querySelectorAll('foreignObject [xmlns]')
    foreignObjectSpans.forEach(spanRef => spanRef.removeAttribute('xmlns'))

    setTimeout(() => {
      const config: ExportImageConfig = {
        quality,
        width: 1600,
      }

      if (ignoreWebfont) config.fontEmbedCSS = ''

      toImage(domRef, config).then(dataUrl => {
        exporting.value = false
        saveAs(dataUrl, `${title.value}.${format}`)
      }).catch(() => {
        exporting.value = false
        message.error('Export Image Failed')
      })
    }, 200)
  }

  // 导出图片版PPTX
  const exportImagePPTX = (domRefs: NodeListOf<Element>) => {
    exporting.value = true

    setTimeout(() => {
      const pptx = new pptxgen()

      const config: ExportImageConfig = {
        quality: 1,
        width: 1600,
      }

      const promiseArr = []
      for (const domRef of domRefs) {
        const foreignObjectSpans = domRef.querySelectorAll('foreignObject [xmlns]')
        foreignObjectSpans.forEach(spanRef => spanRef.removeAttribute('xmlns'))

        const promiseFunc = () => toJpeg((domRef as HTMLElement), config)
        promiseArr.push(promiseFunc)
      }

      Promise.all(promiseArr.map(func => func())).then(async imgs => {
        for (const data of imgs) {
          const pptxSlide = pptx.addSlide()
          pptxSlide.addImage({
            data,
            x: 0,
            y: 0,
            w: viewportSize.value / ratioPx2Inch.value,
            h: viewportSize.value * viewportRatio.value / ratioPx2Inch.value,
          })
        }

        try {
          const fileName = `${title.value}.pptx`
          const blob = await (pptx as any).write('blob')
          saveAs(blob as Blob, fileName)
        }
        catch (err) {
          console.error(err)
          message.error('Export Failed')
        }
        finally {
          exporting.value = false
        }
      }).catch(err => {
        console.error(err)
        exporting.value = false
        message.error('Export Failed')
      })
    }, 200)
  }

  // 导出 RealPPTX 文件（兼容 .pptist）
  const exportSpecificFile = (_slides: Slide[]) => {
    const json = {
      title: title.value,
      width: viewportSize.value,
      height: viewportSize.value * viewportRatio.value,
      theme: theme.value,
      slides: _slides,
    }
    const blob = new Blob([encrypt(JSON.stringify(json))], { type: '' })
    saveAs(blob, `${title.value}.realpptx`)
  }

  // 导出JSON文件
  const exportJSON = () => {
    const json = {
      title: title.value,
      width: viewportSize.value,
      height: viewportSize.value * viewportRatio.value,
      theme: theme.value,
      slides: slides.value,
    }
    const blob = new Blob([JSON.stringify(json)], { type: '' })
    saveAs(blob, `${title.value}.json`)
  }

  // 格式化颜色值为 透明度 + HexString，供pptxgenjs使用
  const formatColor = (_color: string) => {
    if (!_color) {
      return {
        alpha: 0,
        color: '#000000',
      }
    }

    const c = tinycolor(_color)
    const alpha = c.getAlpha()
    const color = alpha === 0 ? '#ffffff' : c.setAlpha(1).toHexString()
    return {
      alpha,
      color,
    }
  }

  type FormatColor = ReturnType<typeof formatColor>

  const sanitizePptxText = (value: unknown) => {
    const raw = (value === null || value === undefined) ? '' : String(value)
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  }

  const sanitizeFontFace = (value: unknown, fallback = 'Arial') => {
    const raw = sanitizePptxText(value).trim()
    if (!raw) return fallback

    const first = raw.split(',')[0]?.trim() || ''
    const cleaned = first
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/['"]/g, '')
      .trim()
      .replace(/[<>&]/g, '')

    const lower = cleaned.toLowerCase()
    if (!cleaned) return fallback
    if (['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'system-ui'].includes(lower)) return fallback

    return cleaned
  }

  const toPptxVAlign = (value: unknown): 'top' | 'middle' | 'bottom' => {
    const v = typeof value === 'string' ? value : ''
    if (v === 'top') return 'top'
    if (v === 'bottom') return 'bottom'
    if (v === 'middle' || v === 'mid' || v === 'center') return 'middle'
    return 'top'
  }

  const toPptxHAlign = (value: unknown): pptxgen.HAlign => {
    const v = typeof value === 'string' ? value : ''
    if (v === 'center') return 'center'
    if (v === 'right') return 'right'
    if (v === 'justify') return 'justify'
    if (v === 'left') return 'left'
    if (v === 'start') return 'left'
    if (v === 'end') return 'right'
    return 'left'
  }

  const toFiniteNumber = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : null
  }

  const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const toPptxTransparency = (opacity: unknown) => {
    const o = toFiniteNumber(opacity)
    if (o === null) return null
    return clampNumber((1 - o) * 100, 0, 100)
  }

  // 将HTML字符串格式化为pptxgenjs所需的格式
  // 核心思路：将HTML字符串按样式分片平铺，每个片段需要继承祖先元素的样式信息，遇到块级元素需要换行
  const formatHTML = (html: string) => {
    const ast = toAST(html)
    let bulletFlag = false
    let indent = 0

    const slices: pptxgen.TextProps[] = []
    const parse = (obj: AST[], baseStyleObj: { [key: string]: string } = {}) => {

      for (const item of obj) {
        const isBlockTag = 'tagName' in item && ['div', 'li', 'p'].includes(item.tagName)

        if (isBlockTag && slices.length) {
          const lastSlice = slices[slices.length - 1]
          if (!lastSlice.options) lastSlice.options = {}
          lastSlice.options.breakLine = true
        }

        const styleObj = { ...baseStyleObj }
        const styleAttr = 'attributes' in item ? item.attributes.find(attr => attr.key === 'style') : null
        if (styleAttr && styleAttr.value) {
          const styleArr = styleAttr.value.split(';')
          for (const styleItem of styleArr) {
            const [_key, _value] = styleItem.split(': ')
            const [key, value] = [trim(_key), trim(_value)]
            if (key && value) styleObj[key] = value
          }
        }

        if ('tagName' in item) {
          if (item.tagName === 'em') {
            styleObj['font-style'] = 'italic'
          }
          if (item.tagName === 'strong') {
            styleObj['font-weight'] = 'bold'
          }
          if (item.tagName === 'sup') {
            styleObj['vertical-align'] = 'super'
          }
          if (item.tagName === 'sub') {
            styleObj['vertical-align'] = 'sub'
          }
          if (item.tagName === 'a') {
            const attr = item.attributes.find(attr => attr.key === 'href')
            styleObj['href'] = attr?.value || ''
          }
          if (item.tagName === 'ul') {
            styleObj['list-type'] = 'ul'
          }
          if (item.tagName === 'ol') {
            styleObj['list-type'] = 'ol'
          }
          if (item.tagName === 'li') {
            bulletFlag = true
          }
          if (item.tagName === 'p') {
            if ('attributes' in item) {
              const dataIndentAttr = item.attributes.find(attr => attr.key === 'data-indent')
              if (dataIndentAttr && dataIndentAttr.value) indent = +dataIndentAttr.value
            }
          }
        }

        if ('tagName' in item && item.tagName === 'br') {
          slices.push({ text: '', options: { breakLine: true } })
        }
        else if ('content' in item) {
          const text = sanitizePptxText(
            item.content.replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\n/g, '')
          )
          const options: pptxgen.TextPropsOptions = {}

          if (styleObj['font-size']) {
            const fs = toFiniteNumber(parseInt(styleObj['font-size']))
            if (fs !== null && fs > 0) options.fontSize = fs / ratioPx2Pt.value
          }
          if (styleObj['color']) {
            options.color = toPptxHex(formatColor(styleObj['color']).color)
          }
          if (styleObj['background-color']) {
            options.highlight = toPptxHex(formatColor(styleObj['background-color']).color)
          }
          if (styleObj['text-decoration-line']) {
            if (styleObj['text-decoration-line'].indexOf('underline') !== -1) {
              options.underline = {
                color: options.color || '000000',
                style: 'sng',
              }
            }
            if (styleObj['text-decoration-line'].indexOf('line-through') !== -1) {
              options.strike = 'sngStrike'
            }
          }
          if (styleObj['text-decoration']) {
            if (styleObj['text-decoration'].indexOf('underline') !== -1) {
              options.underline = {
                color: options.color || '000000',
                style: 'sng',
              }
            }
            if (styleObj['text-decoration'].indexOf('line-through') !== -1) {
              options.strike = 'sngStrike'
            }
          }
          if (styleObj['vertical-align']) {
            if (styleObj['vertical-align'] === 'super') options.superscript = true
            if (styleObj['vertical-align'] === 'sub') options.subscript = true
          }
          if (styleObj['text-align']) options.align = toPptxHAlign(styleObj['text-align'])
          if (styleObj['font-weight']) options.bold = styleObj['font-weight'] === 'bold'
          if (styleObj['font-style']) options.italic = styleObj['font-style'] === 'italic'
          if (styleObj['font-family']) options.fontFace = sanitizeFontFace(styleObj['font-family'])
          if (styleObj['href']) {
            const href = sanitizePptxText(styleObj['href']).trim()
            if (/^(https?:\/\/|mailto:)/i.test(href)) options.hyperlink = { url: href }
          }

          if (bulletFlag && styleObj['list-type'] === 'ol') {
            options.bullet = { type: 'number', indent: (options.fontSize || defaultFontSize) * 1.25 }
            options.paraSpaceBefore = 0.1
            bulletFlag = false
          }
          if (bulletFlag && styleObj['list-type'] === 'ul') {
            options.bullet = { indent: (options.fontSize || defaultFontSize) * 1.25 }
            options.paraSpaceBefore = 0.1
            bulletFlag = false
          }
          if (indent) {
            options.indentLevel = indent
            indent = 0
          }

          slices.push({ text, options })
        }
        else if ('children' in item) parse(item.children, styleObj)
      }
    }
    parse(ast)
    return slices
  }

  type Points = Array<
    | { x: number; y: number; moveTo?: boolean }
    | { x: number; y: number; curve: { type: 'arc'; hR: number; wR: number; stAng: number; swAng: number } }
    | { x: number; y: number; curve: { type: 'quadratic'; x1: number; y1: number } }
    | { x: number; y: number; curve: { type: 'cubic'; x1: number; y1: number; x2: number; y2: number } }
    | { close: true }
  >

  // 将SVG路径信息格式化为pptxgenjs所需要的格式
  const formatPoints = (points: SvgPoints, scale = { x: 1, y: 1 }): Points => {
    return points.map(point => {
      if (point.close !== undefined) {
        return { close: true }
      }
      else if (point.type === 'M') {
        return {
          x: point.x / ratioPx2Inch.value * scale.x,
          y: point.y / ratioPx2Inch.value * scale.y,
          moveTo: true,
        }
      }
      else if (point.curve) {
        if (point.curve.type === 'cubic') {
          return {
            x: point.x / ratioPx2Inch.value * scale.x,
            y: point.y / ratioPx2Inch.value * scale.y,
            curve: {
              type: 'cubic',
              x1: (point.curve.x1 as number) / ratioPx2Inch.value * scale.x,
              y1: (point.curve.y1 as number) / ratioPx2Inch.value * scale.y,
              x2: (point.curve.x2 as number) / ratioPx2Inch.value * scale.x,
              y2: (point.curve.y2 as number) / ratioPx2Inch.value * scale.y,
            },
          }
        }
        else if (point.curve.type === 'quadratic') {
          return {
            x: point.x / ratioPx2Inch.value * scale.x,
            y: point.y / ratioPx2Inch.value * scale.y,
            curve: {
              type: 'quadratic',
              x1: (point.curve.x1 as number) / ratioPx2Inch.value * scale.x,
              y1: (point.curve.y1 as number) / ratioPx2Inch.value * scale.y,
            },
          }
        }
      }
      return {
        x: point.x / ratioPx2Inch.value * scale.x,
        y: point.y / ratioPx2Inch.value * scale.y,
      }
    })
  }

  // 获取阴影配置
  const getShadowOption = (shadow: PPTElementShadow): pptxgen.ShadowProps => {
    const c = formatColor(shadow.color)
    const { h, v } = shadow

    let offset = 4
    let angle = 45

    if (h === 0 && v === 0) {
      offset = 4
      angle = 45
    }
    else if (h === 0) {
      if (v > 0) {
        offset = v
        angle = 90
      }
      else {
        offset = -v
        angle = 270
      }
    }
    else if (v === 0) {
      if (h > 0) {
        offset = h
        angle = 1
      }
      else {
        offset = -h
        angle = 180
      }
    }
    else if (h > 0 && v > 0) {
      offset = Math.max(h, v)
      angle = 45
    }
    else if (h > 0 && v < 0) {
      offset = Math.max(h, -v)
      angle = 315
    }
    else if (h < 0 && v > 0) {
      offset = Math.max(-h, v)
      angle = 135
    }
    else if (h < 0 && v < 0) {
      offset = Math.max(-h, -v)
      angle = 225
    }

    return {
      type: 'outer',
      color: c.color.replace('#', ''),
      opacity: c.alpha,
      blur: shadow.blur / ratioPx2Pt.value,
      offset,
      angle,
    }
  }

  const dashTypeMap = {
    'solid': 'solid',
    'dashed': 'dash',
    'dotted': 'sysDot',
  }

  // 获取边框配置
  const getOutlineOption = (outline: PPTElementOutline): pptxgen.ShapeLineProps => {
    const c = formatColor(outline?.color || '#000000')

    return {
      color: c.color.replace('#', ''),
      transparency: (1 - c.alpha) * 100,
      width: (outline.width || 1) / ratioPx2Pt.value,
      dashType: outline.style ? dashTypeMap[outline.style] as 'solid' | 'dash' | 'sysDot' : 'solid',
    }
  }

  // 获取超链接配置
  const getLinkOption = (link: PPTElementLink): pptxgen.HyperlinkProps | null => {
    const { type, target } = link
    if (type === 'web') {
      const url = sanitizePptxText(target).trim()
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return null
      return { url }
    }
    if (type === 'slide') {
      const index = slides.value.findIndex(slide => slide.id === target)
      if (index !== -1) return { slide: index + 1 }
    }

    return null
  }

  // 判断是否为Base64图片地址
  const isBase64Image = (url: string) => {
    const regex = /^data:image\/[^;]+;base64,/
    return url.match(regex) !== null
  }

  // 判断是否为SVG图片地址
  const isSVGImage = (url: string) => {
    const isSVGBase64 = /^data:image\/svg\+xml;base64,/.test(url)
    const isSVGUrl = /\.svg$/.test(url)
    return isSVGBase64 || isSVGUrl
  }

  const toPptxHex = (input: string) => {
    const raw = String(input || '').replace(/#/g, '').toUpperCase()
    if (/^[0-9A-F]{6}$/.test(raw)) return raw
    if (/^[0-9A-F]{3}$/.test(raw)) return raw.split('').map(ch => `${ch}${ch}`).join('')
    return '000000'
  }

  const svgElementToPngDataUrl = async (svgRef: HTMLElement) => {
    return toPng(svgRef as any, { cacheBust: true })
  }

  // 导出PPTX文件
  const buildPPTX = async (_slides: Slide[], masterOverwrite: boolean, ignoreMedia: boolean) => {
    const pptx = new pptxgen()
    const chartItems: ChartPostprocessItem[] = []
    let chartId = 0

    if (viewportRatio.value === 0.625) pptx.layout = 'LAYOUT_16x10'
    else if (viewportRatio.value === 0.75) pptx.layout = 'LAYOUT_4x3'
    else if (viewportRatio.value === 0.70710678) {
      pptx.defineLayout({ name: 'A3', width: 10, height: 7.0710678 })
      pptx.layout = 'A3'
    }
    else if (viewportRatio.value === 1.41421356) {
      pptx.defineLayout({ name: 'A3_V', width: 10, height: 14.1421356 })
      pptx.layout = 'A3_V'
    }
    else pptx.layout = 'LAYOUT_16x9'

    if (masterOverwrite) {
      const { color: bgColor, alpha: bgAlpha } = formatColor(theme.value.backgroundColor)
      pptx.defineSlideMaster({
        title: 'REALPPTX_MASTER',
        background: { color: toPptxHex(bgColor), transparency: (1 - bgAlpha) * 100 },
      })
    }

    for (const slide of _slides) {
      const pptxSlide = pptx.addSlide()

      if (slide.background) {
        const background = slide.background
        if (background.type === 'image' && background.image) {
          if (isSVGImage(background.image.src)) {
            pptxSlide.addImage({
              data: background.image.src,
              x: 0,
              y: 0,
              w: viewportSize.value / ratioPx2Inch.value,
              h: viewportSize.value * viewportRatio.value / ratioPx2Inch.value,
            })
          }
          else if (isBase64Image(background.image.src)) {
            pptxSlide.background = { data: background.image.src }
          }
          else {
            pptxSlide.background = { path: background.image.src }
          }
        }
        else if (background.type === 'solid' && background.color) {
          const c = formatColor(background.color)
          pptxSlide.background = { color: toPptxHex(c.color), transparency: (1 - c.alpha) * 100 }
        }
        else if (background.type === 'gradient' && background.gradient) {
          const colors = background.gradient.colors
          const color1 = colors[0].color
          const color2 = colors[colors.length - 1].color
          const color = tinycolor.mix(color1, color2).toHexString()
          const c = formatColor(color)
          pptxSlide.background = { color: toPptxHex(c.color), transparency: (1 - c.alpha) * 100 }
        }
      }
      if (slide.remark) {
        const doc = new DOMParser().parseFromString(slide.remark, 'text/html')
        const pList = doc.body.querySelectorAll('p')
        const text = []
        for (const p of pList) {
          const textContent = p.textContent
          text.push(sanitizePptxText(textContent || ''))
        }
        pptxSlide.addNotes(text.join('\n'))
      }

      if (!slide.elements) continue

      for (const el of slide.elements) {
        if (el.type === 'text') {
          const textProps = formatHTML(el.content)

          const elementOpacityRaw = toFiniteNumber(el.opacity)
          const elementOpacity = elementOpacityRaw === null ? 1 : clampNumber(elementOpacityRaw, 0, 1)

          const options: pptxgen.TextPropsOptions = {
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: el.width / ratioPx2Inch.value,
            h: el.height / ratioPx2Inch.value,
            fontSize: defaultFontSize / ratioPx2Pt.value,
            fontFace: 'Arial',
            color: '000000',
            valign: 'top',
            margin: 10 / ratioPx2Pt.value,
            paraSpaceBefore: 5 / ratioPx2Pt.value,
            lineSpacingMultiple: 1.5 / 1.25,
            autoFit: true,
          }
          if (el.rotate) options.rotate = el.rotate
          if (el.wordSpace) {
            const ws = toFiniteNumber(el.wordSpace)
            if (ws !== null) options.charSpacing = clampNumber(ws / ratioPx2Pt.value, 0, 200)
          }
          if (el.lineHeight) {
            const lh = toFiniteNumber(el.lineHeight)
            if (lh !== null) options.lineSpacingMultiple = clampNumber(lh / 1.25, 0.5, 10)
          }
          if (el.fill) {
            const c = formatColor(el.fill)
            options.fill = { color: toPptxHex(c.color), transparency: clampNumber((1 - c.alpha * elementOpacity) * 100, 0, 100) }
          }
          if (el.defaultColor) options.color = toPptxHex(formatColor(el.defaultColor).color)
          if (el.defaultFontName) options.fontFace = sanitizeFontFace(el.defaultFontName)
          if (el.shadow) options.shadow = getShadowOption(el.shadow)
          if (el.outline?.width) options.line = getOutlineOption(el.outline)
          const transparency = toPptxTransparency(el.opacity)
          if (transparency !== null) options.transparency = transparency
          if (el.paragraphSpace !== undefined) {
            const ps = toFiniteNumber(el.paragraphSpace)
            if (ps !== null) options.paraSpaceBefore = ps / ratioPx2Pt.value
          }
          if (el.vertical) options.vert = 'eaVert'

          pptxSlide.addText(textProps, options)
        }

        else if (el.type === 'image') {
          const options: pptxgen.ImageProps = {
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: el.width / ratioPx2Inch.value,
            h: el.height / ratioPx2Inch.value,
          }
          if (isBase64Image(el.src)) options.data = el.src
          else options.path = el.src

          if (el.flipH) options.flipH = el.flipH
          if (el.flipV) options.flipV = el.flipV
          if (el.rotate) options.rotate = el.rotate
          if (el.link) {
            const linkOption = getLinkOption(el.link)
            if (linkOption) options.hyperlink = linkOption
          }
          if (el.filters?.opacity) {
            const opacity = toFiniteNumber(parseInt(el.filters.opacity))
            if (opacity !== null) options.transparency = clampNumber(100 - opacity, 0, 100)
          }
          if (el.clip) {
            if (el.clip.shape === 'ellipse') options.rounding = true

            const [start, end] = el.clip.range
            const [startX, startY] = start
            const [endX, endY] = end

            const cropW = (endX - startX) / ratioPx2Inch.value
            const cropH = (endY - startY) / ratioPx2Inch.value
            if (!(cropW > 0 && cropH > 0)) {
              pptxSlide.addImage(options)
              continue
            }

            const originW = el.width / cropW
            const originH = el.height / cropH
            if (!(Number.isFinite(originW) && Number.isFinite(originH) && originW > 0 && originH > 0)) {
              pptxSlide.addImage(options)
              continue
            }

            options.w = originW / ratioPx2Inch.value
            options.h = originH / ratioPx2Inch.value

            options.sizing = {
              type: 'crop',
              x: startX / ratioPx2Inch.value * originW / ratioPx2Inch.value,
              y: startY / ratioPx2Inch.value * originH / ratioPx2Inch.value,
              w: (endX - startX) / ratioPx2Inch.value * originW / ratioPx2Inch.value,
              h: (endY - startY) / ratioPx2Inch.value * originH / ratioPx2Inch.value,
            }
          }

          pptxSlide.addImage(options)
        }

        else if (el.type === 'shape') {
          if (el.special) {
            const svgRef = document.querySelector(`.thumbnail-list .base-element-${el.id} svg`) as HTMLElement
            if (svgRef.clientWidth < 1 || svgRef.clientHeight < 1) continue // 临时处理（导入PPTX文件带来的异常数据）
            let imgData: string | null = null
            try {
              imgData = await svgElementToPngDataUrl(svgRef)
            } catch {
              imgData = svg2Base64(svgRef)
            }

            const options: pptxgen.ImageProps = {
              data: imgData,
              x: el.left / ratioPx2Inch.value,
              y: el.top / ratioPx2Inch.value,
              w: el.width / ratioPx2Inch.value,
              h: el.height / ratioPx2Inch.value,
            }
            if (el.rotate) options.rotate = el.rotate
            if (el.flipH) options.flipH = el.flipH
            if (el.flipV) options.flipV = el.flipV
            if (el.link) {
              const linkOption = getLinkOption(el.link)
              if (linkOption) options.hyperlink = linkOption
            }

            pptxSlide.addImage(options)
          }
          else {
            const scale = {
              x: el.width / el.viewBox[0],
              y: el.height / el.viewBox[1],
            }
            const points = formatPoints(toPoints(el.path), scale)

            let fillColor = formatColor(el.fill)
            if (el.gradient) {
              const colors = el.gradient.colors
              const color1 = colors[0].color
              const color2 = colors[colors.length - 1].color
              const color = tinycolor.mix(color1, color2).toHexString()
              fillColor = formatColor(color)
            }
            if (el.pattern) fillColor = formatColor('#00000000')
            const opacityRaw = toFiniteNumber(el.opacity)
            const opacity = opacityRaw === null ? 1 : clampNumber(opacityRaw, 0, 1)

            const options: pptxgen.ShapeProps = {
              x: el.left / ratioPx2Inch.value,
              y: el.top / ratioPx2Inch.value,
              w: el.width / ratioPx2Inch.value,
              h: el.height / ratioPx2Inch.value,
              fill: { color: toPptxHex(fillColor.color), transparency: clampNumber((1 - fillColor.alpha * opacity) * 100, 0, 100) },
              points,
            }
            if (el.flipH) options.flipH = el.flipH
            if (el.flipV) options.flipV = el.flipV
            if (el.shadow) options.shadow = getShadowOption(el.shadow)
            if (el.outline?.width) options.line = getOutlineOption(el.outline)
            if (el.rotate) options.rotate = el.rotate
            if (el.link) {
              const linkOption = getLinkOption(el.link)
              if (linkOption) options.hyperlink = linkOption
            }

            pptxSlide.addShape('custGeom' as pptxgen.ShapeType, options)
          }
          if (el.text) {
            const textProps = formatHTML(el.text.content)

            const options: pptxgen.TextPropsOptions = {
              x: el.left / ratioPx2Inch.value,
              y: el.top / ratioPx2Inch.value,
              w: el.width / ratioPx2Inch.value,
              h: el.height / ratioPx2Inch.value,
              fontSize: defaultFontSize / ratioPx2Pt.value,
              fontFace: 'Arial',
              color: '000000',
              paraSpaceBefore: 5 / ratioPx2Pt.value,
              valign: toPptxVAlign(el.text.align),
            }
            if (el.rotate) options.rotate = el.rotate
            if (el.text.defaultColor) options.color = toPptxHex(formatColor(el.text.defaultColor).color)
            if (el.text.defaultFontName) options.fontFace = sanitizeFontFace(el.text.defaultFontName)

            pptxSlide.addText(textProps, options)
          }
          if (el.pattern) {
            const options: pptxgen.ImageProps = {
              x: el.left / ratioPx2Inch.value,
              y: el.top / ratioPx2Inch.value,
              w: el.width / ratioPx2Inch.value,
              h: el.height / ratioPx2Inch.value,
            }
            if (isBase64Image(el.pattern)) options.data = el.pattern
            else options.path = el.pattern

            if (el.flipH) options.flipH = el.flipH
            if (el.flipV) options.flipV = el.flipV
            if (el.rotate) options.rotate = el.rotate
            if (el.link) {
              const linkOption = getLinkOption(el.link)
              if (linkOption) options.hyperlink = linkOption
            }

            pptxSlide.addImage(options)
          }
        }

        else if (el.type === 'line') {
          const path = getLineElementPath(el)
          const points = formatPoints(toPoints(path))
          const { minX, maxX, minY, maxY } = getElementRange(el)
          const c = formatColor(el.color)

          const options: pptxgen.ShapeProps = {
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: (maxX - minX) / ratioPx2Inch.value,
            h: (maxY - minY) / ratioPx2Inch.value,
            line: {
              color: toPptxHex(c.color),
              transparency: (1 - c.alpha) * 100,
              width: el.width / ratioPx2Pt.value,
              dashType: dashTypeMap[el.style] as 'solid' | 'dash' | 'sysDot',
              beginArrowType: el.points[0] ? 'arrow' : 'none',
              endArrowType: el.points[1] ? 'arrow' : 'none',
            },
            points,
          }
          if (el.shadow) options.shadow = getShadowOption(el.shadow)

          pptxSlide.addShape('custGeom' as pptxgen.ShapeType, options)
        }

        else if (el.type === 'chart') {
          const patch = addChartElementToSlide({
            pptx,
            pptxSlide,
            el,
            ratioPx2Inch: ratioPx2Inch.value,
            ratioPx2Pt: ratioPx2Pt.value,
            formatColor,
          })

          if (patch) {
            chartId += 1
            chartItems.push({
              chartId,
              chartType: el.chartType,
              options: el.options,
              patch,
            })
          }
        }

        else if (el.type === 'table') {
          const hiddenCells = []
          for (let i = 0; i < el.data.length; i++) {
            const rowData = el.data[i]

            for (let j = 0; j < rowData.length; j++) {
              const cell = rowData[j]
              if (cell.colspan > 1 || cell.rowspan > 1) {
                for (let row = i; row < i + cell.rowspan; row++) {
                  for (let col = row === i ? j + 1 : j; col < j + cell.colspan; col++) hiddenCells.push(`${row}_${col}`)
                }
              }
            }
          }

          const tableData = []

          const theme = el.theme
          let themeColor: FormatColor | null = null
          let subThemeColors: FormatColor[] = []
          if (theme) {
            themeColor = formatColor(theme.color)
            subThemeColors = getTableSubThemeColor(theme.color).map(item => formatColor(item))
          }

          for (let i = 0; i < el.data.length; i++) {
            const row = el.data[i]
            const _row = []

            for (let j = 0; j < row.length; j++) {
              const cell = row[j]
              const cellOptions: pptxgen.TableCellProps = {
                colspan: Math.max(1, Math.floor(toFiniteNumber(cell.colspan) ?? 1)),
                rowspan: Math.max(1, Math.floor(toFiniteNumber(cell.rowspan) ?? 1)),
                bold: cell.style?.bold || false,
                italic: cell.style?.em || false,
                underline: { style: cell.style?.underline ? 'sng' : 'none' },
                align: toPptxHAlign(cell.style?.align || 'left'),
                valign: toPptxVAlign('middle'),
                fontFace: sanitizeFontFace(cell.style?.fontname || 'Arial'),
                fontSize: (toFiniteNumber(cell.style?.fontsize ? parseInt(cell.style?.fontsize) : 14) ?? 14) / ratioPx2Pt.value,
              }
              if (theme && themeColor) {
                let c: FormatColor
                if (i % 2 === 0) c = subThemeColors[1]
                else c = subThemeColors[0]

                if (theme.rowHeader && i === 0) c = themeColor
                else if (theme.rowFooter && i === el.data.length - 1) c = themeColor
                else if (theme.colHeader && j === 0) c = themeColor
                else if (theme.colFooter && j === row.length - 1) c = themeColor

                cellOptions.fill = { color: toPptxHex(c.color), transparency: (1 - c.alpha) * 100 }
              }
              if (cell.style?.backcolor) {
                const c = formatColor(cell.style.backcolor)
                cellOptions.fill = { color: toPptxHex(c.color), transparency: (1 - c.alpha) * 100 }
              }
              if (cell.style?.color) cellOptions.color = toPptxHex(formatColor(cell.style.color).color)

              if (!hiddenCells.includes(`${i}_${j}`)) {
                _row.push({
                  text: sanitizePptxText(cell.text),
                  options: cellOptions,
                })
              }
            }
            if (_row.length) tableData.push(_row)
          }

          const options: pptxgen.TableProps = {
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: el.width / ratioPx2Inch.value,
            h: el.height / ratioPx2Inch.value,
            colW: el.colWidths.map(item => el.width * (toFiniteNumber(item) ?? 0) / ratioPx2Inch.value),
          }
          if (options.colW.some(w => !Number.isFinite(w) || w <= 0)) {
            const colCount = Math.max(1, el.colWidths.length)
            options.colW = Array.from({ length: colCount }, () => el.width / colCount / ratioPx2Inch.value)
          }
          if (el.theme) options.fill = { color: 'FFFFFF' }
          if (el.outline.width && el.outline.color) {
            options.border = {
              type: el.outline.style === 'solid' ? 'solid' : 'dash',
              pt: el.outline.width / ratioPx2Pt.value,
              color: toPptxHex(formatColor(el.outline.color).color),
            }
          }

          pptxSlide.addTable(tableData, options)
        }

        else if (el.type === 'latex') {
          const svgRef = document.querySelector(`.thumbnail-list .base-element-${el.id} svg`) as HTMLElement
          let imgData: string | null = null
          try {
            imgData = await svgElementToPngDataUrl(svgRef)
          } catch {
            imgData = svg2Base64(svgRef)
          }

          const options: pptxgen.ImageProps = {
            data: imgData,
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: el.width / ratioPx2Inch.value,
            h: el.height / ratioPx2Inch.value,
          }
          if (el.link) {
            const linkOption = getLinkOption(el.link)
            if (linkOption) options.hyperlink = linkOption
          }

          pptxSlide.addImage(options)
        }

        else if (!ignoreMedia && (el.type === 'video' || el.type === 'audio')) {
          const options: pptxgen.MediaProps = {
            x: el.left / ratioPx2Inch.value,
            y: el.top / ratioPx2Inch.value,
            w: el.width / ratioPx2Inch.value,
            h: el.height / ratioPx2Inch.value,
            path: el.src,
            type: el.type,
          }
          if (el.type === 'video' && el.poster) options.cover = el.poster

          const extMatch = el.src.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/)
          if (extMatch && extMatch[1]) options.extn = extMatch[1]
          else if (el.ext) options.extn = el.ext

          const videoExts = ['avi', 'mp4', 'm4v', 'mov', 'wmv']
          const audioExts = ['mp3', 'm4a', 'mp4', 'wav', 'wma']
          if (options.extn && [...videoExts, ...audioExts].includes(options.extn)) {
            pptxSlide.addMedia(options)
          }
        }
      }
    }

    return { pptx, chartItems }
  }

  const exportPPTX = (_slides: Slide[], masterOverwrite: boolean, ignoreMedia: boolean) => {
    exporting.value = true

    setTimeout(async () => {
      try {
        const { pptx, chartItems } = await buildPPTX(_slides, masterOverwrite, ignoreMedia)
        const fileName = `${title.value}.pptx`
        const blob = await (pptx as any).write('blob')

        let outBlob = blob as Blob
        try {
          outBlob = await postprocessPptxCharts(outBlob, chartItems)
        }
        catch (postprocessErr) {
          console.error(postprocessErr)
        }

        saveAs(outBlob, fileName)
      }
      catch (err) {
        console.error(err)
        message.error('Export Failed')
      }
      finally {
        exporting.value = false
      }
    }, 200)
  }

  return {
    exporting,
    exportImage,
    exportImagePPTX,
    exportJSON,
    exportSpecificFile,
    exportPPTX,
  }
}
