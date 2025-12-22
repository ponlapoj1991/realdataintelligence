export type SharedChartType =
  | 'bar'
  | 'column'
  | 'line'
  | 'pie'
  | 'ring'
  | 'area'
  | 'scatter'
  | 'radar'
  | 'combo'
  | 'kpi'

export type SharedSeriesType = 'bar' | 'line' | 'area'

export type ValueFormatMode = 'auto' | 'text' | 'number' | 'compact' | 'accounting'

export type PercentPlacement = 'prefix' | 'suffix'

export type SharedDataLabelPosition = 'top' | 'inside' | 'outside' | 'center'

export interface SharedChartData {
  labels: string[]
  legends: string[]
  series: unknown[][]
  seriesColors?: string[]
  dataColors?: string[]
}

export interface SharedAxisRange {
  xMin?: number
  xMax?: number
  yLeftMin?: number
  yLeftMax?: number
  yRightMin?: number
  yRightMax?: number
}

export interface SharedSeriesDataLabel {
  enabled?: boolean
  position?: SharedDataLabelPosition
  fontSize?: number
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  color?: string
  showPercent?: boolean
  percentDecimals?: number
  percentPlacement?: PercentPlacement
  valueFormat?: ValueFormatMode
}

export interface SharedChartOptions {
  // Series/stack
  lineSmooth?: boolean
  lineStrokeWidth?: number
  lineStrokeStyle?: 'solid' | 'dashed' | 'dotted'
  stack?: boolean
  percentStack?: boolean
  subType?: 'clustered' | 'stacked' | 'percentStacked' | 'scatter' | 'bubble'
  seriesTypes?: SharedSeriesType[]
  yAxisIndexes?: number[]
  pointSizes?: number[]
  orientation?: 'vertical' | 'horizontal'
  barWidth?: number
  barCategoryGap?: string
  seriesSmoothList?: boolean[]
  seriesStrokeWidths?: number[]
  seriesStrokeStyles?: Array<'solid' | 'dashed' | 'dotted' | null>
  seriesDataLabels?: Array<SharedSeriesDataLabel | null>

  // Labels
  showDataLabels?: boolean
  dataLabelPosition?: SharedDataLabelPosition
  dataLabelFontSize?: number
  dataLabelFontFamily?: string
  dataLabelFontWeight?: 'normal' | 'bold'
  dataLabelColor?: string
  dataLabelValueFormat?: ValueFormatMode
  dataLabelShowCategoryName?: boolean
  dataLabelShowPercent?: boolean
  dataLabelPercentDecimals?: number
  dataLabelPercentPlacement?: PercentPlacement

  // Legend
  legendEnabled?: boolean
  legendPosition?: 'top' | 'bottom' | 'left' | 'right'
  legendAlign?: 'left' | 'center' | 'right'
  legendFontSize?: number
  legendFontFamily?: string
  legendFontColor?: string

  // Axis
  axisTitle?: { x?: string; yLeft?: string; yRight?: string }
  axisRange?: SharedAxisRange

  axisShowX?: boolean
  axisShowYLeft?: boolean
  axisShowYRight?: boolean

  axisLabelFontSizeX?: number
  axisLabelFontFamilyX?: string
  axisLabelColorX?: string
  axisLabelSlantX?: number
  axisGridShowX?: boolean
  axisGridColorX?: string

  axisLabelFontSizeYLeft?: number
  axisLabelFontFamilyYLeft?: string
  axisLabelColorYLeft?: string
  axisGridShowYLeft?: boolean
  axisGridColorYLeft?: string

  axisLabelFontSizeYRight?: number
  axisLabelFontFamilyYRight?: string
  axisLabelColorYRight?: string
  axisGridShowYRight?: boolean
  axisGridColorYRight?: string

  // Legacy axis fields (RealPPTX editor)
  axisLabelFontSize?: number
  axisLabelColor?: string
  axisLabelSlant?: 0 | 45 | 90
  axisGridShow?: boolean
  axisGridColor?: string

  // Pie/Ring
  pieInnerRadius?: number
  pieStartAngle?: number
}

export interface SharedChartPayload {
  type: SharedChartType
  data: SharedChartData
  themeColors: string[]
  textColor?: string
  lineColor?: string
  options?: SharedChartOptions
}
