/** Дот-плот G-спредов: включённые бумаги — заливка, исключённые — контур; среднее — вертикальная линия. */
import type { SpreadRow } from '../../api/types'
import { fmt } from '../../lib/format'
import { empty } from '../../lib/ui'
import { TipR, TipT, useSvgTip } from './useSvgTip'

export function SpreadDotPlot({ items, avg }: { items: SpreadRow[]; avg: number | null }) {
  const { show, hide, node } = useSvgTip()
  const rows = [...items].filter((i) => i.g_spread_bp != null).sort((a, b) => (b.g_spread_bp ?? 0) - (a.g_spread_bp ?? 0))
  if (!rows.length) return <div className={empty}>Нет спредов (нет рублёвых фиксированных бумаг или кривой)</div>
  const width = 760, ml = 130, mr = 20, rowH = 22, mt = 20, mb = 18
  const vals = rows.map((r) => r.g_spread_bp ?? 0)
  const min = Math.min(0, ...vals, avg ?? 0), max = Math.max(...vals, avg ?? 0) * 1.05 + 10
  const X = (v: number) => ml + ((v - min) / (max - min || 1)) * (width - ml - mr)
  const h = mt + rows.length * rowH + mb
  const ticks = niceTicks(min, max, 6)
  return (
    <div className="chart relative">
      <svg viewBox={`0 0 ${width} ${h}`} width="100%" height={h} role="img" aria-label="G-спреды бумаг">
        {ticks.map((t) => <g key={t}><line x1={X(t)} x2={X(t)} y1={mt - 4} y2={h - mb} stroke="var(--color-grid)" /><text x={X(t)} y={10} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{fmt.int(t)}</text></g>)}
        {avg != null && <g><line x1={X(avg)} x2={X(avg)} y1={mt - 4} y2={h - mb} stroke="var(--color-s2)" strokeWidth={2} /><text x={X(avg) + 6} y={h - mb - 4} fontSize={11} fill="var(--color-text-2)">среднее {fmt.bp(avg)}</text></g>}
        {rows.map((r, i) => {
          const y = mt + i * rowH + rowH / 2
          const v = r.g_spread_bp ?? 0
          return (
            <g key={r.bond_id} onMouseMove={(e) => show(e, <><TipT>{r.short_name} · {r.rating_grade ?? 'NR'}</TipT><TipR label={<>G-спред</>} value={<>{fmt.bp(v)}</>} /><TipR label={<>YTM / КБД</>} value={<>{fmt.pct(r.ytm_pct)} / {fmt.pct(r.curve_rate_pct)}</>} />{!r.included && <TipR label={<>исключена</>} value={<>{r.exclusion_reason}</>} />}</>)} onMouseLeave={hide}>
              <rect x={0} y={y - rowH / 2} width={width} height={rowH} fill="transparent" />
              <text x={ml - 10} y={y + 4} textAnchor="end" fontSize={12} fill={r.included ? 'var(--color-text-2)' : 'var(--color-muted)'}>{r.short_name}</text>
              <line x1={X(Math.min(0, v))} x2={X(Math.max(0, v))} y1={y} y2={y} stroke="var(--color-grid)" />
              <circle cx={X(v)} cy={y} r={5} fill={r.included ? 'var(--color-s1)' : 'var(--color-surface)'} stroke={r.included ? 'var(--color-surface)' : 'var(--color-muted)'} strokeWidth={2} />
            </g>
          )
        })}
      </svg>
      {node}
    </div>
  )
}

export function niceTicks(min: number, max: number, n: number): number[] {
  const span = max - min || 1
  const raw = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max; v += step) out.push(Number(v.toFixed(6)))
  return out
}
