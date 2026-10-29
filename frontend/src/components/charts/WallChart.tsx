/** Стена реинвестирования: доля MV по месяцам (столбцы) + накопительная доля (линия), одна ось в %. */
import type { WallItem } from '../../api/types'
import { fmt } from '../../lib/format'
import { cn, empty, legend, legendKey, legendKeyRect } from '../../lib/ui'
import { TipR, TipT, useSvgTip } from './useSvgTip'

export function WallChart({ items, total }: { items: WallItem[]; total: number }) {
  const { show, hide, node } = useSvgTip()
  if (!items.length) return <div className={empty}>В горизонте нет погашений и оферт</div>
  const width = 760, height = 240, ml = 44, mr = 16, mt = 16, mb = 30
  const n = items.length
  const slot = (width - ml - mr) / n
  const barW = Math.min(24, slot - 2)
  const shares = items.map((i) => (i.mv_rub / (total || 1)) * 100)
  const maxY = Math.max(10, Math.ceil(Math.max(...items.map((i) => i.cumulative_pct), ...shares) / 10) * 10)
  const Y = (v: number) => mt + (1 - v / maxY) * (height - mt - mb)
  const X = (i: number) => ml + slot * i + slot / 2
  const ticks = [0, maxY / 4, maxY / 2, (3 * maxY) / 4, maxY]
  const line = items.map((it, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(it.cumulative_pct).toFixed(1)}`).join(' ')
  return (
    <div className="chart relative">
      <div className={cn(legend, 'mb-1.5')}><span><i className={legendKeyRect} style={{ background: 'var(--color-s1)' }} /> доля месяца, %</span><span><i className={legendKey} style={{ background: 'var(--color-s2)' }} /> накопительно, %</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Стена реинвестирования">
        {ticks.map((t) => <g key={t}><line x1={ml} x2={width - mr} y1={Y(t)} y2={Y(t)} stroke="var(--color-grid)" /><text x={ml - 6} y={Y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{fmt.int(t)}</text></g>)}
        {items.map((it, i) => {
          const h = Math.max(0, Y(0) - Y(shares[i]))
          return (
            <g key={it.month} onMouseMove={(e) => show(e, <><TipT>{fmt.month(it.month)} · {it.bonds}</TipT><TipR label={<>к погашению</>} value={<>{fmt.compact(it.mv_rub)}</>} /><TipR label={<>доля / накопительно</>} value={<>{fmt.pct(shares[i], 1)} / {fmt.pct(it.cumulative_pct, 1)}</>} /></>)} onMouseLeave={hide}>
              <rect x={X(i) - slot / 2} y={mt} width={slot} height={height - mt - mb} fill="transparent" />
              <path d={`M${X(i) - barW / 2},${Y(0)} v-${Math.max(0, h - 4)} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 v${Math.max(0, h - 4)} z`} fill="var(--color-s1)" />
              <text x={X(i)} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{fmt.month(it.month)}</text>
            </g>
          )
        })}
        <path d={line} fill="none" stroke="var(--color-s2)" strokeWidth={2} strokeLinejoin="round" />
        {items.map((it, i) => <circle key={it.month} cx={X(i)} cy={Y(it.cumulative_pct)} r={4} fill="var(--color-s2)" stroke="var(--color-surface)" strokeWidth={2} />)}
        <text x={X(n - 1) + 8} y={Y(items[n - 1].cumulative_pct) + 4} fontSize={12} fill="var(--color-text)">{fmt.pct(items[n - 1].cumulative_pct, 1)}</text>
      </svg>
      {node}
    </div>
  )
}
