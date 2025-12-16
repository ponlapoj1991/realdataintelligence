<template>
  <ul class="chart-pool">
    <li class="chart-item" v-for="(chart, index) in chartList" :key="index">
      <!-- Types with sub-menu: click tile inserts default; arrow opens sub-types -->
      <div class="chart-content" v-if="chartSubTypes[chart]" @mousedown.prevent.stop="selectChart(chart)">
        <IconChartLine size="26" v-if="chart === 'line'" />
        <IconChartHistogram size="26" v-else-if="chart === 'bar'" />
        <IconChartPie size="26" v-else-if="chart === 'pie'" />
        <IconChartHistogramOne size="26" v-else-if="chart === 'column'" />
        <IconChartLineArea size="26" v-else-if="chart === 'area'" />
        <IconChartRing size="26" v-else-if="chart === 'ring'" />
        <IconChartScatter size="26" v-else-if="chart === 'scatter'" />
        <IconRadarChart size="25" v-else-if="chart === 'radar'" />
        <IconChartHistogram size="26" v-else-if="chart === 'combo'" />

        <div class="name">{{ CHART_TYPE_MAP[chart] }}</div>

        <Popover
          trigger="click"
          placement="bottom"
          appendTo="parent"
          class="arrow-popover"
          @mousedown.stop
        >
          <template #content>
            <div class="sub-types-list" @mousedown.stop>
              <div
                class="sub-type-item"
                v-for="subType in chartSubTypes[chart]"
                :key="subType.value"
                @mousedown.prevent.stop="selectChart(chart, subType.value)"
              >
                {{ subType.label }}
              </div>
            </div>
          </template>

          <IconDown size="12" class="arrow-icon" @mousedown.stop />
        </Popover>
      </div>

      <!-- Types without sub-menu -->
      <div class="chart-content" @mousedown.prevent.stop="selectChart(chart)" v-else>
        <IconChartLine size="26" v-if="chart === 'line'" />
        <IconChartHistogram size="26" v-else-if="chart === 'bar'" />
        <IconChartPie size="26" v-else-if="chart === 'pie'" />
        <IconChartHistogramOne size="26" v-else-if="chart === 'column'" />
        <IconChartLineArea size="26" v-else-if="chart === 'area'" />
        <IconChartRing size="26" v-else-if="chart === 'ring'" />
        <IconChartScatter size="26" v-else-if="chart === 'scatter'" />
        <IconRadarChart size="25" v-else-if="chart === 'radar'" />
        <IconChartHistogram size="26" v-else-if="chart === 'combo'" />

        <div class="name">{{ CHART_TYPE_MAP[chart] }}</div>
      </div>
    </li>
  </ul>
</template>

<script lang="ts" setup>
import type { ChartType, ChartOptions } from '@/types/slides'
import { CHART_TYPE_MAP } from '@/configs/chart'
import Popover from '@/components/Popover.vue'

const emit = defineEmits<{
  (event: 'select', payload: ChartType, options?: ChartOptions): void
}>()

const chartList: ChartType[] = ['column', 'bar', 'line', 'area', 'pie', 'ring', 'scatter', 'radar', 'combo']

const chartSubTypes: Partial<Record<ChartType, { label: string; value: ChartOptions['subType'] }[]>> = {
  column: [
    { label: 'Clustered Column', value: 'clustered' },
    { label: 'Stacked Column', value: 'stacked' },
    { label: '100% Stacked Column', value: 'percentStacked' },
  ],
  bar: [
    { label: 'Clustered Bar', value: 'clustered' },
    { label: 'Stacked Bar', value: 'stacked' },
    { label: '100% Stacked Bar', value: 'percentStacked' },
  ],
  line: [
    { label: 'Line', value: 'clustered' },
    { label: 'Smooth Line', value: 'stacked' }, // Reusing 'stacked' as a flag for now, but better to use specific props
  ],
  area: [
    { label: 'Area', value: 'clustered' },
    { label: 'Stacked Area', value: 'stacked' },
    { label: '100% Stacked Area', value: 'percentStacked' },
  ],
  scatter: [
    { label: 'Scatter', value: 'scatter' },
    { label: 'Bubble', value: 'bubble' },
  ]
}

const selectChart = (chart: ChartType, subType?: ChartOptions['subType']) => {
  const options: ChartOptions = {}
  
  if (subType) options.subType = subType
  if (chart === 'line' && subType === 'stacked') {
    options.lineSmooth = true
    options.subType = undefined 
  }
  
  emit('select', chart, options)
}
</script>

<style lang="scss" scoped>
.chart-pool {
  width: 360px;
  margin-bottom: -8px;
  padding: 8px 8px 0;

  @include flex-grid-layout();
}
.chart-item {
  @include flex-grid-layout-children(3, 32%);

  height: 0;
  padding-bottom: 32%;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
}
.chart-content {
  @include absolute-0();

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #444;

  &:hover {
    color: $themeColor;
    background-color: rgba(0,0,0,0.03);
  }

  .name {
    margin-top: 6px;
    font-size: 12px;
  }
  
  .arrow-popover {
    position: absolute;
    bottom: 5px;
    right: 5px;
  }

  .arrow-icon {
    opacity: 0.5;
  }
}

.sub-types-list {
  padding: 5px 0;
  width: 140px;
}
.sub-type-item {
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  
  &:hover {
    background-color: rgba($color: $themeColor, $alpha: .1);
    color: $themeColor;
  }
}
</style>