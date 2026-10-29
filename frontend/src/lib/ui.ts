/** Общие классы интерфейса: cn(), варианты (cva) и строки утилит для повторяющихся элементов. */
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-ctl border border-border-strong bg-surface text-text cursor-pointer font-medium whitespace-nowrap transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-s1-soft focus-visible:border-accent max-md:min-h-11 motion-reduce:active:scale-100',
  {
    variants: {
      variant: {
        default: 'hover:bg-wash',
        primary: 'bg-accent border-accent text-accent-ink hover:brightness-90',
        danger: 'bg-critical border-critical text-white hover:brightness-90',
        ghost: 'border-transparent bg-transparent hover:bg-wash',
      },
      size: { md: 'h-8 px-3', sm: 'h-[26px] px-2 text-[12.5px] max-md:min-h-10' },
      icon: { true: 'px-0' },
    },
    compoundVariants: [
      { size: 'md', icon: true, class: 'w-8' },
      { size: 'sm', icon: true, class: 'w-[26px]' },
    ],
    defaultVariants: { variant: 'default', size: 'md' },
  },
)
export type ButtonVariants = VariantProps<typeof button>

export const input = cva(
  'rounded-ctl border border-border-strong bg-surface text-text outline-none min-w-0 focus-visible:ring-[3px] focus-visible:ring-s1-soft focus-visible:border-accent max-md:min-h-11',
  { variants: { size: { md: 'h-8 px-2.5', sm: 'h-[26px] px-2.5 text-[12.5px] max-md:min-h-10' }, num: { true: 'text-right tabular-nums' } }, defaultVariants: { size: 'md' } },
)
export const textarea = 'w-full rounded-ctl border border-border-strong bg-surface text-text outline-none px-2.5 py-2 resize-y focus-visible:ring-[3px] focus-visible:ring-s1-soft focus-visible:border-accent'
export const field = 'flex flex-col gap-1 min-w-0 [&>span]:text-xs [&>span]:text-muted'

export const badge = cva('inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-[11.5px] font-semibold whitespace-nowrap', {
  variants: {
    status: {
      ok: 'bg-good-bg text-good-text',
      warning: 'bg-warning-bg text-warning-text',
      breach: 'bg-critical-bg text-bad-text',
      waived: 'bg-wash-2 text-text-2',
      na: 'bg-wash text-muted',
      info: 'bg-s1-soft text-accent',
      amber: 'bg-warning-bg text-warning-text',
    },
  },
  defaultVariants: { status: 'na' },
})
export const chip = 'inline-flex items-center h-[18px] px-1.5 rounded-[4px] bg-wash text-text-2 text-[11px]'

export const card = 'bg-surface border border-border rounded-card p-4 min-w-0'
export const cardTight = 'bg-surface border border-border rounded-card px-3.5 py-3 min-w-0'
export const tile = 'bg-surface border border-border rounded-card px-3.5 py-3 flex flex-col gap-1 min-w-0'
export const tileLabel = 'tile-label text-muted text-xs flex items-center justify-between gap-1.5 whitespace-nowrap overflow-hidden [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis'
export const tileValue = 'text-[22px] font-semibold tracking-[-0.02em] leading-[1.15] whitespace-nowrap overflow-hidden text-ellipsis'
export const tileSub = 'text-text-2 text-xs flex gap-2 items-center whitespace-nowrap overflow-hidden text-ellipsis min-h-4'

export const tableWrap = 'overflow-auto border border-border rounded-card bg-surface'
/** Таблица во всю высоту страницы: без своей прокрутки, шапка прилипает под верхней панелью. */
export const tableWrapPage = 'overflow-visible [&_thead_th]:top-[52px] [&_thead_th:first-child]:rounded-tl-card [&_thead_th:last-child]:rounded-tr-card [&_tfoot_td:first-child]:rounded-bl-card [&_tfoot_td:last-child]:rounded-br-card'
export const tableWrapFlat = 'overflow-auto border-0 rounded-none max-h-none'
export const tbl = cn(
  'w-full border-separate border-spacing-0 text-[13px]',
  '[&_th]:sticky [&_th]:top-0 [&_th]:z-[2] [&_th]:bg-surface [&_th]:text-muted [&_th]:font-medium [&_th]:text-xs [&_th:not(.text-right)]:text-left [&_th]:px-2.5 [&_th]:py-2 [&_th]:border-b [&_th]:border-border-strong [&_th]:whitespace-nowrap [&_th]:select-none',
  '[&_td]:px-2.5 [&_td]:py-[7px] [&_td]:border-b [&_td]:border-border [&_td]:align-middle [&_td]:whitespace-nowrap',
  '[&_tfoot_td]:font-semibold [&_tfoot_td]:border-t [&_tfoot_td]:border-border-strong [&_tfoot_td]:border-b-0 [&_tfoot_td]:bg-surface [&_tfoot_td]:sticky [&_tfoot_td]:bottom-0',
)
export const tblDense = '[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-[7px]'
export const tblStickyFirst = '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[3] [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-surface [&_td:first-child]:z-[1]'
export const cellSub = 'block text-muted text-[11px] font-normal'
export const groupRow = 'group-row [&>td]:bg-wash [&>td]:text-text-2 [&>td]:font-semibold [&>td]:text-xs [&>td]:py-[5px]'

export const seg = 'inline-flex border border-border-strong rounded-ctl p-0.5 gap-0.5 bg-surface max-w-full overflow-x-auto no-scrollbar'
export const segItem = 'h-[26px] px-2.5 border-0 rounded-[4px] bg-transparent text-text-2 cursor-pointer font-medium text-[12.5px] whitespace-nowrap flex-none transition-transform duration-150 ease-out active:scale-[0.97] data-[state=on]:bg-wash-2 data-[state=on]:text-text max-md:h-9 max-md:min-w-11'
export const segItemOn = 'bg-wash-2 text-text'

export const popover = 'popover motion-pop bg-surface rounded-card shadow-pop px-3.5 py-3 z-50 max-w-[420px] text-[13px] origin-(--radix-popover-content-transform-origin) animate-pop-in [&_h4]:text-[13px] [&_h4]:mb-1.5'
export const tooltip = 'motion-pop bg-text text-surface rounded-md px-2 py-1.5 text-xs z-[70] max-w-[320px] origin-(--radix-tooltip-content-transform-origin) animate-tip-in'
export const overlay = 'fixed inset-0 bg-black/35 z-40 animate-fade-in'
export const dialog = cn(
  'dialog motion-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-auto bg-surface rounded-[10px] shadow-pop p-5 z-50 animate-dialog-in [&_h2]:mb-3',
  'max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:max-w-full max-md:max-h-[92dvh] max-md:rounded-t-[14px] max-md:rounded-b-none max-md:px-4 max-md:pt-4 max-md:pb-[calc(16px+env(safe-area-inset-bottom))] max-md:animate-sheet-up max-md:flex max-md:flex-col max-md:overflow-hidden',
)
export const dialogWide = 'w-[min(1040px,calc(100vw-32px))]'
export const sheet = cn(
  'motion-sheet fixed top-0 right-0 bottom-0 w-[min(520px,100vw)] bg-surface shadow-pop p-5 overflow-auto z-50 animate-sheet-in',
  'max-md:top-auto max-md:left-0 max-md:w-full max-md:max-h-[92dvh] max-md:rounded-t-[14px] max-md:px-4 max-md:pt-3 max-md:pb-[calc(16px+env(safe-area-inset-bottom))] max-md:animate-sheet-up max-md:flex max-md:flex-col max-md:overflow-hidden',
)
export const dialogScroll = 'max-md:flex-1 max-md:min-h-0 max-md:overflow-y-auto max-md:overflow-x-hidden max-md:-mx-4 max-md:px-4 [&>*]:min-w-0 [&>*]:max-w-full'
export const dialogActions = 'flex justify-end gap-2 mt-4 max-md:sticky max-md:bottom-0 max-md:bg-surface max-md:pt-3 max-md:mt-3 max-md:border-t max-md:border-border max-md:flex-wrap [&>*]:max-md:flex-1'

export const kv = 'grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:tabular-nums max-md:grid-cols-1 max-md:gap-y-0.5 max-md:[&_dt]:mt-1.5'
export const empty = 'empty px-4 py-7 text-center text-muted border border-dashed border-border-strong rounded-card [&>b]:text-text-2 [&>b]:block [&>b]:mb-1'
export const banner = cva('rounded-ctl px-3 py-2.5 text-[13px]', { variants: { kind: { error: 'bg-critical-bg text-bad-text', warn: 'bg-warning-bg text-warning-text', info: 'bg-s1-soft text-text' } }, defaultVariants: { kind: 'info' } })
export const cap = 'uppercase tracking-[0.04em] text-[11px] text-muted font-semibold'
export const legend = 'flex gap-3 flex-wrap text-xs text-text-2'
export const legendKey = 'inline-block w-3.5 h-0.5 rounded-[1px]'
export const legendKeyRect = 'inline-block w-3.5 h-2.5 rounded-[2px]'
export const chartTooltip = 'absolute pointer-events-none bg-surface border border-border-strong rounded-md px-2 py-1.5 text-xs z-[5] shadow-pop min-w-[140px]'
export const meterTrack = 'h-2 rounded-[4px] bg-s1-track relative overflow-hidden'
export const meterFill = cva('h-full rounded-[4px] transition-[width] duration-300 ease-out', { variants: { status: { ok: 'bg-accent', warning: 'bg-warning', breach: 'bg-critical', waived: 'bg-muted', na: 'bg-accent' } }, defaultVariants: { status: 'ok' } })
export const mcard = 'mcard bg-surface border border-border rounded-card px-3.5 py-3 flex flex-col gap-1.5'
export const mcardHead = 'flex justify-between gap-2.5 items-baseline [&>b]:font-semibold [&>b]:text-[15px]'
export const mcardKv = 'grid grid-cols-3 gap-x-2.5 gap-y-1.5 [&_.k]:text-muted [&_.k]:text-[11px] [&_.k]:block [&_.v]:tabular-nums [&_.v]:text-sm [&_.v]:font-medium [&_.v]:whitespace-nowrap [&_.v]:overflow-hidden [&_.v]:text-ellipsis [&_.v]:block'
export const mcardSub = 'text-text-2 text-xs flex gap-2 flex-wrap items-center'
export const mcardActions = 'flex gap-2 mt-1 [&>*]:flex-1'
export const pageHead = 'flex items-end justify-between gap-4 mb-4 max-md:flex-col max-md:items-stretch max-md:gap-2.5 [&>.row]:flex-none max-md:[&>.row]:flex-wrap'
export const pageSub = 'text-text-2 mt-0.5'
export const grid2 = 'grid gap-4 grid-cols-2 max-md:grid-cols-2 max-sm:grid-cols-1'
export const gridKpi = 'grid gap-3 grid-cols-4 max-lg:grid-cols-2 max-md:gap-2.5 max-[380px]:grid-cols-1'
export const row = 'flex items-center gap-2'
export const infoBtn = 'info-btn w-[18px] h-[18px] rounded-full border border-border-strong bg-transparent text-muted text-[11px] cursor-pointer inline-flex items-center justify-center leading-none p-0 hover:text-accent hover:border-accent'
