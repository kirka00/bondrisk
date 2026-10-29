/** Таймлайн платежей выпуска от даты оценки: купоны (slot 1) и тело (slot 2); последний прошедший купон — серым. */
import type { ScheduleRow } from '../../api/types'
import { countOf, fmt } from '../../lib/format'
import { empty, legend, legendKey, legendKeyRect } from '../../lib/ui'
import { TipR, TipT, useSvgTip } from './useSvgTip'

const MONTH = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function ScheduleTimeline({ rows, asOf }: { rows: ScheduleRow[]; asOf?: string }) {
  const { show, hide, node } = useSvgTip()
  const all = rows.filter((r) => r.flow_type !== 'offer' && r.amount != null).sort((a, b) => a.pay_date.localeCompare(b.pay_date))
  const asOfT = Date.parse(asOf ?? '1970-01-01')
  const future = all.filter((r) => Date.parse(r.pay_date) > asOfT)
  const lastPast = all.filter((r) => Date.parse(r.pay_date) <= asOfT).at(-1)
  const flows = lastPast ? [lastPast, ...future] : future
  if (!flows.length) return <div className={empty}>Будущих платежей нет</div>
  const width = 760, height = 200, ml = 48, mr = 16, mt = 18, mb = 30
  const times = flows.map((r) => Date.parse(r.pay_date))
  const span0 = Math.min(...times, asOfT), span1 = Math.max(...times)
  const padT = Math.max((span1 - span0) * 0.04, 86400000 * 10)
  const t0 = span0 - padT, t1 = span1 + padT
  // Шкала — по купонам и амортизации. Погашение в разы больше купона: в общей шкале купоны превращаются
  // в полоски у нуля, поэтому такой столбик обрезается сверху (с разрывом) и подписывается суммой.
  const finalBody = flows.filter((r) => r.flow_type === 'redemption').at(-1)
  const restMax = Math.max(0, ...flows.filter((r) => r !== finalBody).map((r) => r.amount ?? 0))
  const clipBody = !!finalBody && restMax > 0 && (finalBody.amount ?? 0) > restMax * 4
  const maxV = clipBody ? restMax * 1.25 : Math.max(...flows.map((r) => r.amount ?? 0))
  const X = (t: number) => ml + ((t - t0) / (t1 - t0 || 1)) * (width - ml - mr)
  const Y = (v: number) => Math.max(mt, mt + (1 - v / (maxV || 1)) * (height - mt - mb))
  const yTicks = [0, maxV / 2, maxV].map((v) => Number(v.toPrecision(2)))
  const offers = rows.filter((r) => r.flow_type === 'offer' && Date.parse(r.pay_date) > asOfT)
  // ось: годы, если диапазон > 2 лет, иначе кварталы
  const years = (t1 - t0) / (365.25 * 86400000)
  const ticks: { t: number; label: string }[] = []
  const d0 = new Date(t0)
  if (years > 2.5) {
    for (let y = d0.getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) ticks.push({ t: Date.UTC(y, 0, 1), label: String(y) })
  } else {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), Math.floor(d0.getUTCMonth() / 3) * 3 + 3, 1))
    while (d.getTime() <= t1) { ticks.push({ t: d.getTime(), label: `${MONTH[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }); d.setUTCMonth(d.getUTCMonth() + 3) }
  }
  const nextCoupon = future.find((r) => r.flow_type === 'coupon')
  const maturity = future.filter((r) => r.flow_type === 'redemption').at(-1)
  const bodySum = future.filter((r) => r.flow_type !== 'coupon').reduce((s, r) => s + (r.amount ?? 0), 0)
  const kind = (r: ScheduleRow) => (r.flow_type === 'coupon' ? 'купон' : r.flow_type === 'amortization' ? 'амортизация' : 'погашение')
  const coupons = future.filter((r) => r.flow_type === 'coupon')
  const sumCoupons = coupons.reduce((s, r) => s + (r.amount ?? 0), 0)
  return (
    <div className="chart relative" data-testid="schedule-timeline">
      <div className="flex items-center flex-wrap justify-between gap-2 mb-1.5">
        <div className={legend}><span><i className={legendKeyRect} style={{ background: 'var(--color-s1)' }} /> купон</span><span><i className={legendKeyRect} style={{ background: 'var(--color-s2)' }} /> тело</span>{offers.length > 0 && <span><i className={legendKey} style={{ background: 'var(--color-s7)' }} /> оферта</span>}</div>
        <span className="text-muted text-xs">{countOf(coupons.length, ['купон', 'купона', 'купонов'])} на {fmt.num(sumCoupons)} + номинал {fmt.num(bodySum, 0)}</span>
      </div>
      {nextCoupon && <div className="text-xs text-text-2 mb-1">ближайший купон — <b className="font-semibold text-text tabular-nums">{fmt.num(nextCoupon.amount)}</b> {fmt.date(nextCoupon.pay_date)}{nextCoupon.rate_pct != null ? ` (${fmt.pct(nextCoupon.rate_pct)} годовых)` : ''}</div>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="График платежей">
        {yTicks.map((v) => <g key={v}><line x1={ml} x2={width - mr} y1={Y(v)} y2={Y(v)} stroke={v ? 'var(--color-grid)' : 'var(--color-axis)'} /><text x={ml - 6} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{fmt.num(v, v >= 100 ? 0 : 1)}</text></g>)}
        {ticks.map((tk) => <g key={tk.t}><line x1={X(tk.t)} x2={X(tk.t)} y1={height - mb} y2={height - mb + 4} stroke="var(--color-axis)" /><text x={X(tk.t)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{tk.label}</text></g>)}
        {asOf && <g><line x1={X(asOfT)} x2={X(asOfT)} y1={mt - 6} y2={height - mb} stroke="var(--color-axis)" strokeDasharray="3 3" /><text x={X(asOfT) + 4} y={mt - 6} fontSize={10} fill="var(--color-muted)">дата оценки</text></g>}
        {offers.map((o) => <line key={o.flow_id} x1={X(Date.parse(o.pay_date))} x2={X(Date.parse(o.pay_date))} y1={mt} y2={height - mb} stroke="var(--color-s7)" strokeWidth={2} onMouseMove={(e) => show(e, <><TipT>оферта</TipT><b>{fmt.date(o.pay_date)}</b></>)} onMouseLeave={hide} />)}
        {flows.map((r) => {
          const x = X(Date.parse(r.pay_date)), y = Y(r.amount ?? 0)
          const isBody = r.flow_type !== 'coupon'
          const past = Date.parse(r.pay_date) <= asOfT
          const w = isBody ? 8 : Math.max(3, Math.min(10, (width - ml - mr) / Math.max(12, flows.length) - 2))
          return (
            <g key={r.flow_id} onMouseMove={(e) => show(e, <><TipT>{fmt.date(r.pay_date)} · {kind(r)}{past ? ' · выплачен' : ''}</TipT><TipR label={<>сумма на бумагу</>} value={<>{fmt.num(r.amount)}</>} />{r.rate_pct != null && <TipR label={<>ставка</>} value={<>{fmt.pct(r.rate_pct)}</>} />}{r.face_value_after != null && isBody && <TipR label={<>остаток номинала</>} value={<>{fmt.num(r.face_value_after)}</>} />}</>)} onMouseLeave={hide}>
              <rect x={x - 8} y={mt} width={16} height={height - mt - mb} fill="transparent" />
              <rect x={x - w / 2} y={y} width={w} height={Math.max(1, height - mb - y)} rx={2} fill={past ? 'var(--color-axis)' : isBody ? 'var(--color-s2)' : 'var(--color-s1)'} />
              {clipBody && r === finalBody && <path d={`M${x - w / 2 - 2},${mt + 14} l${w + 4},-5 M${x - w / 2 - 2},${mt + 19} l${w + 4},-5`} stroke="var(--color-surface)" strokeWidth={2} />}
            </g>
          )
        })}
        {maturity && <text x={X(Date.parse(maturity.pay_date)) - 10} y={Y(maturity.amount ?? 0) + 11} textAnchor="end" fontSize={11} fill="var(--color-text)">погашение {fmt.num(maturity.amount, 0)} · {fmt.date(maturity.pay_date)}</text>}
      </svg>
      {node}
    </div>
  )
}
