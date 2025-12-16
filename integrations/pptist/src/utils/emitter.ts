import mitt, { type Emitter } from 'mitt'

export const enum EmitterEvents {
  RICH_TEXT_COMMAND = 'RICH_TEXT_COMMAND',
  SYNC_RICH_TEXT_ATTRS_TO_STORE = 'SYNC_RICH_TEXT_ATTRS_TO_STORE',
  OPEN_CHART_DATA_EDITOR = 'OPEN_CHART_DATA_EDITOR',
  OPEN_LATEX_EDITOR = 'OPEN_LATEX_EDITOR',
  CHART_POINT_CLICK = 'CHART_POINT_CLICK',
  CHART_DBL_CLICK = 'CHART_DBL_CLICK',
}

export interface RichTextAction {
  command: string
  value?: string
}

export interface RichTextCommand {
  target?: string
  action: RichTextAction | RichTextAction[]
}

export interface ChartPointClickPayload {
  elementId?: string
  seriesIndex?: number
  dataIndex?: number
  name?: string
  value?: unknown
  componentType?: string
  componentIndex?: number
}

export interface ChartDblClickPayload {
  elementId?: string
  targetTab?: string
}

type Events = {
  [EmitterEvents.RICH_TEXT_COMMAND]: RichTextCommand
  [EmitterEvents.SYNC_RICH_TEXT_ATTRS_TO_STORE]: void
  [EmitterEvents.OPEN_CHART_DATA_EDITOR]: void
  [EmitterEvents.OPEN_LATEX_EDITOR]: void
  [EmitterEvents.CHART_POINT_CLICK]: ChartPointClickPayload
  [EmitterEvents.CHART_DBL_CLICK]: ChartDblClickPayload
}

const emitter: Emitter<Events> = mitt<Events>()

export default emitter