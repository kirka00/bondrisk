import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBond, useBondMetrics, useBondPrices, useBondRatings, useSchedule } from '../../api/hooks'
import { useIsMobile } from '../../app/media'
import { useScope } from '../../app/scope'
import { ScheduleTimeline } from '../../components/charts/ScheduleTimeline'
import { TvChart, type TvSeries } from '../../components/charts/TvChart'
import { Card } from '../../components/ui/Card'
import { InfoButton } from '../../components/ui/InfoButton'
import { EmptyState, ErrorBanner } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { addMonths, todayISO } from '../../lib/dates'
import { Tip } from '../../components/ui/Tooltip'
import { curSign, fmt, issuerShort, labels } from '../../lib/format'
import { badge, button, chip, cn, gridKpi, pageHead, pageSub, tableWrap, tableWrapFlat, tbl, tile, tileLabel, tileSub, tileValue } from '../../lib/ui'

export function BondPage() {
  const id = Number(useParams().id)
  const { asOf, dataEnd } = useScope()
  const mobile = useIsMobile()
  const bond = useBond(id)
  const m = useBondMetrics(id, asOf)
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day')
  const to = useMemo(() => dataEnd ?? asOf ?? todayISO(), [dataEnd, asOf])
  const from = useMemo(() => addMonths(to, -60), [to])
  const prices = useBondPrices(id, from, to, bucket)
  const sched = useSchedule(id)
  const ratings = useBondRatings(id)

  const series = useMemo<TvSeries[]>(() => {
    const pts = (prices.data ?? []).filter((p) => p.close_pct != null)
    const s: TvSeries[] = [
      { id: 'price', name: 'Цена, % номинала', color: 's1', kind: 'area', data: pts.map((p) => ({ time: p.ts, value: p.close_pct as number })), precision: 2, unit: '%' },
      { id: 'ytm', name: 'Доходность, %', color: 's3', kind: 'line', data: pts.filter((p) => p.yield_close != null).map((p) => ({ time: p.ts, value: p.yield_close as number })), precision: 2, unit: '%', pane: 1 },
    ]
    if (bucket === 'day') s.push({ id: 'vol', name: 'Объём, ₽', color: 'muted', kind: 'histogram', data: pts.filter((p) => p.volume != null).map((p) => ({ time: p.ts, value: p.volume as number })), precision: 0, format: (v) => fmt.compact(v), pane: 2 })
    return s
  }, [prices.data, bucket])
  // доли высоты панелей: цена · доходность · объём
  const paneHeights = useMemo(() => (bucket === 'day' ? [5, 2.6, 1.4] : [5, 2.6]), [bucket])

  if (!Number.isInteger(id) || id <= 0) return <EmptyState title="Выпуск не найден" hint="в адресе нет корректного номера выпуска" action={<Link className={button({ size: 'sm' })} to={{ pathname: '/bonds', search: location.search }}>К справочнику →</Link>} />
  if (bond.isError) return <ErrorBanner error={bond.error} />
  const b = bond.data
  const mt = m.data
  if (!b) return <div className="text-muted">Загрузка…</div>
  // цена есть, а доходности нет: погашение не позже даты расчётов T+2 или корень вне −50…500 % (дефолт, дистресс)
  const ytmNote = mt?.clean_price_pct != null && mt.ytm_pct == null
    ? (asOf && (Date.parse(b.maturity_date) - Date.parse(asOf)) / 86400000 <= 4 ? 'не определена: погашение до даты расчётов' : 'не определена: вне −50…500 % при такой цене')
    : null
  return (
    <div className="flex flex-col gap-4">
      <div className={pageHead}>
        <div>
          <div className="row flex items-center gap-2"><Link to={{ pathname: '/bonds', search: location.search }} className="text-muted text-xs">← все выпуски</Link></div>
          <h1 className="flex items-baseline gap-2 flex-wrap">{b.short_name} <span className="font-mono text-sm font-normal text-muted">{b.isin}</span></h1>
          <div className={pageSub}><Tip content={b.issuer_name}><span>{issuerShort(b.issuer_name, 48)}</span></Tip> · {b.sector}{b.is_sovereign ? ' · суверенный' : ''}</div>
        </div>
        <div className="row flex items-center gap-2 flex-wrap">
          <span className={chip}>{b.currency} · номинал {fmt.num(b.face_value_initial, 0)}</span>
          <span className={chip}>{labels.coupon[b.coupon_type]}{b.coupon_rate_pct != null ? ` ${fmt.pct(b.coupon_rate_pct)}` : ''}{b.coupon_freq ? `, ${b.coupon_freq}/год` : ''}</span>
          <span className={chip}>погашение {fmt.date(b.maturity_date)}</span>
          {b.offer_date && <span className={chip}>оферта {fmt.date(b.offer_date)}</span>}
          {b.is_amortizing && <span className={chip}>амортизация</span>}
          <span className={badge({ status: 'info' })}>{b.rating_grade ?? 'NR'}{b.rating_source ? ` · ${labels.ratingSource[b.rating_source]}` : ''}{b.rating_agency ? ` (${b.rating_agency})` : ''}</span>
        </div>
      </div>

      {m.isError && <ErrorBanner error={m.error} />}
      <div className={gridKpi}>
        <Kpi label="Чистая цена" value={mt?.clean_price_pct != null ? `${fmt.num(mt.clean_price_pct)} %` : '—'} sub={mt?.price_date ? `на ${fmt.date(mt.price_date)}${asOf && mt.price_date < asOf ? ' (locf)' : ''}` : 'нет котировки за 90 дней'} testId="kpi-price" />
        <Kpi label="НКД" value={fmt.num(mt?.accrued_interest)} sub={`грязная цена ${fmt.num(mt?.dirty_price)} ${curSign(b.currency)}`} k="ai" />
        <Kpi label="YTM" value={fmt.pct(mt?.ytm_pct)} sub={ytmNote ?? `текущая ${fmt.pct(mt?.current_yield_pct)}`} k="ytm" />
        <Kpi label="Дюрация Маколея" value={fmt.years(mt?.duration_mac)} sub={`модиф. ${fmt.num(mt?.duration_mod, 3)}`} k="dmac" vals={{ dmac: mt?.duration_mac, dmod: mt?.duration_mod, y: mt?.ytm_pct }} />
        <Kpi label="Конвексность" value={fmt.num(mt?.convexity, 2)} k="convexity" />
        <Kpi label="DV01 на бумагу" value={`${fmt.num(mt?.dv01_local, 4)} ${curSign(b.currency)}`} k="dv01" vals={{ mv: mt?.dirty_price, dmod: mt?.duration_mod, dv01: mt?.dv01_local }} />
        <Kpi label="G-спред" value={fmt.bp(mt?.g_spread_bp)} sub={`КБД ${fmt.pct(mt?.curve_rate_pct)}`} k="gspread" vals={{ ytm: mt?.ytm_pct, curve: mt?.curve_rate_pct, g: mt?.g_spread_bp }} />
        <Kpi label="Остаток номинала" value={fmt.num(mt?.face_current)} sub={labels.bondStatus[b.status] ?? b.status} />
      </div>

      <Card title="Цена и доходность" hint="история котировок MOEX: цена, доходность и объём торгов" actions={<Segmented value={bucket} onChange={setBucket} options={[{ value: 'day', label: 'день' }, { value: 'week', label: 'неделя' }, { value: 'month', label: 'месяц' }]} ariaLabel="Агрегация" />}>
        <TvChart series={series} height={mobile ? 340 : bucket === 'day' ? 480 : 400} paneHeights={paneHeights} loading={prices.isFetching} defaultRange="1Y" testId="bond-chart" />
      </Card>

      <div className="grid gap-4 grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] max-lg:grid-cols-1">
        <Card title="График платежей" hint="купоны и погашения на одну бумагу">
          {sched.data ? <ScheduleTimeline rows={sched.data} asOf={asOf} /> : <EmptyState title="Загрузка…" />}
          {sched.data && sched.data.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="text-text-2 text-xs" style={{ cursor: 'pointer' }}>таблица ({sched.data.length} строк)</summary>
              <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 260 }}><table className={tbl}><thead><tr><th>Дата</th><th>Тип</th><th>Период</th><th className="text-right">Ставка</th><th className="text-right">Сумма</th><th className="text-right">Остаток</th></tr></thead>
                <tbody>{sched.data.map((r) => <tr key={r.flow_id}><td>{fmt.date(r.pay_date)}</td><td>{{ coupon: 'купон', amortization: 'амортизация', redemption: 'погашение', offer: 'оферта' }[r.flow_type]}</td><td className="text-muted">{r.period_start ? `${fmt.date(r.period_start)} – ${fmt.date(r.period_end)}` : ''}</td><td className="text-right tabular-nums">{fmt.pct(r.rate_pct)}</td><td className="text-right tabular-nums">{fmt.num(r.amount)}</td><td className="text-right tabular-nums">{fmt.num(r.face_value_after)}</td></tr>)}</tbody></table></div>
            </details>
          )}
        </Card>
        <Card title="История рейтингов" hint="выпуск и эмитент, по агентствам">
          {ratings.data?.length ? (
            <div className="flex flex-col gap-1.5">
              {ratings.data.map((r) => (
                <div key={r.rating_id} className="grid grid-cols-[78px_44px_1fr] gap-2 items-baseline text-[13px] py-1.5 border-t border-border first:border-t-0">
                  <span className="text-muted">{fmt.date(r.assigned_on)}</span>
                  <span className="font-semibold tabular-nums">{r.grade}</span>
                  <span>{arrow(r.action)} {labels.action[r.action] ?? r.action} · {r.agency_name} · {r.scope === 'issue' ? 'выпуск' : 'эмитент'}{r.outlook ? ` · прогноз ${r.outlook.toLowerCase()}` : ''}{r.status !== 'active' && <span className={cn(chip, 'ml-1.5')}>{labels.ratingStatus[r.status] ?? r.status}</span>}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Рейтингов нет" hint={b.is_sovereign ? 'суверенный выпуск считается AAA' : 'бумага без публичного рейтинга'} />}
        </Card>
      </div>
    </div>
  )
}

function arrow(action: string) {
  return action === 'upgraded' ? <span className="text-good-text">▲</span> : action === 'downgraded' ? <span className="text-bad-text">▼</span> : action === 'withdrawn' ? '✕' : '•'
}

function Kpi({ label, value, sub, k, vals, testId }: { label: string; value: string; sub?: string; k?: Parameters<typeof InfoButton>[0]['k']; vals?: Record<string, number | string | null | undefined>; testId?: string }) {
  return (
    <div className={tile} data-testid={testId ?? 'kpi-tile'}>
      <div className={tileLabel}><span>{label}</span>{k && <InfoButton k={k} values={vals} />}</div>
      <div className={cn(tileValue, value === '—' && 'text-muted font-medium')}>{value}</div>
      <div className={tileSub}><span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{sub ?? ''}</span></div>
    </div>
  )
}
