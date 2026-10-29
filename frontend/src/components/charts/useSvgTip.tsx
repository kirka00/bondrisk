import { useState, type ReactNode } from 'react'
import { chartTooltip, cn } from '../../lib/ui'

/** Простой тултип для SVG-графиков: позиция относительно контейнера `.chart`. */
export function useSvgTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null)
  const show = (e: React.MouseEvent, content: ReactNode) => {
    const host = (e.currentTarget as SVGElement).closest('.chart') as HTMLElement | null
    const r = host?.getBoundingClientRect()
    setTip({ x: e.clientX - (r?.left ?? 0) + 12, y: e.clientY - (r?.top ?? 0) + 12, content })
  }
  const hide = () => setTip(null)
  const node = tip ? <div className={cn(chartTooltip, 'pointer-events-none')} style={{ left: tip.x, top: tip.y }}>{tip.content}</div> : null
  return { show, hide, node }
}
/** Строки тултипа: заголовок и «подпись · значение». */
export const TipT = ({ children }: { children: ReactNode }) => <div className="text-muted mb-0.5">{children}</div>
export const TipR = ({ label, value }: { label: ReactNode; value: ReactNode }) => <div className="flex justify-between gap-3"><span>{label}</span><b className="font-semibold tabular-nums">{value}</b></div>
