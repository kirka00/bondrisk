/** Кривая бескупонной доходности по сроку: линия 2px, узлы ≥8px с кольцом, до двух серий. */
import { fmt } from '../../lib/format'
import { empty } from '../../lib/ui'
import { TipR, TipT, useSvgTip } from './useSvgTip'

export interface CurveSeries { name: string; color: string; points: { tenor_years: number; rate_pct: number }[] }
export function CurveChart({ series, height = 260 }: { series: CurveSeries[]; height?: number }) {
  const { show, hide, node } = useSvgTip()
  const width = 760, ml = 46, mr = 16, mt = 12, mb = 28
  const all = series.flatMap((s) => s.points)
  if (!all.length) return <div className={empty}>Нет данных кривой</div>
  const xs = all.map((p) => p.tenor_years), ys = all.map((p) => p.rate_pct)
  const xmin = 0, xmax = Math.max(...xs)
  const ymin = Math.floor(Math.min(...ys) - 0.5), ymax = Math.ceil(Math.max(...ys) + 0.5)
  const X = (t: number) => ml + ((t - xmin) / (xmax - xmin || 1)) * (width - ml - mr)
  const Y = (r: number) => mt + (1 - (r - ymin) / (ymax - ymin || 1)) * (height - mt - mb)
  const yticks = Array.from({ length: 5 }, (_, i) => ymin + ((ymax - ymin) * i) / 4)
  const xticks = [0.25, 1, 2, 3, 5, 7, 10, 15, 20].filter((t) => t <= xmax)
  return (
    <div className="chart relative">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Кривая доходности">
        {yticks.map((t) => <g key={t}><line x1={ml} x2={width - mr} y1={Y(t)} y2={Y(t)} stroke="var(--color-grid)" /><text x={ml - 6} y={Y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{fmt.num(t, 1)}</text></g>)}
        {xticks.map((t) => <text key={t} x={X(t)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{t < 1 ? `${t * 12}м` : `${t}л`}</text>)}
        <line x1={ml} x2={width - mr} y1={height - mb} y2={height - mb} stroke="var(--color-axis)" />
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.tenor_years - b.tenor_years)
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.tenor_years).toFixed(1)},${Y(p.rate_pct).toFixed(1)}`).join(' ')
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {pts.map((p) => (
                <circle key={p.tenor_years} cx={X(p.tenor_years)} cy={Y(p.rate_pct)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} style={{ cursor: 'default' }}
                  onMouseMove={(e) => show(e, <><TipT>{s.name} · {p.tenor_years < 1 ? `${p.tenor_years * 12} мес.` : `${p.tenor_years} лет`}</TipT><TipR label={<>ставка</>} value={<>{fmt.pct(p.rate_pct)}</>} /></>)} onMouseLeave={hide} />
              ))}
              {pts.map((p) => <circle key={`h${p.tenor_years}`} cx={X(p.tenor_years)} cy={Y(p.rate_pct)} r={12} fill="transparent" onMouseMove={(e) => show(e, <><TipT>{s.name} · {p.tenor_years < 1 ? `${p.tenor_years * 12} мес.` : `${p.tenor_years} лет`}</TipT><TipR label={<>ставка</>} value={<>{fmt.pct(p.rate_pct)}</>} /></>)} onMouseLeave={hide} />)}
            </g>
          )
        })}
      </svg>
      {node}
    </div>
  )
}
