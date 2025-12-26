<template>
  <div class="export-pdf-dialog">
    <div class="thumbnails-view">
      <div class="thumbnails" ref="pdfThumbnailsRef">
        <ThumbnailSlide 
          class="thumbnail" 
          :slide="currentSlide" 
          :size="1600" 
          v-if="rangeType === 'current'"
        />
        <template v-else>
          <ThumbnailSlide 
            class="thumbnail" 
            :class="{ 'break-page': (index + 1) % count === 0 }"
            v-for="(slide, index) in renderSlides" 
            :key="slide.id" 
            :slide="slide" 
            :size="1600" 
          />
        </template>
      </div>
    </div>
    <div class="configs">
      <div class="row">
        <div class="title">Export Range</div>
        <RadioGroup
          class="config-item"
          v-model:value="rangeType"
        >
          <RadioButton style="width: 33.33%;" value="all">All</RadioButton>
          <RadioButton style="width: 33.33%;" value="current">Current</RadioButton>
          <RadioButton style="width: 33.33%;" value="custom">Custom</RadioButton>
        </RadioGroup>
      </div>
      <div class="row" v-if="rangeType === 'custom'">
        <div class="title" :data-range="`(${range[0]} ~ ${range[1]})`">Page Range</div>
        <Slider
          class="config-item"
          range
          :min="1"
          :max="slides.length"
          :step="1"
          v-model:value="range"
        />
      </div>
      <div class="row">
        <div class="title">Orientation</div>
        <Select
          class="config-item"
          v-model:value="orientation"
          :options="[
            { label: 'Auto', value: 'auto' },
            { label: 'Landscape', value: 'landscape' },
            { label: 'Portrait', value: 'portrait' },
          ]"
        />
      </div>
      <div class="row">
        <div class="title">Page Size</div>
        <Select
          class="config-item"
          v-model:value="pageSize"
          :options="[
            { label: 'Slide', value: 'slide' },
            { label: 'A4', value: 'a4' },
          ]"
        />
      </div>
      <div class="row">
        <div class="title">Per Page</div>
        <Select 
          class="config-item"
          v-model:value="count"
          :options="[
            { label: '1', value: 1 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
          ]"
        />
      </div>
      <div class="row">
        <div class="title">Padding</div>
        <div class="config-item">
          <Switch v-model:value="padding" />
        </div>
      </div>
    </div>

    <div class="btns">
      <Button class="btn export" type="primary" @click="expPDF()"><IconDownload /> Export PDF</Button>
      <Button class="btn close" @click="emit('close')">Close</Button>
    </div>

    <FullscreenSpin :loading="exporting" tip="Exporting..." />
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import { saveAs } from 'file-saver'
import { toJpeg } from 'html-to-image'
import message from '@/utils/message'
import { pickSaveFileHandle, writeBlobToFileHandle } from '@/utils/fileSystemAccess'

import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'
import Switch from '@/components/Switch.vue'
import Button from '@/components/Button.vue'
import RadioButton from '@/components/RadioButton.vue'
import RadioGroup from '@/components/RadioGroup.vue'
import Select from '@/components/Select.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import Slider from '@/components/Slider.vue'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const { slides, currentSlide, viewportRatio, title } = storeToRefs(useSlidesStore())

const pdfThumbnailsRef = useTemplateRef<HTMLElement>('pdfThumbnailsRef')
const rangeType = ref<'all' | 'current' | 'custom'>('all')
const range = ref<[number, number]>([1, slides.value.length])
const count = ref(1)
const padding = ref(true)
const orientation = ref<'auto' | 'landscape' | 'portrait'>('auto')
const pageSize = ref<'slide' | 'a4'>('slide')

const exporting = ref(false)

const sanitizeFileName = (value: string, ext: string) => {
  const raw = String(value || '').trim() || 'Canvas'
  return `${raw.replace(/[\\/:*?"<>|]+/g, '_')}${ext}`
}

const selectedSlides = computed(() => {
  if (rangeType.value === 'current') return [currentSlide.value]
  if (rangeType.value === 'custom') {
    const [min, max] = range.value
    return slides.value.filter((item, index) => index >= min - 1 && index <= max - 1)
  }
  return slides.value
})

const renderSlides = computed(() => selectedSlides.value)

const expPDF = async () => {
  if (!pdfThumbnailsRef.value) return
  if (exporting.value) return

  exporting.value = true
  try {
    const fileName = sanitizeFileName(title.value, '.pdf')
    const savePick = await pickSaveFileHandle({
      suggestedName: fileName,
      description: 'PDF',
      mime: 'application/pdf',
      extensions: ['.pdf'],
    })
    if (savePick.kind === 'cancelled') return

    const { jsPDF } = await import('jspdf')

    const slideWidth = 1600
    const slideHeight = 1600 * viewportRatio.value
    const margin = padding.value ? 50 : 0
    const perPage = rangeType.value === 'current' ? 1 : Math.max(1, count.value)

    const isSlideLandscape = slideWidth >= slideHeight
    const orient = orientation.value === 'auto'
      ? (isSlideLandscape ? 'landscape' : 'portrait')
      : orientation.value

    const a4 = { w: Math.round(8.27 * 96), h: Math.round(11.69 * 96) }
    const baseW = pageSize.value === 'a4'
      ? (orient === 'landscape' ? a4.h : a4.w)
      : (orient === 'landscape' ? slideWidth : slideHeight)
    const baseH = pageSize.value === 'a4'
      ? (orient === 'landscape' ? a4.w : a4.h)
      : (orient === 'landscape' ? slideHeight : slideWidth)

    const formatWidth = baseW + margin * 2
    const formatHeight = baseH * perPage + margin * 2

    const orientationValue = orient === 'landscape' ? 'landscape' : 'portrait'

    const pdf = new jsPDF({
      orientation: orientationValue,
      unit: 'px',
      format: [formatWidth, formatHeight],
      compress: true,
      hotfixes: ['px_scaling'],
    })
    const pdfAny = pdf as any

    const getPageSize = () => {
      const internal = (pdfAny && pdfAny.internal && pdfAny.internal.pageSize) ? pdfAny.internal.pageSize : null
      const w = internal?.getWidth ? internal.getWidth() : formatWidth
      const h = internal?.getHeight ? internal.getHeight() : formatHeight
      return { w, h }
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await new Promise((r) => setTimeout(r, 250))

    const slideNodes = Array.from(pdfThumbnailsRef.value.querySelectorAll('.thumbnail')) as HTMLElement[]
    const totalPages = Math.ceil(slideNodes.length / perPage) || 1

    const config = {
      quality: 0.95,
      width: slideWidth,
      height: slideHeight,
      fontEmbedCSS: '',
      backgroundColor: '#ffffff',
    }

    const { w: pageWidth, h: pageHeight } = getPageSize()

    const availableWidth = pageWidth - margin * 2
    const blockHeight = (pageHeight - margin * 2) / perPage
    const scale = Math.min(availableWidth / slideWidth, blockHeight / slideHeight)
    const drawWidth = slideWidth * scale
    const drawHeight = slideHeight * scale
    const offsetX = margin + (availableWidth - drawWidth) / 2
    const offsetYInBlock = (blockHeight - drawHeight) / 2

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      if (pageIndex > 0) {
        pdfAny.addPage([formatWidth, formatHeight], orientationValue)
      }

      const start = pageIndex * perPage
      const end = Math.min(start + perPage, slideNodes.length)
      for (let i = start; i < end; i++) {
        const node = slideNodes[i]

        const foreignObjectSpans = node.querySelectorAll('foreignObject [xmlns]') as NodeListOf<HTMLElement>
        foreignObjectSpans.forEach(spanRef => spanRef.removeAttribute('xmlns'))

        const dataUrl = await toJpeg(node, config)

        const x = offsetX
        const y = margin + (i - start) * blockHeight + offsetYInBlock
        pdfAny.addImage(dataUrl, 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST')
      }
    }

    const outBlob = pdf.output('blob') as Blob
    if (savePick.kind === 'picked') {
      await writeBlobToFileHandle(savePick.handle, outBlob)
    }
    else {
      saveAs(outBlob, fileName)
    }
  }
  catch (err) {
    console.error(err)
    message.error('Export Failed')
  }
  finally {
    exporting.value = false
  }
}
</script>

<style lang="scss" scoped>
.export-pdf-dialog {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.thumbnails-view {
  @include absolute-0();

  &::after {
    content: '';
    background-color: #fff;
    @include absolute-0();
  }
}
.thumbnail {
  &.break-page {
    break-after: page;
  }
}

:deep(.thumbnail-slide) {
  position: relative;
}

:deep(.thumbnail-slide .elements) {
  position: relative;
}
.configs {
  width: 300px;
  height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  z-index: 1;

  .row {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 25px;
  }

  .title {
    width: 100px;
    position: relative;

    &::after {
      content: attr(data-range);
      position: absolute;
      top: 20px;
      left: 0;
    }
  }
  .config-item {
    flex: 1;
  }

  .tip {
    font-size: 12px;
    color: #aaa;
    line-height: 1.8;
    margin-top: 25px;
  }
}
.btns {
  width: 300px;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;

  .export {
    flex: 1;
  }
  .close {
    width: 100px;
    margin-left: 10px;
  }
}
</style>
