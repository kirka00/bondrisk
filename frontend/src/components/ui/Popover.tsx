import * as P from '@radix-ui/react-popover'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { canHover } from '../../app/media'
import { cn, popover } from '../../lib/ui'

/** Момент последнего закрытия hover-поповера: подряд наведённые подсказки открываются без задержки. */
let lastClosedAt = 0
const OPEN_DELAY = 150, CLOSE_DELAY = 120, INSTANT_WINDOW = 400

interface Props {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  /** Открывать при наведении (на устройствах с hover); клик «пришпиливает». */
  hover?: boolean
  className?: string
  testId?: string
}

export function Popover({ trigger, children, side = 'bottom', align = 'start', hover = false, className = '', testId }: Props) {
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const timer = useRef<number | null>(null)
  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }
  const hovering = hover && canHover()

  const scheduleOpen = useCallback(() => {
    clear()
    const delay = Date.now() - lastClosedAt < INSTANT_WINDOW ? 0 : OPEN_DELAY
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }, [])
  const scheduleClose = useCallback(() => {
    clear()
    if (pinned.current) return
    timer.current = window.setTimeout(() => { setOpen(false); lastClosedAt = Date.now() }, CLOSE_DELAY)
  }, [])
  useEffect(() => clear, [])

  const onOpenChange = (o: boolean) => {
    if (!o) { pinned.current = false; lastClosedAt = Date.now() }
    clear()
    setOpen(o)
  }
  const onTriggerClick = () => {
    clear()
    if (open && pinned.current) { pinned.current = false; setOpen(false); lastClosedAt = Date.now(); return }
    pinned.current = true
    setOpen(true)
  }
  const hoverProps = hovering ? {
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') scheduleOpen() },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') scheduleClose() },
  } : {}

  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild onClick={hover ? (e) => { e.preventDefault(); onTriggerClick() } : undefined} {...hoverProps}>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content className={cn(popover, className)} side={side} align={align} sideOffset={6} collisionPadding={12} data-testid={testId} data-pinned={pinned.current || undefined}
          onOpenAutoFocus={hover ? (e) => e.preventDefault() : undefined} {...hoverProps}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
