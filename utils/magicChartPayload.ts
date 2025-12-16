import { DashboardWidget, RawRow } from '../types';
import { ChartTheme, CLASSIC_ANALYTICS_THEME } from '../constants/chartTheme';
import { buildDashboardChartPayload, DashboardChartInsertPayload } from './dashboardChartPayload';

export type MagicChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'scatter' | 'combo';

export type MagicChartOptions = NonNullable<DashboardChartInsertPayload['options']>;

export interface MagicChartPayload {
  type: MagicChartType;
  data: DashboardChartInsertPayload['data'];
  themeColors: string[];
  textColor?: string;
  lineColor?: string;
  options?: MagicChartOptions;
  // Raw ECharts option for pixel-perfect render/export
  optionRaw?: any;
}

/**
 * Build Magic (ECharts) payload by reusing existing DashboardChart payload logic.
 * This keeps data fidelity identical to PPTist expectations.
 */
export const buildMagicChartPayload = (
  widget: DashboardWidget,
  rows: RawRow[],
  opts?: {
    theme?: ChartTheme;
    sourceDashboardId?: string;
  }
): MagicChartPayload | null => {
  const payload = buildDashboardChartPayload(widget, rows, {
    theme: opts?.theme ?? CLASSIC_ANALYTICS_THEME,
    sourceDashboardId: opts?.sourceDashboardId,
  });

  if (!payload) return null;

  return {
    type: payload.chartType as MagicChartType,
    data: payload.data,
    themeColors: payload.theme.colors,
    textColor: payload.theme.textColor,
    lineColor: payload.theme.lineColor,
    options: payload.options,
  };
};