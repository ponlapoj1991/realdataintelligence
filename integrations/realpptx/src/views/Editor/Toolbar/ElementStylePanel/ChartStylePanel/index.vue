<template>
  <div class="chart-style-panel">
    <div class="panel-selector">
      <template v-for="tab in tabOptions" :key="tab.key">
        <div
          v-if="isTabVisible(tab.key)"
          class="tab-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key as ChartTabKey"
          v-tooltip="tab.label"
        >
          <component :is="tab.icon" />
        </div>
      </template>
    </div>

    <!-- Data -->
    <div v-if="activeTab === 'data'">
      <Button class="full-width-btn" @click="chartDataEditorVisible = true">
        <IconEdit /> Edit Chart
      </Button>
    </div>

    <!-- Series & Colors -->
    <div v-else-if="activeTab === 'series'">
      <template v-if="['bar', 'column', 'area', 'line', 'combo'].includes(handleChartElement.chartType)">
        <div class="section-title">Series & Stacking</div>
        <div class="row-grid">
          <Checkbox :value="stack" @update:value="v => updateOptions({ stack: v })">Stack</Checkbox>
          <Checkbox v-if="['bar','column','area','line','combo'].includes(handleChartElement.chartType)" :value="!!percentStack" @update:value="v => updateOptions({ percentStack: v })">Percent Stack</Checkbox>
          <Checkbox v-if="['line','area','combo'].includes(handleChartElement.chartType)" :value="lineSmooth" @update:value="v => updateOptions({ lineSmooth: v })">Smooth Line</Checkbox>
        </div>
        <div class="row" v-if="['bar','column'].includes(handleChartElement.chartType)">
          <div class="label">Orientation</div>
          <select class="input" v-model="orientationLocal" @change="updateOptions({ orientation: orientationLocal })">
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
        </div>
        <div class="row" v-if="['bar','column'].includes(handleChartElement.chartType)">
          <div class="label">Bar Width (px)</div>
          <input class="input" type="number" min="1" v-model.number="barWidthLocal" @change="updateOptions({ barWidth: barWidthLocal })" />
        </div>
        <div class="row" v-if="['bar','column'].includes(handleChartElement.chartType)">
          <div class="label">Category Gap (%)</div>
          <input class="input" type="text" placeholder="Default 20%" v-model="barCategoryGapLocal" @change="updateOptions({ barCategoryGap: barCategoryGapLocal })" />
        </div>
        <Divider />
      </template>

      <template v-if="handleChartElement.chartType === 'combo'">
        <div class="section-title">Combo: Series Type & Axis Mapping</div>
        <div class="combo-table">
          <div class="combo-row combo-header">
            <div class="combo-cell">Series</div>
            <div class="combo-cell">Type</div>
            <div class="combo-cell">Y Axis</div>
          </div>
          <div class="combo-row" v-for="(legend, idx) in handleChartElement.data.legends" :key="legend">
            <div class="combo-cell">{{ legend }}</div>
            <div class="combo-cell">
              <select class="input" v-model="seriesTypesLocal[idx]" @change="setSeriesType(idx, seriesTypesLocal[idx])">
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
              </select>
            </div>
            <div class="combo-cell">
              <select class="input" v-model.number="yAxisIndexesLocal[idx]" @change="setYAxisIndex(idx, yAxisIndexesLocal[idx])">
                <option :value="0">Left</option>
                <option :value="1">Right</option>
              </select>
            </div>
          </div>
        </div>
      </template>

      <Divider />

      <div class="section-title">Series Colors</div>
      <div class="table">
        <div class="table-row table-header">
          <div class="table-cell">Series</div>
          <div class="table-cell">Color</div>
        </div>
        <div
          class="table-row"
          v-for="(legend, idx) in handleChartElement.data.legends"
          :key="legend"
          :class="{ selected: selectedSeriesIndex === idx }"
          @click="selectedSeriesIndex = idx"
        >
          <div class="table-cell">{{ legend }}</div>
          <div class="table-cell">
            <Popover trigger="click" class="w-60">
              <template #content>
                <ColorPicker
                  :modelValue="seriesColorsLocal[idx]"
                  @update:modelValue="v => setSeriesColor(idx, v)"
                />
              </template>
              <ColorButton :color="seriesColorsLocal[idx] || themeColors[idx % themeColors.length]" />
            </Popover>
          </div>
        </div>
      </div>

      <template v-if="handleChartElement.data.series.length === 1">
        <Divider />
        <div class="section-title">Data Colors (by category)</div>
        <div class="table">
          <div class="table-row table-header">
            <div class="table-cell">Label</div>
            <div class="table-cell">Color</div>
          </div>
          <div
            class="table-row"
            v-for="(label, idx) in handleChartElement.data.labels"
            :key="label + idx"
            :class="{ selected: selectedDataIndex === idx }"
            @click="selectedDataIndex = idx"
          >
            <div class="table-cell">{{ label }}</div>
            <div class="table-cell">
              <Popover trigger="click" class="w-60">
                <template #content>
                  <ColorPicker
                    :modelValue="dataColorsLocal[idx]"
                    @update:modelValue="v => setDataColor(idx, v)"
                  />
                </template>
                <ColorButton :color="dataColorsLocal[idx] || themeColors[idx % themeColors.length]" />
              </Popover>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Labels -->
    <div v-else-if="activeTab === 'labels'">
      <div class="section-title">Data Labels</div>
      <div class="row">
        <Checkbox :value="showDataLabels" @update:value="v => updateOptions({ showDataLabels: v })">Show labels</Checkbox>
      </div>
      <div class="row">
        <div class="label">Position</div>
        <select class="input" v-model="dataLabelPosition" @change="updateOptions({ dataLabelPosition })">
          <option value="top">Top</option>
          <option value="inside">Inside</option>
          <option value="outside">Outside</option>
          <option value="center">Center</option>
        </select>
      </div>
      <div class="row">
        <div class="label">Font size</div>
        <input class="input" type="number" min="8" max="32" v-model.number="dataLabelFontSize" @change="updateOptions({ dataLabelFontSize })" />
      </div>
      <div class="row">
        <div class="label">Font weight</div>
        <select class="input" v-model="dataLabelFontWeight" @change="updateOptions({ dataLabelFontWeight })">
          <option value="normal">Normal</option>
          <option value="bold">Bold</option>
        </select>
      </div>
      <div class="row">
        <div class="label">Color</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="dataLabelColor" @update:modelValue="v => { dataLabelColor = v; updateOptions({ dataLabelColor: v }) }" />
          </template>
          <ColorButton :color="dataLabelColor || textColor || '#333'" />
        </Popover>
      </div>
      <div class="row">
        <Checkbox :value="!!dataLabelShowPercent" @update:value="v => updateOptions({ dataLabelShowPercent: v })">Show percent</Checkbox>
      </div>
      <div class="row" v-if="dataLabelShowPercent">
        <div class="label" style="margin-left: 24px;">Decimals</div>
        <input class="input" style="width: 60px;" type="number" min="0" max="4" v-model.number="dataLabelPercentDecimals" @change="updateOptions({ dataLabelPercentDecimals })" />
      </div>
    </div>

    <!-- Legend & Layout -->
    <div v-else-if="activeTab === 'legend'">
      <div class="section-title">Legend</div>
      <div class="row">
        <Checkbox :value="legendEnabled" @update:value="v => setLegendEnabled(v)">Show legend</Checkbox>
      </div>
      <div class="row">
        <div class="label">Position</div>
        <select class="input" v-model="legendPosition" @change="updateOptions({ legendPosition })">
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </div>
      <div class="row">
        <div class="label">Align</div>
        <select class="input" v-model="legendAlign" @change="updateOptions({ legendAlign })">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      <div class="row">
        <div class="label">Font size</div>
        <input class="input" type="number" min="1" max="24" v-model.number="legendFontSize" @change="updateOptions({ legendFontSize })" />
      </div>
      <div class="row">
        <div class="label">Color</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="legendFontColor" @update:modelValue="v => { legendFontColor = v; updateOptions({ legendFontColor: v }) }" />
          </template>
          <ColorButton :color="legendFontColor || textColor || '#333'" />
        </Popover>
      </div>
    </div>

    <!-- Axes -->
    <div v-else-if="activeTab === 'axes'">
      <div class="section-title">Axis</div>
      <div class="row">
        <div class="label">X title</div>
        <input class="input" type="text" v-model="axisTitleX" @change="updateAxisTitle('x', axisTitleX)" />
      </div>
      <div class="row">
        <div class="label">Y title (left)</div>
        <input class="input" type="text" v-model="axisTitleYLeft" @change="updateAxisTitle('yLeft', axisTitleYLeft)" />
      </div>
      <div class="row">
        <div class="label">Y title (right)</div>
        <input class="input" type="text" v-model="axisTitleYRight" @change="updateAxisTitle('yRight', axisTitleYRight)" />
      </div>
      <div class="row axis-range">
        <div class="axis-range-group">
          <div class="label small">X min</div>
          <input class="input small" type="number" v-model.number="axisRangeXMin" @change="updateAxisRange()" />
        </div>
        <div class="axis-range-group">
          <div class="label small">X max</div>
          <input class="input small" type="number" v-model.number="axisRangeXMax" @change="updateAxisRange()" />
        </div>
      </div>
      <div class="row axis-range">
        <div class="axis-range-group">
          <div class="label small">Y left min</div>
          <input class="input small" type="number" v-model.number="axisRangeYLeftMin" @change="updateAxisRange()" />
        </div>
        <div class="axis-range-group">
          <div class="label small">Y left max</div>
          <input class="input small" type="number" v-model.number="axisRangeYLeftMax" @change="updateAxisRange()" />
        </div>
      </div>
      <div class="row axis-range">
        <div class="axis-range-group">
          <div class="label small">Y right min</div>
          <input class="input small" type="number" v-model.number="axisRangeYRightMin" @change="updateAxisRange()" />
        </div>
        <div class="axis-range-group">
          <div class="label small">Y right max</div>
          <input class="input small" type="number" v-model.number="axisRangeYRightMax" @change="updateAxisRange()" />
        </div>
      </div>
      <div class="row">
        <div class="label">Label font size</div>
        <input class="input" type="number" min="8" max="24" v-model.number="axisLabelFontSize" @change="updateOptions({ axisLabelFontSize })" />
      </div>
      <div class="row">
        <div class="label">Label color</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="axisLabelColor" @update:modelValue="v => { axisLabelColor = v; updateOptions({ axisLabelColor: v }) }" />
          </template>
          <ColorButton :color="axisLabelColor || textColor || '#333'" />
        </Popover>
      </div>
      <div class="row">
        <div class="label">Label angle</div>
        <select class="input" v-model.number="axisLabelSlant" @change="updateOptions({ axisLabelSlant })">
          <option :value="0">0°</option>
          <option :value="45">45°</option>
          <option :value="90">90°</option>
        </select>
      </div>
      <div class="row">
        <Checkbox :value="!!axisGridShow" @update:value="v => updateOptions({ axisGridShow: v })">Show grid</Checkbox>
      </div>
      <div class="row">
        <div class="label">Grid color</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="axisGridColor" @update:modelValue="v => { axisGridColor = v; updateOptions({ axisGridColor: v }) }" />
          </template>
          <ColorButton :color="axisGridColor || lineColor || '#e8ecf4'" />
        </Popover>
      </div>
    </div>

    <!-- Type-specific -->
    <div v-else-if="activeTab === 'typeSpecific'">
      <template v-if="handleChartElement.chartType === 'scatter'">
        <div class="section-title">Scatter</div>
        <div class="row">
          <div class="label">Default point size</div>
          <input class="input" type="number" min="4" max="32" v-model.number="scatterPointSize" @change="applyScatterSize()" />
        </div>
        <Divider />
      </template>

      <template v-if="['pie','ring'].includes(handleChartElement.chartType)">
        <div class="section-title">Pie / Donut</div>
        <div class="row">
          <div class="label">Inner radius (%)</div>
          <input class="input" type="number" min="0" max="90" v-model.number="pieInnerRadius" @change="updateOptions({ pieInnerRadius })" />
        </div>
        <div class="row">
          <div class="label">Start angle (°)</div>
          <input class="input" type="number" min="-360" max="360" v-model.number="pieStartAngle" @change="updateOptions({ pieStartAngle })" />
        </div>
        <Divider />
      </template>
    </div>

    <!-- Theme & Background -->
    <div v-else-if="activeTab === 'theme'">
      <div class="row">
        <div class="label">Background fill:</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="fill" @update:modelValue="v => updateElement({ fill: v })" />
          </template>
          <ColorButton :color="fill" />
        </Popover>
      </div>
      <div class="row">
        <div class="label">Text & axes:</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="textColor" @update:modelValue="v => updateElement({ textColor: v })" />
          </template>
          <ColorButton :color="textColor" />
        </Popover>
      </div>
      <div class="row">
        <div class="label">Grid color:</div>
        <Popover trigger="click" class="w-60">
          <template #content>
            <ColorPicker :modelValue="lineColor" @update:modelValue="v => updateElement({ lineColor: v })" />
          </template>
          <ColorButton :color="lineColor" />
        </Popover>
      </div>

      <div class="row">
        <div class="label">Theme colors:</div>
        <Popover trigger="click" v-model:value="themesVisible" class="w-60">
          <template #content>
            <div class="themes">
              <div class="label small">Preset chart themes:</div>
              <div class="preset-themes">
                <div class="preset-theme" v-for="(item, index) in CHART_PRESET_THEMES" :key="index" @click="setThemeColors(item)">
                  <div class="preset-theme-color" v-for="color in item" :key="color" :style="{ backgroundColor: color }"></div>
                </div>
              </div>
              <div class="label small">Slide theme:</div>
              <div class="preset-themes" :style="{ marginBottom: '-10px' }">
                <div class="preset-theme" @click="setThemeColors(theme.themeColors)">
                  <div class="preset-theme-color" v-for="color in theme.themeColors" :key="color" :style="{ backgroundColor: color }"></div>
                </div>
              </div>
              <Divider :margin="10" />
              <Button class="full-width-btn" @click="themesVisible = false; themeColorsSettingVisible = true">Custom colors</Button>
            </div>
          </template>
          <ColorListButton :colors="themeColors" />
        </Popover>
      </div>

      <Divider />

      <ElementOutline />
    </div>

    <Modal v-model:visible="chartDataEditorVisible" :width="900">
      <ChartDataEditor
        :type="handleChartElement.chartType"
        :data="handleChartElement.data"
        @close="chartDataEditorVisible = false"
        @save="value => updateData(value)"
      />
    </Modal>

    <Modal v-model:visible="themeColorsSettingVisible" :width="310" @closed="themeColorsSettingVisible = false">
      <ThemeColorsSetting :colors="themeColors" @update="colors => setThemeColors(colors)" />
    </Modal>
  </div>
</template>

<script lang="ts" setup>
import { onUnmounted, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import type { ChartData, ChartOptions, ChartType, PPTChartElement } from '@/types/slides'
import emitter, { EmitterEvents } from '@/utils/emitter'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import { CHART_PRESET_THEMES } from '@/configs/chart'

import ElementOutline from '../../common/ElementOutline.vue'
import ChartDataEditor from './ChartDataEditor.vue'
import ThemeColorsSetting from './ThemeColorsSetting.vue'
import ColorButton from '@/components/ColorButton.vue'
import ColorListButton from '@/components/ColorListButton.vue'
import ColorPicker from '@/components/ColorPicker/index.vue'
import Modal from '@/components/Modal.vue'
import Divider from '@/components/Divider.vue'
import Checkbox from '@/components/Checkbox.vue'
import Button from '@/components/Button.vue'
import Popover from '@/components/Popover.vue'

type ChartTabKey = 'data' | 'series' | 'labels' | 'legend' | 'axes' | 'typeSpecific' | 'theme'

const tabOptions = [
  { label: 'Data', key: 'data', icon: 'IconEdit' },
  { label: 'Series', key: 'series', icon: 'IconPlatte' },
  { label: 'Labels', key: 'labels', icon: 'IconText' },
  { label: 'Legend', key: 'legend', icon: 'IconList' },
  { label: 'Axes', key: 'axes', icon: 'IconChartProportion' },
  { label: 'Specific', key: 'typeSpecific', icon: 'IconMagic' },
  { label: 'Theme', key: 'theme', icon: 'IconTheme' },
]

const activeTab = ref<ChartTabKey>('data')

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const { handleElement, handleElementId } = storeToRefs(mainStore)
const { theme } = storeToRefs(slidesStore)

const handleChartElement = handleElement as Ref<PPTChartElement>

const chartDataEditorVisible = ref(false)
const themesVisible = ref(false)
const themeColorsSettingVisible = ref(false)

const { addHistorySnapshot } = useHistorySnapshot()

const fill = ref<string>('#000')
const themeColors = ref<string[]>([])
const textColor = ref('')
const lineColor = ref('')

// Series / stack / layout
const lineSmooth = ref(false)
const stack = ref(false)
const percentStack = ref<boolean | undefined>(undefined)
const orientationLocal = ref<'vertical' | 'horizontal'>('vertical')
const barWidthLocal = ref<number | undefined>(undefined)
const barCategoryGapLocal = ref<string | undefined>(undefined)

// Labels
const showDataLabels = ref(true)
const dataLabelPosition = ref<ChartOptions['dataLabelPosition']>('top')
const dataLabelFontSize = ref<number | undefined>(undefined)
const dataLabelFontWeight = ref<ChartOptions['dataLabelFontWeight']>('normal')
const dataLabelColor = ref<string | undefined>(undefined)
const dataLabelShowPercent = ref<boolean | undefined>(undefined)
const dataLabelPercentDecimals = ref<number | undefined>(undefined)

const selectedSeriesIndex = ref<number | null>(null)
const selectedDataIndex = ref<number | null>(null)
const seriesColorsLocal = ref<string[]>([])
const dataColorsLocal = ref<string[]>([])

// Legend
const legendEnabled = ref(true)
const legendPosition = ref<ChartOptions['legendPosition']>('bottom')
const legendAlign = ref<ChartOptions['legendAlign']>('left')
const legendFontSize = ref<number | undefined>(undefined)
const legendFontColor = ref<string | undefined>(undefined)

// Axis label style
const axisLabelFontSize = ref<number | undefined>(undefined)
const axisLabelColor = ref<string | undefined>(undefined)
const axisLabelSlant = ref<ChartOptions['axisLabelSlant']>(0)
const axisGridShow = ref<boolean | undefined>(undefined)
const axisGridColor = ref<string | undefined>(undefined)

// Axis titles and ranges
const axisTitleX = ref<string | undefined>(undefined)
const axisTitleYLeft = ref<string | undefined>(undefined)
const axisTitleYRight = ref<string | undefined>(undefined)
const axisRangeXMin = ref<number | undefined>(undefined)
const axisRangeXMax = ref<number | undefined>(undefined)
const axisRangeYLeftMin = ref<number | undefined>(undefined)
const axisRangeYLeftMax = ref<number | undefined>(undefined)
const axisRangeYRightMin = ref<number | undefined>(undefined)
const axisRangeYRightMax = ref<number | undefined>(undefined)

// Combo
const seriesTypesLocal = ref<('bar' | 'line' | 'area')[]>([])
const yAxisIndexesLocal = ref<number[]>([])

// Scatter
const pointSizesLocal = ref<number[]>([])
const scatterPointSize = ref<number>(12)

// Pie / Ring
const pieInnerRadius = ref<number | undefined>(undefined)
const pieStartAngle = ref<number | undefined>(undefined)

watch(handleElement, () => {
  if (!handleElement.value || handleElement.value.type !== 'chart') return
  const el = handleElement.value
  fill.value = el.fill || '#fff'

  // Base defaults
  lineSmooth.value = false
  stack.value = false
  percentStack.value = undefined
  orientationLocal.value = el.chartType === 'column' ? 'vertical' : el.chartType === 'bar' ? 'horizontal' : 'vertical'
  barWidthLocal.value = undefined
  barCategoryGapLocal.value = undefined

  showDataLabels.value = true
  dataLabelPosition.value = 'top'
  dataLabelFontSize.value = undefined
  dataLabelFontWeight.value = 'normal'
  dataLabelColor.value = undefined
  dataLabelShowPercent.value = undefined
  dataLabelPercentDecimals.value = undefined

  legendPosition.value = 'bottom'
  legendAlign.value = 'left'
  legendFontSize.value = undefined
  legendFontColor.value = undefined
  legendEnabled.value =
    (el.chartType === 'pie' || el.chartType === 'ring')
      ? el.data.labels.length > 1
      : el.data.series.length > 1

  axisLabelFontSize.value = undefined
  axisLabelColor.value = undefined
  axisLabelSlant.value = 0
  axisGridShow.value = undefined
  axisGridColor.value = undefined

  axisTitleX.value = undefined
  axisTitleYLeft.value = undefined
  axisTitleYRight.value = undefined
  axisRangeXMin.value = undefined
  axisRangeXMax.value = undefined
  axisRangeYLeftMin.value = undefined
  axisRangeYLeftMax.value = undefined
  axisRangeYRightMin.value = undefined
  axisRangeYRightMax.value = undefined

  seriesTypesLocal.value = el.data.series.map(() => 'bar')
  yAxisIndexesLocal.value = el.data.series.map(() => 0)
  pointSizesLocal.value = []
  scatterPointSize.value = 12

  pieInnerRadius.value = undefined
  pieStartAngle.value = undefined

  selectedSeriesIndex.value = null
  selectedDataIndex.value = null
  seriesColorsLocal.value = normalizeSeriesColors(el.data.seriesColors, el.data.legends.length)
  dataColorsLocal.value = normalizeDataColors(el.data.dataColors, el.data.labels.length)

  if (el.options) {
    const opts = el.options
    if (opts.lineSmooth !== undefined) lineSmooth.value = opts.lineSmooth
    if (opts.stack !== undefined) stack.value = opts.stack
    if (opts.percentStack !== undefined) percentStack.value = opts.percentStack
    if (opts.orientation) orientationLocal.value = opts.orientation
    if (opts.barWidth !== undefined) barWidthLocal.value = opts.barWidth
    if (opts.barCategoryGap !== undefined) barCategoryGapLocal.value = opts.barCategoryGap

    if (opts.showDataLabels !== undefined) showDataLabels.value = opts.showDataLabels
    if (opts.dataLabelPosition !== undefined) dataLabelPosition.value = opts.dataLabelPosition
    if (opts.dataLabelFontSize !== undefined) dataLabelFontSize.value = opts.dataLabelFontSize
    if (opts.dataLabelFontWeight !== undefined) dataLabelFontWeight.value = opts.dataLabelFontWeight
    if (opts.dataLabelColor !== undefined) dataLabelColor.value = opts.dataLabelColor
    if (opts.dataLabelShowPercent !== undefined) dataLabelShowPercent.value = opts.dataLabelShowPercent
    if (opts.dataLabelPercentDecimals !== undefined) dataLabelPercentDecimals.value = opts.dataLabelPercentDecimals

    if (opts.legendEnabled !== undefined) legendEnabled.value = opts.legendEnabled
    if (opts.legendPosition !== undefined) legendPosition.value = opts.legendPosition
    if (opts.legendAlign !== undefined) legendAlign.value = opts.legendAlign
    if (opts.legendFontSize !== undefined) legendFontSize.value = opts.legendFontSize
    if (opts.legendFontColor !== undefined) legendFontColor.value = opts.legendFontColor

    if (opts.axisLabelFontSize !== undefined) axisLabelFontSize.value = opts.axisLabelFontSize
    if (opts.axisLabelColor !== undefined) axisLabelColor.value = opts.axisLabelColor
    if (opts.axisLabelSlant !== undefined) axisLabelSlant.value = opts.axisLabelSlant
    if (opts.axisGridShow !== undefined) axisGridShow.value = opts.axisGridShow
    if (opts.axisGridColor !== undefined) axisGridColor.value = opts.axisGridColor

    if (opts.axisTitle) {
      axisTitleX.value = opts.axisTitle.x
      axisTitleYLeft.value = opts.axisTitle.yLeft
      axisTitleYRight.value = opts.axisTitle.yRight
    }
    if (opts.axisRange) {
      axisRangeXMin.value = opts.axisRange.xMin
      axisRangeXMax.value = opts.axisRange.xMax
      axisRangeYLeftMin.value = opts.axisRange.yLeftMin
      axisRangeYLeftMax.value = opts.axisRange.yLeftMax
      axisRangeYRightMin.value = opts.axisRange.yRightMin
      axisRangeYRightMax.value = opts.axisRange.yRightMax
    }

    if (opts.seriesTypes && opts.seriesTypes.length === el.data.series.length) {
      seriesTypesLocal.value = [...opts.seriesTypes]
    }
    else {
      seriesTypesLocal.value = el.data.series.map(() => 'bar')
    }
    if (opts.yAxisIndexes && opts.yAxisIndexes.length === el.data.series.length) {
      yAxisIndexesLocal.value = [...opts.yAxisIndexes]
    }
    else {
      yAxisIndexesLocal.value = el.data.series.map(() => 0)
    }

    if (opts.pointSizes) {
      pointSizesLocal.value = [...opts.pointSizes]
      if (opts.pointSizes.length > 0) scatterPointSize.value = opts.pointSizes[0]
    }

    if (opts.pieInnerRadius !== undefined) pieInnerRadius.value = opts.pieInnerRadius
    if (opts.pieStartAngle !== undefined) pieStartAngle.value = opts.pieStartAngle
  }

  themeColors.value = el.themeColors
  textColor.value = el.textColor || '#333'
  lineColor.value = el.lineColor || '#e8ecf4'
}, { deep: true, immediate: true })

const updateElement = (props: Partial<PPTChartElement>) => {
  slidesStore.updateElement({ id: handleElementId.value, props })
  addHistorySnapshot()
}

const updateOptions = (optionProps: ChartOptions) => {
  const current = handleChartElement.value.options || {}
  const newOptions = { ...current, ...optionProps }
  updateElement({ options: newOptions })
}

const updateData = (payload: { data: ChartData; type: ChartType }) => {
  chartDataEditorVisible.value = false
  updateElement({ data: payload.data, chartType: payload.type })
}

// Legend toggle
const setLegendEnabled = (v: boolean) => {
  legendEnabled.value = v
  updateOptions({ legendEnabled: v })
}

// Combo helpers
const setSeriesType = (index: number, value: 'bar' | 'line' | 'area') => {
  const arr = [...seriesTypesLocal.value]
  arr[index] = value
  seriesTypesLocal.value = arr
  updateOptions({ seriesTypes: arr })
}
const setYAxisIndex = (index: number, value: number) => {
  const arr = [...yAxisIndexesLocal.value]
  arr[index] = value
  yAxisIndexesLocal.value = arr
  updateOptions({ yAxisIndexes: arr })
}

// Series/data colors
const normalizeSeriesColors = (colors: string[] | undefined, length: number) => {
  const arr = colors ? [...colors] : []
  if (arr.length < length) arr.push(...Array.from({ length: length - arr.length }, () => ''))
  if (arr.length > length) arr.length = length
  return arr
}
const normalizeDataColors = (colors: string[] | undefined, length: number) => {
  const arr = colors ? [...colors] : []
  if (arr.length < length) arr.push(...Array.from({ length: length - arr.length }, () => ''))
  if (arr.length > length) arr.length = length
  return arr
}
const setSeriesColor = (index: number, color?: string) => {
  const next = normalizeSeriesColors(seriesColorsLocal.value, handleChartElement.value.data.legends.length)
  next[index] = color || ''
  seriesColorsLocal.value = next
  updateElement({
    data: {
      ...handleChartElement.value.data,
      seriesColors: next,
    }
  })
}
const setDataColor = (index: number, color?: string) => {
  const next = normalizeDataColors(dataColorsLocal.value, handleChartElement.value.data.labels.length)
  next[index] = color || ''
  dataColorsLocal.value = next
  updateElement({
    data: {
      ...handleChartElement.value.data,
      dataColors: next,
    }
  })
}

const syncSeriesColors = () => {
  const el = handleChartElement.value
  if (!el) return
  const len = el.data.legends.length
  seriesColorsLocal.value = normalizeSeriesColors(el.data.seriesColors, len)
  if (selectedSeriesIndex.value !== null && (len === 0 || selectedSeriesIndex.value >= len)) {
    selectedSeriesIndex.value = len ? Math.min(selectedSeriesIndex.value, len - 1) : null
  }
}

const syncDataColors = () => {
  const el = handleChartElement.value
  if (!el) return
  const len = el.data.labels.length
  dataColorsLocal.value = normalizeDataColors(el.data.dataColors, len)
  if (el.data.series.length !== 1) {
    selectedDataIndex.value = null
    return
  }
  if (selectedDataIndex.value !== null && (len === 0 || selectedDataIndex.value >= len)) {
    selectedDataIndex.value = len ? Math.min(selectedDataIndex.value, len - 1) : null
  }
}

// Scatter helper: apply uniform size
const applyScatterSize = () => {
  const size = scatterPointSize.value
  const dataPoints = handleChartElement.value.data.series[0]?.length || 0
  pointSizesLocal.value = Array.from({ length: dataPoints }, () => size)
  updateOptions({ pointSizes: pointSizesLocal.value })
}

// Axis title & range
const updateAxisTitle = (key: 'x' | 'yLeft' | 'yRight', value?: string) => {
  const current = handleChartElement.value.options?.axisTitle || {}
  updateOptions({ axisTitle: { ...current, [key]: value } })
}
const updateAxisRange = () => {
  updateOptions({
    axisRange: {
      xMin: axisRangeXMin.value,
      xMax: axisRangeXMax.value,
      yLeftMin: axisRangeYLeftMin.value,
      yLeftMax: axisRangeYLeftMax.value,
      yRightMin: axisRangeYRightMin.value,
      yRightMax: axisRangeYRightMax.value,
    }
  })
}

// Theme colors
const setThemeColors = (colors: string[]) => {
  updateElement({ themeColors: colors })
  themesVisible.value = false
  themeColorsSettingVisible.value = false
}

// Event binding for open editor and chart click
const openDataEditor = () => {
  chartDataEditorVisible.value = true 
}
const handleChartPointClick = (payload: {
  elementId?: string
  seriesIndex?: number
  dataIndex?: number
  name?: string
  value?: unknown
}) => {
  const el = handleChartElement.value
  if (!el) return
  if (payload?.elementId && payload.elementId !== handleElementId.value) return

  const legendsLen = el.data.legends.length
  const labelsLen = el.data.labels.length
  const seriesLen = el.data.series.length

  if (typeof payload?.seriesIndex === 'number' && payload.seriesIndex >= 0 && payload.seriesIndex < legendsLen) {
    selectedSeriesIndex.value = payload.seriesIndex
  }
  else {
    selectedSeriesIndex.value = null
  }

  if (seriesLen === 1 && typeof payload?.dataIndex === 'number' && payload.dataIndex >= 0 && payload.dataIndex < labelsLen) {
    selectedDataIndex.value = payload.dataIndex
  }
  else {
    selectedDataIndex.value = null
  }
}

const handleChartDblClick = (payload: { elementId?: string; targetTab?: string }) => {
  if (payload?.elementId && payload.elementId !== handleElementId.value) return
  if (payload.targetTab && isTabVisible(payload.targetTab)) {
    activeTab.value = payload.targetTab as ChartTabKey
  }
}

const isTabVisible = (key: string) => {
  const type = handleChartElement.value.chartType
  if (key === 'axes') return ['bar', 'column', 'line', 'area', 'scatter', 'combo'].includes(type)
  if (key === 'typeSpecific') return ['pie', 'ring', 'scatter'].includes(type)
  return true
}

watch(() => handleChartElement.value?.data?.legends?.length, () => syncSeriesColors())
watch(() => handleChartElement.value?.data?.seriesColors, () => syncSeriesColors(), { deep: true })
watch(() => handleChartElement.value?.data?.labels?.length, () => syncDataColors())
watch(() => handleChartElement.value?.data?.dataColors, () => syncDataColors(), { deep: true })
watch(() => handleChartElement.value?.data?.series?.length, (len) => {
  if (len !== 1) selectedDataIndex.value = null
  syncDataColors()
})

emitter.on(EmitterEvents.OPEN_CHART_DATA_EDITOR, openDataEditor)
emitter.on(EmitterEvents.CHART_POINT_CLICK, handleChartPointClick)
emitter.on(EmitterEvents.CHART_DBL_CLICK, handleChartDblClick)

onUnmounted(() => {
  emitter.off(EmitterEvents.OPEN_CHART_DATA_EDITOR, openDataEditor)
  emitter.off(EmitterEvents.CHART_POINT_CLICK, handleChartPointClick)
  emitter.off(EmitterEvents.CHART_DBL_CLICK, handleChartDblClick)
})
</script>

<style lang="scss" scoped>
.chart-style-panel {
  user-select: none;
}
.panel-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  overflow-x: auto;
}
.tab-item {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 32px;
  cursor: pointer;
  border-radius: 4px;
  color: #666;
  transition: all 0.2s;
  
  &:hover {
    background-color: #f3f4f6;
    color: #333;
  }
  
  &.active {
    background-color: #eef2ff;
    color: #6366f1;
  }
}
.row {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.row-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
.full-width-btn {
  width: 100%;
}
.label {
  font-size: 12px;
  margin-bottom: 4px;
  margin-right: 8px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 12px 0 8px;
}
.w-60 {
  width: 60%;
}
.small {
  font-size: 12px;
}
.combo-table {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
.combo-row {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
}
.combo-row:last-child {
  border-bottom: none;
}
.combo-cell {
  flex: 1;
  padding: 6px;
  font-size: 12px;
  display: flex;
  align-items: center;
}
.combo-header {
  background: #f8f9fb;
  font-weight: 600;
}
.input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
}
.input.small {
  width: 80px;
}
.axis-range {
  gap: 10px;
}
.axis-range-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.preset-themes {
  width: 250px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preset-theme {
  display: flex;
  cursor: pointer;
  border: 1px solid #ccc;
  padding: 2px;
  border-radius: $borderRadius;
  flex-wrap: wrap;
  gap: 2px;
  width: 72px;
  &:hover {
    border-color: $themeColor;
    transition: border-color $transitionDelayFast;
  }
}
.preset-theme-color {
  height: 12px;
  flex: 1 0 45%;
}
.table {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
.table-row {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  align-items: center;
}
.table-row:last-child {
  border-bottom: none;
}
.table-cell {
  flex: 1;
  padding: 6px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.table-header {
  background: #f8f9fb;
  font-weight: 600;
}
.table-row.selected {
  background: #eef2ff;
  border-left: 3px solid #6366f1;
}
</style>
