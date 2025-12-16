<template>
  <div class="chart" ref="chartRef"></div>
</template>

<script lang="ts" setup>
import { onMounted, useTemplateRef, computed, watch, onBeforeUnmount } from 'vue'
import tinycolor from 'tinycolor2'
import type { ChartData, ChartOptions, ChartType } from '@/types/slides'
import { getChartOption } from './chartOption'
import emitter, { EmitterEvents } from '@/utils/emitter'

import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, RadarChart } from 'echarts/charts'
import { LegendComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  LegendComponent,
  SVGRenderer,
])

const props = defineProps<{
  elementId?: string
  width: number
  height: number
  type: ChartType
  data: ChartData
  themeColors: string[]
  textColor?: string
  lineColor?: string
  options?: ChartOptions
  optionRaw?: any
}>()

let chart: echarts.ECharts | null = null
const chartRef = useTemplateRef<HTMLElement>('chartRef')

const themeColors = computed(() => {
  let colors: string[] = []
  if (props.themeColors.length >= 10) colors = props.themeColors
  else if (props.themeColors.length === 1) colors = tinycolor(props.themeColors[0]).analogous(10).map(color => color.toRgbString())
  else {
    const len = props.themeColors.length
    const supplement = tinycolor(props.themeColors[len - 1]).analogous(10 + 1 - len).map(color => color.toRgbString())
    colors = [...props.themeColors.slice(0, len - 1), ...supplement]
  }
  return colors
})

const BASE_CHART_SIZE = 400

let lastFontScale = 1

const getFontScale = () => {
  const minSide = Math.max(1, Math.min(props.width || BASE_CHART_SIZE, props.height || BASE_CHART_SIZE))
  const rawScale = minSide / BASE_CHART_SIZE
  const clamped = Math.min(1, rawScale) // shrink only (do not scale up)
  return Math.round(clamped * 100) / 100
}

const cloneWithScaledFontSize = (node: any, scale: number): any => {
  if (!node || scale === 1) return node
  if (typeof node === 'function') return node
  if (Array.isArray(node)) return node.map(v => cloneWithScaledFontSize(v, scale))
  if (typeof node === 'object') {
    const out: any = {}
    for (const key in node) {
      const val = (node as any)[key]
      if (key === 'fontSize' && typeof val === 'number') {
        out[key] = Math.max(6, Math.round(val * scale))
      }
      else {
        out[key] = cloneWithScaledFontSize(val, scale)
      }
    }
    return out
  }
  return node
}

const updateOption = () => {
  const scale = getFontScale()
  lastFontScale = scale

  if (props.optionRaw) {
    const option = scale === 1 ? props.optionRaw : cloneWithScaledFontSize(props.optionRaw, scale)
    chart!.setOption(option, true)
    chart!.resize()
    return
  }

  const option = getChartOption({
    type: props.type,
    data: props.data,
    themeColors: themeColors.value,
    textColor: props.textColor,
    lineColor: props.lineColor,
    lineSmooth: props.options?.lineSmooth || false,
    stack: props.options?.stack || false,
    seriesTypes: props.options?.seriesTypes,
    pointSizes: props.options?.pointSizes,
    // Phase 1: New features
    yAxisIndexes: props.options?.yAxisIndexes,
    showDataLabels: props.options?.showDataLabels,
    dataLabelPosition: props.options?.dataLabelPosition,
    percentStack: props.options?.percentStack,
    // Phase 2: Axis & Legend config
    axisTitle: props.options?.axisTitle,
    axisRange: props.options?.axisRange,
    legendPosition: props.options?.legendPosition,
  })
  if (!option) return

  const scaledOption = scale === 1 ? option : cloneWithScaledFontSize(option, scale)
  chart!.setOption(scaledOption, true)
  chart!.resize()
}

onMounted(() => {
  chart = echarts.init(chartRef.value, null, { renderer: 'svg' })
  updateOption()

  const handleClick = (params: any) => {
    emitter.emit(EmitterEvents.CHART_POINT_CLICK, {
      elementId: props.elementId,
      seriesIndex: params?.seriesIndex,
      dataIndex: params?.dataIndex,
      name: params?.name,
      value: params?.value,
      componentType: params?.componentType,
      componentIndex: params?.componentIndex,
    })
  }
  
  const handleDblClick = (params: any) => {
    // Determine target tab based on clicked component
    let targetTab = 'data'
    if (params.componentType === 'series') targetTab = 'series'
    else if (params.componentType === 'legend') targetTab = 'legend'
    else if (params.componentType === 'xAxis' || params.componentType === 'yAxis') targetTab = 'axes'
    else if (params.componentType === 'title') targetTab = 'axes' // Axis titles usually in axes tab
    
    emitter.emit(EmitterEvents.CHART_DBL_CLICK, {
      elementId: props.elementId,
      targetTab,
    })
  }

  chart.on('click', handleClick)
  chart.getZr().on('dblclick', (e: any) => {
    // Check if clicked on empty area (no target) -> Theme tab
    if (!e.target) {
      emitter.emit(EmitterEvents.CHART_DBL_CLICK, {
        elementId: props.elementId,
        targetTab: 'theme',
      })
    }
    // If clicked on specific component (handled by echarts events, but dblclick needs manual check sometimes)
    // For now, rely on chart.on('dblclick') for components
  })
  chart.on('dblclick', handleDblClick)

  const resizeListener = () => chart!.resize()
  const resizeObserver = new ResizeObserver(resizeListener)
  resizeObserver.observe(chartRef.value!)

  onBeforeUnmount(() => {
    resizeObserver.disconnect()
    if (chart) {
      chart.off('click', handleClick)
      chart.dispose()
      chart = null
    }
  })
})

watch(() => props.type, updateOption)
watch(() => props.data, updateOption)
watch(() => props.themeColors, updateOption)
watch(() => props.textColor, updateOption)
watch(() => props.lineColor, updateOption)
watch(() => props.options, updateOption, { deep: true })
watch(() => props.optionRaw, updateOption)

// Resize: shrink font sizes when the element becomes too small
watch(
  () => [props.width, props.height],
  () => {
    const nextScale = getFontScale()
    if (nextScale === lastFontScale) {
      chart?.resize()
      return
    }
    updateOption()
  },
)
</script>

<style lang="scss" scoped>
.chart {
  width: 100%;
  height: 100%;
}
</style>
