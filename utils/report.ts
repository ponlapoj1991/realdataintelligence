
import { DashboardWidget, Project, RawRow, ReportElement, ReportSlide, TableCell } from '../types';
import { buildDashboardChartPayload } from './dashboardChartPayload';
import type { DashboardChartInsertPayload } from './dashboardChartPayload';
import { PPTIST_CHART_THEME } from '../constants/chartTheme';
import type { ChartTheme } from '../constants/chartTheme';

export const generatePowerPoint = async (
  project: Project,
  dashboardElement: HTMLElement,
  activeFiltersStr: string = '',
  dashboardWidgets?: DashboardWidget[],
  rows?: RawRow[],
  theme?: ChartTheme
) => {
  if (!window.PptxGenJS) {
    alert("Export libraries are not fully loaded. Please refresh the page.");
    return;
  }

  const canRasterize = !!window.html2canvas;
  const exportRows = rows || [];
  const exportTheme = theme || PPTIST_CHART_THEME;

  const toHex = (color?: string) => (color ? color.replace('#', '') : undefined);

  const mapLegendPos = (pos?: 'top' | 'bottom' | 'left' | 'right') => {
    if (pos === 'top') return 't';
    if (pos === 'left') return 'l';
    if (pos === 'right') return 'r';
    return 'b';
  };

  const mapDataLabelPosForBar = (pos?: 'top' | 'inside' | 'outside' | 'center') => {
    // pptx: 'inEnd' | 'outEnd' | 'ctr' | 'inBase' | ...
    if (pos === 'inside') return 'inEnd';
    if (pos === 'center') return 'ctr';
    if (pos === 'outside') return 'outEnd';
    if (pos === 'top') return 'outEnd';
    return undefined;
  };

  const mapDataLabelPosForPie = (pos?: 'top' | 'inside' | 'outside' | 'center') => {
    // pptx: 'bestFit' | 'ctr' | 'inEnd' | 'outEnd'
    if (pos === 'inside') return 'inEnd';
    if (pos === 'center') return 'ctr';
    if (pos === 'outside') return 'outEnd';
    if (pos === 'top') return 'outEnd';
    return undefined;
  };

  const buildSeries = (payload: DashboardChartInsertPayload) => {
    return payload.data.series.map((values, idx) => ({
      name: payload.data.legends?.[idx] || `Series ${idx + 1}`,
      labels: payload.data.labels,
      values,
    }));
  };

  const tryAddEditableChart = (pptx: any, slide: any, payload: DashboardChartInsertPayload) => {
    const chartType = payload.chartType;
    const isPieLike = chartType === 'pie' || chartType === 'ring';
    const isBarLike = chartType === 'bar' || chartType === 'column';

    // Chart data
    if (!payload.data?.labels?.length || !payload.data?.series?.length) return false;
    const seriesData = buildSeries(payload);

    // Colors
    const themeColors = (payload.theme?.colors || exportTheme.palette || []).map(toHex).filter(Boolean) as string[];
    const seriesColors = (payload.data.seriesColors || []).map(toHex).filter(Boolean) as string[];
    const dataColors = (payload.data.dataColors || []).map(toHex).filter(Boolean) as string[];
    const fallbackColors = (seriesColors.length ? seriesColors : themeColors).filter(Boolean) as string[];
    if (!fallbackColors.length) fallbackColors.push('000000');

    const opts: any = {
      x: 0.5,
      y: 1.3,
      w: 9.0,
      h: 4.0,
    };

    if (isPieLike) {
      opts.chartColors = (dataColors.length ? dataColors : fallbackColors).slice();
    }
    else if (isBarLike && payload.data.series.length === 1 && dataColors.length) {
      opts.chartColors = dataColors.slice();
    }
    else {
      opts.chartColors = fallbackColors.slice(0, Math.max(1, payload.data.series.length));
    }

    // Legend
    const legendEnabled =
      payload.options?.legendEnabled !== false &&
      payload.data.series.length > 1 &&
      chartType !== 'scatter';

    if (legendEnabled) {
      opts.showLegend = true;
      opts.legendPos = mapLegendPos(payload.options?.legendPosition);
    }

    // Data labels
    const showDataLabels = payload.options?.showDataLabels === true;
    if (showDataLabels) {
      const labelColor =
        toHex(payload.options?.dataLabelColor) ||
        toHex(payload.theme?.textColor) ||
        toHex(exportTheme.typography.axisColor) ||
        '666666';

      opts.dataLabelColor = labelColor;
      if (typeof payload.options?.dataLabelFontSize === 'number') opts.dataLabelFontSize = payload.options.dataLabelFontSize;
      if (payload.options?.dataLabelFontWeight === 'bold') opts.dataLabelFontBold = true;

      if (chartType === 'bar' || chartType === 'column') {
        opts.showValue = true;
        const mapped = mapDataLabelPosForBar(payload.options?.dataLabelPosition);
        if (mapped) opts.dataLabelPosition = mapped;
      }
      else if (chartType === 'line' || chartType === 'area') {
        opts.showValue = true;
      }
      else if (isPieLike) {
        const showPercent = !!payload.options?.dataLabelShowPercent;
        opts.showPercent = showPercent;
        opts.showValue = !showPercent;

        const mapped = mapDataLabelPosForPie(payload.options?.dataLabelPosition);
        if (mapped) opts.dataLabelPosition = mapped;
      }
    }

    // Axis styling (best-effort)
    const xAxisColor =
      toHex(payload.options?.axisLabelColorX) ||
      toHex(payload.theme?.textColor) ||
      toHex(exportTheme.typography.axisColor) ||
      '666666';
    const yAxisColor =
      toHex(payload.options?.axisLabelColorYLeft) ||
      toHex(payload.theme?.textColor) ||
      toHex(exportTheme.typography.axisColor) ||
      '666666';

    opts.catAxisLabelColor = xAxisColor;
    opts.valAxisLabelColor = yAxisColor;

    if (typeof payload.options?.axisLabelFontSizeX === 'number') opts.catAxisLabelFontSize = payload.options.axisLabelFontSizeX;
    if (typeof payload.options?.axisLabelFontSizeYLeft === 'number') opts.valAxisLabelFontSize = payload.options.axisLabelFontSizeYLeft;

    const gridColor =
      toHex(payload.options?.axisGridColorYLeft) ||
      toHex(payload.theme?.lineColor) ||
      toHex(exportTheme.background.grid) ||
      'D9D9D9';

    if (payload.options?.axisGridShowYLeft === false) {
      opts.valGridLine = { style: 'none' };
    }
    else {
      opts.valGridLine = { color: gridColor, style: 'solid', size: 1 };
    }

    // Chart type mapping
    if (chartType === 'bar' || chartType === 'column') {
      const orientation = payload.options?.orientation;
      const barDir =
        orientation === 'horizontal' ? 'bar' :
        orientation === 'vertical' ? 'col' :
        chartType === 'bar' ? 'bar' : 'col';

      opts.barDir = barDir;
      if (payload.options?.percentStack) opts.barGrouping = 'percentStacked';
      else if (payload.options?.stack) opts.barGrouping = 'stacked';

      slide.addChart(pptx.ChartType.bar, seriesData, opts);
      return true;
    }

    if (chartType === 'line') {
      slide.addChart(pptx.ChartType.line, seriesData, opts);
      return true;
    }

    if (chartType === 'area') {
      if (payload.options?.percentStack) opts.barGrouping = 'percentStacked';
      else if (payload.options?.stack) opts.barGrouping = 'stacked';

      slide.addChart(pptx.ChartType.area, seriesData, opts);
      return true;
    }

    if (chartType === 'pie') {
      slide.addChart(pptx.ChartType.pie, seriesData, opts);
      return true;
    }

    if (chartType === 'ring') {
      const holeSize = Math.max(0, Math.min(90, Math.round(payload.options?.pieInnerRadius ?? 40)));
      opts.holeSize = holeSize;
      slide.addChart(pptx.ChartType.doughnut, seriesData, opts);
      return true;
    }

    return false;
  };

  const tryAddWidgetAsImage = async (pptx: any, widgetEl: HTMLElement, title: string, meta: string, idx: number) => {
    if (!canRasterize) {
      const fallbackSlide = pptx.addSlide();
      fallbackSlide.addText(title, { x: 0.5, y: 0.4, fontSize: 24, bold: true, color: '333333' });
      fallbackSlide.addText('This widget could not be exported as an editable chart.', {
        x: 0.5,
        y: 1.3,
        w: 9.0,
        h: 1.0,
        fontSize: 14,
        color: '888888',
      });
      return;
    }

    try {
      const canvas = await window.html2canvas(widgetEl, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');

      const slide = pptx.addSlide();
      slide.addText(title, { x: 0.5, y: 0.4, fontSize: 24, bold: true, color: '333333' });
      slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.9, w: '90%', h: 0, line: { color: '0047BA', width: 2 } });

      if (meta) {
        slide.addText(meta, { x: 0.5, y: 1.0, fontSize: 11, color: '888888', italic: true });
      }

      slide.addImage({
        data: imgData,
        x: 0.5,
        y: 1.3,
        w: 9.0,
        h: 4.0,
        sizing: { type: 'contain', w: 9.0, h: 4.0 },
      });

      slide.addText('RealData Intelligence', { x: 8.5, y: 5.3, fontSize: 10, color: 'CCCCCC' });
    }
    catch (e) {
      console.error(`Failed to capture widget index ${idx}`, e);
    }
  };

  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'RealData Intelligence';
  pptx.company = 'RealData Agency';
  pptx.title = project.name;

  // --- Slide 1: Title Slide ---
  let slide = pptx.addSlide();
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.15, fill: '0047BA' }); // Top bar

  slide.addText('Social Listening Report', {
    x: 0.5, y: 1.5, w: '90%', fontSize: 14, color: '666666', bold: true, align: 'left'
  });

  slide.addText(project.name, {
    x: 0.5, y: 2.0, w: '90%', fontSize: 44, bold: true, color: '003366', align: 'left'
  });

  if (activeFiltersStr) {
    slide.addText(`Filters Applied: ${activeFiltersStr}`, {
      x: 0.5, y: 3.0, w: '90%', fontSize: 12, color: 'E07A5F', italic: true
    });
  }

  slide.addText(`Generated on: ${new Date().toLocaleDateString()}`, {
    x: 0.5, y: 5.0, fontSize: 12, color: '888888'
  });

  slide.addText(project.description || '', {
    x: 0.5, y: 3.5, w: '80%', fontSize: 16, color: '444444'
  });

  // --- Processing Widgets ---
  const widgetEls = dashboardElement.querySelectorAll('.report-widget');

  // If widgets + data provided, export as editable charts first, fallback to images
  if (dashboardWidgets && dashboardWidgets.length && exportRows.length) {
    for (let i = 0; i < dashboardWidgets.length; i++) {
      const widget = dashboardWidgets[i];
      const widgetEl = (widgetEls[i] as HTMLElement | undefined) || null;

      const title = widget.title || widget.chartTitle || `Chart ${i + 1}`;
      const meta = widget.type ? `${widget.type}` : '';

      let exported = false;
      try {
        const payload = buildDashboardChartPayload(widget, exportRows, { theme: exportTheme });
        if (payload) {
          const slide = pptx.addSlide();
          slide.addText(title, { x: 0.5, y: 0.4, fontSize: 24, bold: true, color: '333333' });
          slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.9, w: '90%', h: 0, line: { color: '0047BA', width: 2 } });

          if (meta) {
            slide.addText(meta, { x: 0.5, y: 1.0, fontSize: 11, color: '888888', italic: true });
          }

          exported = tryAddEditableChart(pptx, slide, payload);
          slide.addText('RealData Intelligence', { x: 8.5, y: 5.3, fontSize: 10, color: 'CCCCCC' });
        }
      }
      catch (e) {
        console.error('Failed to export widget as editable chart', e);
      }

      if (!exported) {
        if (widgetEl) {
          await tryAddWidgetAsImage(pptx, widgetEl, title, meta, i);
        }
        else {
          const slide = pptx.addSlide();
          slide.addText(title, { x: 0.5, y: 0.4, fontSize: 24, bold: true, color: '333333' });
          slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 0.9, w: '90%', h: 0, line: { color: '0047BA', width: 2 } });

          if (meta) {
            slide.addText(meta, { x: 0.5, y: 1.0, fontSize: 11, color: '888888', italic: true });
          }

          slide.addText('This chart could not be exported as an editable chart, and a fallback image could not be captured.', {
            x: 0.5,
            y: 1.5,
            w: 9.0,
            h: 1.2,
            fontSize: 14,
            color: '888888',
          });

          slide.addText('RealData Intelligence', { x: 8.5, y: 5.3, fontSize: 10, color: 'CCCCCC' });
        }
      }
    }
  }
  // Legacy: export as images only
  else {
    for (let i = 0; i < widgetEls.length; i++) {
      const widgetEl = widgetEls[i] as HTMLElement;

      const titleEl = widgetEl.querySelector('.widget-title');
      const title = titleEl?.textContent || `Chart ${i + 1}`;

      const metaEl = widgetEl.querySelector('.widget-meta');
      const meta = metaEl?.textContent || '';

      await tryAddWidgetAsImage(pptx, widgetEl, title, meta, i);
    }
  }

  pptx.writeFile({ fileName: `${project.name}_Report_${new Date().toISOString().slice(0, 10)}.pptx` });
};

// Phase 5: Custom Report Generation from Canvas
const PPT_WIDTH_INCH = 10;
const PPT_HEIGHT_INCH = 5.625;

const pxToInches = (value: number, canvasSize: number, pptSize: number) => (value / canvasSize) * pptSize;
const normalizeColor = (color?: string) => color ? color.replace('#', '') : undefined;
const parseFontSize = (size?: string) => {
    if (!size) return undefined;
    const num = parseFloat(size);
    return Number.isFinite(num) ? num : undefined;
};
const isBold = (weight?: string) => {
    if (!weight) return false;
    if (weight === 'bold') return true;
    const numeric = parseInt(weight, 10);
    return Number.isFinite(numeric) ? numeric >= 600 : false;
};
const isUnderline = (decoration?: string) => decoration?.includes('underline');

const addTableToSlide = (
    slide: any,
    element: ReportElement,
    tableCells: TableCell[][],
    columnWidths: number[] | undefined,
    canvasWidth: number,
    canvasHeight: number
) => {
    const x = pxToInches(element.x, canvasWidth, PPT_WIDTH_INCH);
    const y = pxToInches(element.y, canvasHeight, PPT_HEIGHT_INCH);
    const w = pxToInches(element.w, canvasWidth, PPT_WIDTH_INCH);
    const h = pxToInches(element.h, canvasHeight, PPT_HEIGHT_INCH);

    const rows = tableCells.map(row => row.map(cell => ({
        text: cell.text,
        options: {
            colspan: cell.colSpan,
            rowspan: cell.rowSpan,
            color: normalizeColor(cell.style?.color),
            fill: normalizeColor(cell.style?.backgroundColor),
            align: cell.style?.textAlign,
            bold: isBold(cell.style?.fontWeight),
            fontFace: cell.style?.fontFamily,
            fontSize: parseFontSize(cell.style?.fontSize)
        }
    })));

    const colW = columnWidths?.length
        ? columnWidths.map(widthPercent => (widthPercent / 100) * w)
        : undefined;

    slide.addTable(rows, {
        x, y, w, h,
        colW
    });
};

const waitForFonts = async () => {
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
        try {
            await (document as any).fonts.ready;
        } catch (err) {
            console.warn("Font loading wait failed", err);
        }
    }
};

const waitForImages = async (slides: ReportSlide[]) => {
    const promises: Promise<void>[] = [];
    slides.forEach(slide => {
        if (slide.background?.startsWith('data:')) {
            promises.push(new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Background image failed to load'));
                img.src = slide.background as string;
            }));
        }

        slide.elements.forEach(el => {
            if (el.type === 'image' && el.content) {
                promises.push(new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('Element image failed to load'));
                    img.src = el.content as string;
                }));
            }
        });
    });

    if (promises.length) {
        try {
            await Promise.all(promises);
        } catch (err) {
            console.warn('Image preload failed', err);
        }
    }
};

export const validateSlidesForPptx = async (slides: ReportSlide[]) => {
    const issues: string[] = [];

    if (!window.PptxGenJS) {
        issues.push("Export libraries not loaded. Refresh and try again.");
    }

    if (!slides.length) {
        issues.push("No slides to export.");
    }

    let hasContent = false;

    slides.forEach((slide, sIdx) => {
        if (slide.elements.length > 0 || slide.background) hasContent = true;
        else issues.push(`Slide ${sIdx + 1} is empty. Add content or a background before exporting.`);

        slide.elements.forEach((el, eIdx) => {
            if (el.type === 'image' && !el.content) {
                issues.push(`Slide ${sIdx + 1} element ${eIdx + 1} missing image data`);
            }
            if (el.w <= 0 || el.h <= 0) {
                issues.push(`Slide ${sIdx + 1} element ${eIdx + 1} has invalid dimensions`);
            }
            if (el.type === 'table' && (!el.tableData || el.tableData.rows.length === 0)) {
                issues.push(`Slide ${sIdx + 1} table ${eIdx + 1} is empty`);
            }
            if (el.type === 'chart' && (!el.chartData || !el.chartData.data || el.chartData.data.length === 0)) {
                issues.push(`Slide ${sIdx + 1} chart ${eIdx + 1} has no data`);
            }
        });
    });

    if (!hasContent) {
        issues.push("All slides are empty. Add elements before exporting.");
    }

    await waitForFonts();
    await waitForImages(slides);

    return issues;
};

const ensurePptxExportReady = async (slides: ReportSlide[]) => {
    const issues = await validateSlidesForPptx(slides);
    if (issues.length) {
        const err: any = new Error(issues.join('\n'));
        err.issues = issues;
        throw err;
    }
};

export const generateCustomReport = async (
  project: Project,
  slides: ReportSlide[],
  canvasWidth: number,
  canvasHeight: number
) => {
  await ensurePptxExportReady(slides);

  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 inches

  for (const slideData of slides) {
      const slide = pptx.addSlide();

      if (slideData.background) {
          if (slideData.background.startsWith('data:')) {
              slide.background = { path: slideData.background };
          } else {
              slide.background = { color: normalizeColor(slideData.background) };
          }
      }

      const orderedElements = [...slideData.elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

      for (const el of orderedElements) {
          const x = pxToInches(el.x, canvasWidth, PPT_WIDTH_INCH);
          const y = pxToInches(el.y, canvasHeight, PPT_HEIGHT_INCH);
          const w = pxToInches(el.w, canvasWidth, PPT_WIDTH_INCH);
          const h = pxToInches(el.h, canvasHeight, PPT_HEIGHT_INCH);
          const rotation = el.style?.rotation || 0;

          if (el.type === 'text') {
              slide.addText(el.content || '', {
                  x, y, w, h,
                  color: normalizeColor(el.style?.color),
                  fontFace: el.style?.fontFamily,
                  fontSize: parseFontSize(el.style?.fontSize),
                  bold: isBold(el.style?.fontWeight),
                  italic: el.style?.fontStyle === 'italic',
                  underline: isUnderline(el.style?.textDecoration),
                  align: el.style?.textAlign,
                  fill: normalizeColor(el.style?.backgroundColor),
                  rotate: rotation,
                  valign: 'top',
                  margin: 2
              });
          } else if (el.type === 'image' && el.content) {
              slide.addImage({ data: el.content, x, y, w, h, rotate: rotation });
          } else if (el.type === 'shape') {
              let shapeType = pptx.ShapeType.rect;
              if (el.shapeType === 'circle') shapeType = pptx.ShapeType.ellipse;
              else if (el.shapeType === 'triangle') shapeType = pptx.ShapeType.triangle;
              else if (el.shapeType === 'line') shapeType = pptx.ShapeType.line;
              else if (el.shapeType === 'arrow') shapeType = pptx.ShapeType.rightArrow;
              else if (el.shapeType === 'star') shapeType = pptx.ShapeType.star5;

              slide.addShape(shapeType, {
                  x, y, w, h,
                  fill: normalizeColor(el.style?.fill || el.style?.backgroundColor),
                  line: {
                      color: normalizeColor(el.style?.stroke),
                      width: el.style?.strokeWidth || 0
                  },
                  rotate: rotation
              });
          } else if (el.type === 'table' && el.tableData) {
              addTableToSlide(slide, el, el.tableData.rows, el.tableData.columnWidths, canvasWidth, canvasHeight);
          } else if (el.type === 'chart' && el.chartData) {
              const labels = el.chartData.data.map((d: any) => d.name || '');
              const values = el.chartData.data.map((d: any) => Number(d.value) || 0);
              const chartTypeMap: Record<string, any> = {
                  bar: pptx.ChartType.bar,
                  pie: pptx.ChartType.pie,
                  line: pptx.ChartType.line,
                  area: pptx.ChartType.area
              };
              const chartType = chartTypeMap[el.chartData.chartType];

              if (chartType) {
                  slide.addChart(chartType, [
                      { name: el.chartData.title || 'Series 1', labels, values }
                  ], {
                      x, y, w, h,
                      showLegend: false,
                      dataLabelColor: '666666',
                      catAxisLabelFontSize: 10,
                      valAxisLabelFontSize: 10
                  });
              }
          } else {
              console.warn('Unsupported element for PPT export', el.type);
          }
      }
  }

  pptx.writeFile({ fileName: `${project.name}_CustomReport.pptx` });
};