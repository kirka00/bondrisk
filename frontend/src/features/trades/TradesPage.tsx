import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useBondMetrics, useExecuteTrade, usePreviewTrade, useTrades } from '../../api/hooks'
import type { Bond, Page, Preview, Trade, TradeSide } from '../../api/types'
import { Link, useSearchParams } from 'react-router-dom'
import { useScope } from '../../app/scope'
import { SectionTabs } from '../../components/layout/SectionTabs'
import { Button } from '../../components/ui/Button'
import { Combobox, type ComboItem } from '../../components/ui/Combobox'
import { DataTable } from '../../components/ui/DataTable'
import { Dialog } from '../../components/ui/Dialog'
import { Meter } from '../../components/ui/Meter'
import { Delta, EmptyState, ErrorBanner, Pager, errorText } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/Toast'
import { Tip } from '../../components/ui/Tooltip'
import { addMonths } from '../../lib/dates'
import { countOf, fmt, issuerShort, labels, parseNum } from '../../lib/format'
import { badge, banner, button, cap, cellSub, chip, cn, dialogActions, field, grid2, input, kv, mcardHead, mcardKv, mcardSub, pageHead, pageSub, tableWrap, tableWrapFlat, tbl } from '../../lib/ui'

const LIMIT = 50
type Period = 'all' | '1m' | '3m' | '1y' | 'custom'
const PERIODS: { value: Period; label: string }[] = [{ value: 'all', label: 'всё время' }, { value: '1m', label: 'месяц' }, { value: '3m', label: '3 мес.' }, { value: '1y', label: 'год' }, { value: 'custom', label: 'период…' }]
const sideLabel = (s: string) => s === 'buy' ? <span className="text-good-text font-medium">Покупка</span> : <span className="text-bad-text font-medium">Продажа</span>

/** Рабочих дней между датой сделки и датой расчётов (выходные не считаются, §20.1). */
function businessDays(from: string, to: string): number {
  let n = 0
  const d = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`)
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) n++ }
  return Math.min(n, 10)
}

export function TradesPage() {
  const { portfolio, portfolioId, canTrade, asOf, dataEnd } = useScope()
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [sel, setSel] = useState<Trade | null>(null)
  const [sp, setSp] = useSearchParams()
  // ссылка «открыть сделку по бумаге»: параметр читается один раз и убирается из адреса, иначе навигация
  // (ссылки сохраняют query) открывала бы диалог снова
  const [deep] = useState(() => sp.get('new_trade'))
  const [open, setOpen] = useState(!!deep)
  useEffect(() => { if (sp.has('new_trade')) setSp((p) => { const n = new URLSearchParams(p); n.delete('new_trade'); return n }, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const end = asOf ?? dataEnd
  const months = { '1m': 1, '3m': 3, '1y': 12 } as Record<Period, number>
  const dateFrom = period === 'custom' ? from || undefined : months[period] && end ? addMonths(end, -months[period]) : undefined
  const dateTo = period === 'custom' ? to || undefined : undefined
  const q = useTrades(portfolioId, { side: side === 'all' ? undefined : side, date_from: dateFrom, date_to: dateTo, limit: LIMIT, offset, sort: 'trade_date', order: 'desc' })
  const items = q.data?.items ?? []
  const anyFee = items.some((t) => t.fee !== 0)
  // сортировка заголовком отключена: сервер отдаёт страницы по 50, а клиентская сортировка упорядочила бы только текущую
  const columns = useMemo<ColumnDef<Trade, unknown>[]>(() => ([
    { header: 'Дата', accessorKey: 'trade_date', cell: ({ row }) => <span>{fmt.date(row.original.trade_date)}<span className={cellSub}>расчёты {fmt.date(row.original.settlement_date)}</span></span> },
    { header: 'Бумага', accessorKey: 'short_name', cell: ({ row: { original: t } }) => <span><span className="font-medium">{t.short_name}</span>{t.currency !== 'RUB' && <span className={cn(chip, 'ml-1.5')}>{t.currency}</span>}<span className={cellSub}>{issuerShort(t.issuer_name, 32)}</span></span> },
    { header: 'Сторона', accessorKey: 'side', cell: ({ row: { original: t } }) => <span className="inline-flex items-center gap-1.5">{sideLabel(t.side)}{t.status !== 'settled' && <span className={badge({ status: t.status === 'cancelled' ? 'na' : 'info' })}>{labels.tradeStatus[t.status] ?? t.status}</span>}</span> },
    { header: 'Кол-во', accessorKey: 'qty', meta: { align: 'right' }, cell: ({ getValue }) => fmt.int(getValue<number>()) },
    { header: 'Цена, %', accessorKey: 'clean_price_pct', meta: { align: 'right' }, cell: ({ getValue }) => fmt.num(getValue<number>()) },
    { header: 'НКД', accessorKey: 'accrued_interest', meta: { align: 'right' }, cell: ({ getValue }) => fmt.num(getValue<number>()) },
    { header: 'Сумма', accessorKey: 'amount', meta: { align: 'right' }, cell: ({ row }) => <span className="font-medium">{fmt.money(row.original.amount, row.original.currency)}</span> },
    // у портфелей, собранных из состава индекса (BOND, RUCB…), сделки учётные — комиссии нет; колонку нулей не показываем
    ...(anyFee ? [{ header: 'Комиссия', accessorKey: 'fee', meta: { align: 'right' }, cell: ({ row }) => <span className="text-text-2">{row.original.fee ? fmt.money(row.original.fee, row.original.currency) : '—'}</span> } as ColumnDef<Trade, unknown>] : []),
  ] as ColumnDef<Trade, unknown>[]).map((c) => ({ ...c, enableSorting: false })), [anyFee])
  if (!portfolio) return <EmptyState title="Нет портфелей" />
  const reset = () => setOffset(0)
  return (
    <div className="flex flex-col gap-3">
      <div className={pageHead}>
        <div><h1>Портфель — {portfolio.name}</h1><div className={pageSub}>{q.data ? countOf(q.data.total, ['сделка', 'сделки', 'сделок']) : '…'}{period !== 'all' && dateFrom ? ` с ${fmt.date(dateFrom)}${dateTo ? ` по ${fmt.date(dateTo)}` : ''}` : ''}</div></div>
        <div className="row flex items-center gap-2">
          {canTrade ? <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-trade">Новая сделка</Button> : <Tip content="Сделки совершает трейдер или администратор — выберите пользователя в шапке"><span className="text-muted text-xs">сделки — у трейдера</span></Tip>}
        </div>
      </div>
      <SectionTabs>
        <Segmented value={side} onChange={(v) => { setSide(v); reset() }} options={[{ value: 'all', label: 'все' }, { value: 'buy', label: 'покупки' }, { value: 'sell', label: 'продажи' }]} ariaLabel="Сторона" testId="trade-side-filter" />
        <Segmented value={period} onChange={(v) => { setPeriod(v); reset() }} options={PERIODS} ariaLabel="Период" testId="trade-period" />
        {period === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs text-muted max-md:w-full">
            с <input type="date" className={cn(input(), 'max-md:flex-1')} value={from} max={to || end} onChange={(e) => { setFrom(e.target.value); reset() }} aria-label="С даты" />
            по <input type="date" className={cn(input(), 'max-md:flex-1')} value={to} min={from} max={end} onChange={(e) => { setTo(e.target.value); reset() }} aria-label="По дату" />
          </span>
        )}
      </SectionTabs>
      <ErrorBanner error={q.error} />
      <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
        <DataTable data={items} columns={columns} getRowId={(r) => String(r.trade_id)} onRowClick={setSel} emptyText={period === 'all' && side === 'all' ? 'Сделок нет' : 'Сделок по выбранным фильтрам нет'} dense testId="trades-table"
          mobileCard={(t) => (
            <>
              <div className={mcardHead}><b>{t.short_name}</b><span className="tabular-nums font-medium">{fmt.money(t.amount, t.currency)}</span></div>
              <div className={mcardSub}>{sideLabel(t.side)}<span>· {fmt.date(t.trade_date)}</span><span className="text-muted">{issuerShort(t.issuer_name, 24)}</span></div>
              <div className={mcardKv}>
                <span><span className="k">Кол-во</span><span className="v">{fmt.int(t.qty)}</span></span>
                <span><span className="k">Цена, %</span><span className="v">{fmt.num(t.clean_price_pct)}</span></span>
                <span><span className="k">НКД</span><span className="v">{fmt.num(t.accrued_interest)}</span></span>
              </div>
            </>
          )} />
      </div>
      {q.data && q.data.total > LIMIT && <Pager total={q.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      <Dialog open={!!sel} onOpenChange={(o) => { if (!o) setSel(null) }} title={sel ? `Сделка #${sel.trade_id}` : ''} sheet>
        {sel && <TradeSheet t={sel} />}
      </Dialog>
      <NewTradeDialog open={open} onOpenChange={setOpen} initialBondId={deep ? Number(deep) : undefined} />
    </div>
  )
}

function TradeSheet({ t }: { t: Trade }) {
  return (
    <div className="flex flex-col gap-3" data-testid="trade-sheet">
      <div className="flex items-center gap-2 flex-wrap">{sideLabel(t.side)}<span className="font-medium">{t.short_name}</span><span className="font-mono text-[12.5px] text-muted">{t.isin}</span></div>
      <p className="text-text-2">{t.issuer_name}</p>
      <dl className={kv}>
        <dt>Дата сделки</dt><dd>{fmt.date(t.trade_date)}</dd>
        <dt>Дата расчётов</dt><dd>{fmt.date(t.settlement_date)}</dd>
        <dt>Количество</dt><dd>{fmt.int(t.qty)} шт.</dd>
        <dt>Чистая цена</dt><dd>{fmt.num(t.clean_price_pct)} %</dd>
        <dt>НКД на бумагу</dt><dd>{fmt.num(t.accrued_interest)}</dd>
        <dt>Сумма</dt><dd>{fmt.money(t.amount, t.currency)}</dd>
        <dt>Комиссия</dt><dd>{t.fee ? fmt.money(t.fee, t.currency) : 'нет (учётная сделка)'}</dd>
        <dt>Контрагент</dt><dd>{t.counterparty ?? '—'}</dd>
        <dt>Статус</dt><dd>{labels.tradeStatus[t.status] ?? t.status}</dd>
        <dt>Внёс</dt><dd>{t.created_by_login ?? '—'} · {fmt.dateTime(t.created_at)}</dd>
      </dl>
      <Link className={button()} to={{ pathname: `/bonds/${t.bond_id}`, search: location.search }}>Открыть карточку выпуска →</Link>
    </div>
  )
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

export function NewTradeDialog({ open, onOpenChange, initialBondId }: { open: boolean; onOpenChange: (o: boolean) => void; initialBondId?: number }) {
  const { portfolioId, asOf, dataEnd, user } = useScope()
  const toast = useToast()
  const [bond, setBond] = useState<ComboItem | null>(null)
  const [side, setSide] = useState<TradeSide>('buy')
  const [qty, setQty] = useState('1000')
  const [price, setPrice] = useState<string | null>(null)   // null — поле не трогали, берётся рыночная цена
  const [date, setDate] = useState(asOf ?? dataEnd ?? '')
  const [tn, setTn] = useState('1')
  const [manual, setManual] = useState('')
  const [fee, setFee] = useState('0')
  const [check, setCheck] = useState(true)
  const metrics = useBondMetrics(bond?.id ?? null, date || undefined)
  const preview = usePreviewTrade(portfolioId)
  const exec = useExecuteTrade(portfolioId)
  const [pv, setPv] = useState<Preview | null>(null)

  useEffect(() => { if (open) { setDate(asOf ?? dataEnd ?? ''); exec.reset(); setPv(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!date && (asOf ?? dataEnd)) setDate(asOf ?? dataEnd ?? '') }, [asOf, dataEnd]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && initialBondId && !bond) api.get<Bond>(`/bonds/${initialBondId}`).then((b) => setBond({ id: b.bond_id, label: b.short_name, sub: `${b.isin} · ${b.issuer_name}` })).catch(() => undefined)
  }, [open, initialBondId]) // eslint-disable-line react-hooks/exhaustive-deps

  const search = (q: string) =>
    api.get<Page<Bond>>('/bonds', { q: q || undefined, status: 'trading', limit: 12, offset: 0 }).then((p) => p.items.map((b) => ({ id: b.bond_id, label: b.short_name, sub: `${b.isin} · ${issuerShort(b.issuer_name, 40)}` })))
  // §20: цена сделки и дата расчётов (T+0/1/2 или ручная — выходной переносится на понедельник) идут в оценку
  const dq = useDebounced({ bond: bond?.id, side, qty: parseNum(qty), date, price, tn, manual }, 400)
  useEffect(() => {
    if (!open || !dq.bond || !(dq.qty > 0)) { setPv(null); return }
    const pxN = dq.price != null && dq.price.trim() ? parseNum(dq.price) : undefined
    preview.mutate({ bond_id: dq.bond, side: dq.side, qty: dq.qty, as_of: dq.date || undefined, clean_price_pct: pxN && pxN > 0 ? pxN : undefined,
      settlement_days: dq.tn === 'manual' ? 1 : Number(dq.tn), settlement_date: dq.tn === 'manual' && dq.manual ? dq.manual : undefined }, { onSuccess: setPv })
  }, [dq.bond, dq.side, dq.qty, dq.date, dq.price, dq.tn, dq.manual, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const mkt = metrics.data?.clean_price_pct ?? null
  const effPrice = price ?? (mkt != null ? String(mkt) : '')
  const px = parseNum(effPrice), q = parseNum(qty), feeN = fee.trim() ? parseNum(fee) : 0
  const dev = mkt && px ? ((px - mkt) / mkt) * 100 : null
  const sum = q * (px / 100) * (metrics.data?.face_current ?? 1000)
  const blocked = check && !!pv?.blocked
  const hard = pv?.limits.filter((l) => l.blocks) ?? []

  const submit = () => {
    if (!bond) return
    exec.mutate({ bond_id: bond.id, side, qty: q, clean_price_pct: px, trade_date: date || undefined, settlement_days: tn === 'manual' ? businessDays(date, pv?.settlement_date ?? date) : Number(tn), fee: feeN, check_limits: check }, {
      onSuccess: (t) => { toast(`Сделка #${t.trade_id}: ${side === 'buy' ? 'куплено' : 'продано'} ${fmt.int(t.qty)} ${t.short_name} по ${fmt.num(t.clean_price_pct)} %`, 'success'); onOpenChange(false); setBond(null); setPrice(null) },
      onError: (e) => toast(errorText(e), 'error'),
    })
  }
  const metricLabel: Record<string, string> = { mv_net: 'MV нетто', mv_gross: 'MV брутто', dv01: 'DV01', cs01: 'CS01', adv01: 'ADV01', duration_mac: 'Дюрация', ytm_avg: 'YTM средняя', var_99_1d: 'VaR 99 %', rating_score: 'Рейтинг (балл)', cash_total_rub: 'Касса', dm_avg_bp: 'DM флоутеров, б.п.', floater_share_pct: 'Доля флоутеров, %' }
  const fmtMetric = (m: string, v: number | null) => m === 'duration_mac' ? fmt.num(v, 3) : m === 'ytm_avg' || m === 'floater_share_pct' ? fmt.pct(v) : m === 'rating_score' ? fmt.num(v, 2) : m === 'dm_avg_bp' ? fmt.bp(v) : fmt.compact(v)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Новая сделка" wide>
      <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1 max-md:gap-3.5">
        <div className="flex flex-col gap-3">
          <label className={field}><span>Бумага</span>
            <Combobox value={bond} onChange={(b) => { setBond(b); setPrice(null) }} search={search} placeholder="начните вводить название или ISIN" testId="trade-bond" />
          </label>
          <div className={grid2}>
            <div className={field}><span>Сторона</span><Segmented value={side} onChange={setSide} options={[{ value: 'buy', label: 'Покупка' }, { value: 'sell', label: 'Продажа' }]} ariaLabel="Сторона сделки" className="w-full [&>*]:flex-1" /></div>
            <label className={field}><span>Количество, шт.</span><input className={input({ num: true })} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="trade-qty" /></label>
            <label className={field}><span>Чистая цена, % номинала</span><input className={input({ num: true })} inputMode="decimal" value={effPrice} onChange={(e) => setPrice(e.target.value)} placeholder={mkt != null ? fmt.num(mkt) : ''} data-testid="trade-price" />
              <span className="text-xs">{mkt != null ? <>рынок {fmt.num(mkt)} % на {fmt.date(metrics.data?.price_date)}{dev != null && Math.abs(dev) > 0.005 && <> · <Delta value={dev} goodWhenUp={side === 'sell'} suffix=" %" /> к рынку</>}</> : 'выберите бумагу'}</span></label>
            <label className={field}><span>Дата сделки</span><input type="date" className={input()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <div className={field}><span>Расчёты</span><Segmented value={tn} onChange={setTn} options={[...['0', '1', '2'].map((n) => ({ value: n, label: `T+${n}` })), { value: 'manual', label: 'дата' }]} ariaLabel="Расчёты" className="w-full [&>*]:flex-1" /></div>
            {tn === 'manual' && <label className={field}><span>Дата расчётов</span><input type="date" className={input()} value={manual} min={date} onChange={(e) => setManual(e.target.value)} data-testid="trade-settle-date" /></label>}
            <label className={field}><span>Комиссия, {bond ? 'валюта выпуска' : '₽'}</span><input className={input({ num: true })} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
          </div>
          <div className="text-text-2 text-xs" data-testid="trade-settlement">{pv
            ? <>Расчёты {fmt.date(pv.settlement_date)}{pv.settlement_shifted_from ? ` (перенос с выходного ${fmt.date(pv.settlement_shifted_from)})` : ''} · НКД на дату расчётов {fmt.num(pv.accrued_at_settlement, 4)} · сумма ≈ {fmt.rub0(pv.amount_rub)}</>
            : <>Сумма по чистой цене ≈ {fmt.num(sum, 2)}; НКД на дату расчётов: AI(S) = AI(D) + c·N·(S − D)/365.</>} Сделку совершает: {user?.full_name ?? '—'}.</div>
          {/* отключить проверку жёстких лимитов может только администратор — API отклонит это от трейдера */}
          {user?.role === 'admin' && <label className="row flex items-center gap-2"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} data-testid="trade-check" /> проверять жёсткие лимиты перед исполнением</label>}
          {exec.error && <ErrorBanner error={exec.error} />}
          <div className={dialogActions} style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" disabled={!bond || !(q > 0) || !Number.isInteger(q) || !(px > 0) || !(feeN >= 0) || !date || exec.isPending || blocked} onClick={submit} data-testid="trade-submit">{exec.isPending ? 'Исполняем…' : 'Исполнить'}</Button>
            <Button onClick={() => onOpenChange(false)}>Отмена</Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h3>Предварительная оценка {preview.isPending && <span className="text-muted text-xs">· считаем…</span>}</h3>
          {!bond && <EmptyState title="Выберите бумагу и количество" hint="оценка «до / после» появится автоматически" />}
          {pv && (
            <div className={cn('flex flex-col gap-3 transition-opacity', preview.isPending && 'opacity-60')}>
              {pv.blocked && <div className={cn('banner error', banner({ kind: 'error' }))} data-testid="trade-blocked">Сделка будет отклонена: {hard.map((l) => `${labels.metric[l.metric.split(' ')[0]] ?? l.metric}${l.scope ? ` (${issuerShort(l.scope, 36)})` : ''} → ${fmt.pct(l.utilization_after, 0)}`).join('; ')}{!check && ' — проверка отключена, сделка пройдёт'}</div>}
              <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="preview-table">
                <thead><tr><th>Метрика</th><th className="text-right">До</th><th className="text-right">После</th><th className="text-right">Δ</th></tr></thead>
                <tbody>{pv.metrics.map((m) => <tr key={m.metric}><td>{metricLabel[m.metric] ?? m.metric}</td><td className="text-right tabular-nums">{fmtMetric(m.metric, m.before)}</td><td className="text-right tabular-nums">{fmtMetric(m.metric, m.after)}</td><td className="text-right tabular-nums"><Delta value={m.before != null && m.after != null ? m.after - m.before : null} goodWhenUp={m.metric === 'ytm_avg' || m.metric === 'cash_total_rub'} digits={m.metric === 'duration_mac' || m.metric === 'rating_score' ? 3 : m.metric === 'ytm_avg' ? 2 : 0} flatText="0" /></td></tr>)}</tbody>
              </table></div>
              {pv.limits.length > 0 && (
                <div>
                  <div className={cap} style={{ marginBottom: 6 }}>Лимиты до → после</div>
                  {pv.limits.map((l) => (
                    <div key={l.limit_id} className="grid grid-cols-[minmax(120px,1fr)_1fr_auto] gap-2.5 items-center py-2 border-t border-border first:border-t-0 max-md:grid-cols-1 max-md:gap-1.5">
                      <div className={'text-[13px] flex flex-col gap-px min-w-0 [&>small]:text-muted [&>small]:text-[11.5px] [&>small]:whitespace-nowrap [&>small]:overflow-hidden [&>small]:text-ellipsis'}><span>{labels.metric[l.metric.split(' ')[0]] ?? l.metric}{l.is_hard ? '' : <span className="text-muted"> · мягкий</span>}</span>{l.scope && <small title={l.scope}>{issuerShort(l.scope, 30)}</small>}</div>
                      <div className="flex flex-col gap-[3px]"><Meter pct={l.utilization_before} status="ok" /><Meter pct={l.utilization_after} status={l.status_after} /></div>
                      <div className={'text-[12.5px] text-right min-w-14 max-md:text-left max-md:flex max-md:justify-between'}><span className="tabular-nums">{fmt.pct(l.utilization_before, 0)} → {fmt.pct(l.utilization_after, 0)}</span> <StatusBadge status={l.status_after} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
