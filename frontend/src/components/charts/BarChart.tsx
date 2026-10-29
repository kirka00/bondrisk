/** Горизонтальные столбцы (в т. ч. дивергентные от нуля): ≤24px, скругление на конце данных, 2px зазор. */
import { useIsMobile } from '../../app/media'
import { fmt } from '../../lib/format'
import { TipR, TipT, useSvgTip } from './useSvgTip'

export interface BarItem { label: string; value: number; sub?: string; status?: 'ok' | 'warning' | 'critical'; color?: string }
interface Props { items: BarItem[]; format?: (v: number) => string; diverging?: boolean; height?: number; labelWidth?: number; valueWidth?: number; title?: string }

export function BarChart({ items, format = (v) => fmt.rub0(v), diverging = true, labelWidth = 150, valueWidth = 110 }: Props) {
  const { show, hide, node } = useSvgTip()
  const mobile = useIsMobile()
  if (mobile) return <HtmlBars items={items} format={format} diverging={diverging} />
  const rowH = 26, barH = 16, pad = 6
  const width = 640
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)))
  const neg = diverging && items.some((i) => i.value < 0)
  const plotL = labelWidth + (neg ? valueWidth : 0)
  const plotW = width - plotL - valueWidth
  const zeroX = neg ? plotL + plotW / 2 : plotL
  const scale = (v: number) => (Math.abs(v) / max) * (neg ? plotW / 2 : plotW)
  const h = items.length * rowH + pad * 2
  return (
    <div className="chart relative">
      <svg viewBox={`0 0 ${width} ${h}`} width="100%" height={h} role="img" aria-label="Столбчатая диаграмма">
        <line x1={zeroX} x2={zeroX} y1={pad} y2={h - pad} stroke="var(--color-axis)" strokeWidth={1} />
        {items.map((it, i) => {
          const y = pad + i * rowH + (rowH - barH) / 2
          const w = Math.max(0, scale(it.value) - 1)
          const x = it.value >= 0 ? zeroX + 1 : zeroX - 1 - w
          const fill = it.color ?? (it.value >= 0 ? 'var(--color-s1)' : 'var(--color-s8)')
          const r = 4
          const path = it.value >= 0
            ? `M${x},${y} h${Math.max(0, w - r)} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${Math.max(0, w - r)} z`
            : `M${x + w},${y} h-${Math.max(0, w - r)} a${r},${r} 0 0 0 -${r},${r} v${barH - 2 * r} a${r},${r} 0 0 0 ${r},${r} h${Math.max(0, w - r)} z`
          const txt = format(it.value)
          return (
            <g key={it.label} onMouseMove={(e) => show(e, <><TipT>{it.label}</TipT><TipR label={<>{it.sub ?? 'значение'}</>} value={<>{txt}</>} /></>)} onMouseLeave={hide}>
              <rect x={0} y={pad + i * rowH} width={width} height={rowH} fill="transparent" />
              <text x={labelWidth - 10} y={y + barH / 2 + 4} textAnchor="end" fontSize={12} fill="var(--color-text-2)">{it.label}</text>
              {w > 0 ? <path d={path} fill={fill} /> : <rect x={zeroX - 1} y={y} width={2} height={barH} fill="var(--color-axis)" />}
              <text x={it.value >= 0 ? Math.max(x + w + 8, zeroX + 8) : Math.min(x - 8, zeroX - 8)} y={y + barH / 2 + 4} textAnchor={it.value >= 0 ? 'start' : 'end'} fontSize={12} fill="var(--color-text)" style={{ fontVariantNumeric: 'tabular-nums' }}>{txt}</text>
            </g>
          )
        })}
      </svg>
      {node}
    </div>
  )
}

/** Мобильный вариант: HTML-строки «подпись · трек · значение», подпись внутри строки. */
function HtmlBars({ items, format, diverging }: { items: BarItem[]; format: (v: number) => string; diverging: boolean }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)))
  const neg = diverging && items.some((i) => i.value < 0)
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label="Столбчатая диаграмма">
      {items.map((it) => {
        const w = (Math.abs(it.value) / max) * (neg ? 50 : 100)
        const left = neg ? (it.value >= 0 ? 50 : 50 - w) : 0
        return (
          <div key={it.label} className="grid grid-cols-[64px_1fr_84px] items-center gap-2 text-xs min-h-6" title={it.sub}>
            <span className="text-text-2 font-mono">{it.label}</span>
            <span className="relative h-2.5 bg-neutral-mid rounded-[3px]">{neg && <span className="absolute -top-0.5 -bottom-0.5 w-px bg-axis" style={{ left: '50%' }} />}<i className="absolute top-0 h-full rounded-[3px]" style={{ left: `${left}%`, width: `${Math.max(w, 0.5)}%`, background: it.color ?? (it.value >= 0 ? 'var(--color-s1)' : 'var(--color-s8)') }} /></span>
            <span className="text-right tabular-nums">{format(it.value)}</span>
          </div>
        )
      })}
    </div>
  )
}
