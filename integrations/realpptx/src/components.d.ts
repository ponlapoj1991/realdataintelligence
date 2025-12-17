import type { Icons } from '@/plugins/icon'
import type { Directive } from 'vue'
import type { Placement } from 'tippy.js'

type TooltipDelay = number | [number | null, number | null]
type TooltipBindingValue =
  | string
  | { content: string; placement?: Placement; delay?: TooltipDelay }

declare module 'vue' {
  export type GlobalComponents = Icons
  export interface GlobalDirectives {
    vTooltip: Directive<HTMLElement, TooltipBindingValue>
    vLoading: Directive
    vClickOutside: Directive
    vContextmenu: Directive
  }
}

export {}