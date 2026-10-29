import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePositions } from '../../api/hooks'
import type { Position } from '../../api/types'
import { useIsMobile } from '../../app/media'
import { useScope } from '../../app/scope'
import { SectionTabs } from '../../components/layout/SectionTabs'
import { Card } from '../../components/ui/Card'
import { DataTable } from '../../components/ui/DataTable'
import { Dialog } from '../../components/ui/Dialog'
import { FormulaBlock } from '../../components/ui/Formula'
import { EmptyState, ErrorBanner } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { Select } from '../../components/ui/Select'
import { Tip } from '../../components/ui/Tooltip'
import { daysBetween } from '../../lib/dates'
import { countOf, fmt, issuerShort, labels } from '../../lib/format'
import { badge, button, cellSub, chip, cn, input, kv, mcardHead, mcardKv, mcardSub, pageHead, pageSub } from '../../lib/ui'

export function PositionsPage() {
  const { portfolio, portfolioId, asOf, holdings } = useScope()
  const mobile = useIsMobile()
  const q = usePositions(portfolioId, asOf, holdings)
  const [text, setText] = useState('')
  const [cur, setCur] = useState('all')
  const [mode, setMode] = useState<'rub' | 'pct'>('rub')
  const [sel, setSel] = useState<Position | null>(null)
  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const totals = q.data?.totals
  const filtered = useMemo(() => items.filter((p) => (cur === 'all' || p.currency === cur) && (!text || `${p.short_name} ${p.isin} ${p.issuer_name}`.toLowerCase().includes(text.toLowerCase()))), [items, cur, text])
  const currencies = Array.from(new Set(items.map((p) => p.currency)))
  const multiCur = currencies.length > 1
  const stale = (p: Position) => (p.price_date && asOf ? daysBetween(p.price_date, asOf) : 0)

  const columns = useMemo<ColumnDef<Position, unknown>[]>(() => [
    { header: 'Бумага', accessorKey: 'short_name', cell: ({ row }) => <span><b style={{ fontWeight: 500 }}>{row.original.short_name}</b>{multiCur && row.original.currency !== 'RUB' && <span className={chip} style={{ marginLeft: 6 }}>{row.original.currency}</span>}<span className={cn(cellSub, 'font-mono')}>{row.original.isin}</span></span> },
    { header: 'Эмитент', accessorKey: 'issuer_name', cell: ({ getValue }) => <Tip content={String(getValue())}><span>{issuerShort(String(getValue()), 28)}</span></Tip> },
    { header: 'Кол-во', accessorKey: 'qty', meta: { align: 'right' }, cell: ({ getValue }) => fmt.int(getValue<number>()) },
    { header: 'Цена, %', accessorKey: 'clean_price_pct', meta: { align: 'right' }, cell: ({ row }) => { const d = stale(row.original); return <span>{fmt.num(row.original.clean_price_pct)}{row.original.price_source === 'cost' || row.original.price_source === 'override' ? <Tip content={labels.priceSource[row.original.price_source]}><span className={badge({ status: 'amber' })} style={{ marginLeft: 6 }}>{row.original.price_source === 'cost' ? 'цена покупки' : 'корр.'}</span></Tip> : null}{d > 0 && row.original.price_source === 'last' ? <Tip content={`Котировки на ${fmt.date(asOf)} нет — используется последняя цена от ${fmt.date(row.original.price_date)} (locf, окно 90 дней)`}><span className={badge({ status: 'amber' })} style={{ marginLeft: 6 }}>locf {d} дн.</span></Tip> : null}</span> } },
    { header: 'НКД', accessorKey: 'accrued_interest', meta: { align: 'right' }, cell: ({ getValue }) => fmt.num(getValue<number | null>()) },
    { header: mode === 'rub' ? 'MV, ₽' : 'MV, %', accessorKey: 'mv_rub', meta: { align: 'right' }, cell: ({ row }) => mode === 'rub' ? fmt.money(row.original.mv_rub, 'RUB', 0) : fmt.pct(row.original.weight_pct, 1) },
    { header: 'Доля', accessorKey: 'weight_pct', meta: { align: 'right' }, cell: ({ getValue }) => { const w = getValue<number | null>() ?? 0; return <span className="inline-flex items-center gap-1.5 justify-end w-[90px]"><span className="tabular-nums">{fmt.pct(w, 1)}</span><span className="w-11 h-1.5 rounded-[3px] bg-s1-track overflow-hidden flex-none"><i className="block h-full bg-accent" style={{ width: `${Math.min(100, w)}%` }} /></span></span> } },
    // §8: у флоутера вместо доходности показывается дисконтная маржа
    { header: 'YTM / DM', accessorKey: 'ytm_pct', meta: { align: 'right' }, cell: ({ row: { original: p } }) => p.coupon_type === 'floating' ? <Tip content={`Флоутер: дисконтная маржа к ставке купона; расчётная YTM ${fmt.pct(p.ytm_pct)} входит в общую среднюю`}><span>DM {fmt.bp(p.dm_bp)}</span></Tip> : <Tip content={p.ytm_source === 'market' ? 'Рыночная доходность MOEX на дату (§4 п. 1)' : 'Расчётная доходность по потокам (§4 п. 2)'}><span>{fmt.pct(p.ytm_pct)}</span></Tip> },
    { header: 'Дюрация', accessorKey: 'duration_mac', meta: { align: 'right' }, cell: ({ getValue }) => fmt.num(getValue<number | null>()) },
    { header: 'DV01, ₽', accessorKey: 'dv01_rub', meta: { align: 'right' }, cell: ({ getValue }) => fmt.int(getValue<number | null>()) },
    { header: 'G-спред', accessorKey: 'g_spread_bp', meta: { align: 'right' }, cell: ({ getValue }) => fmt.bp(getValue<number | null>()) },
    { header: 'Рейтинг', accessorKey: 'rating_grade', cell: ({ row }) => <Tip content={`${labels.ratingSource[row.original.rating_source]} · бакет ADV01 ${row.original.adv01_bucket} (k = ${row.original.adv01_coef})`}><span>{row.original.rating_grade}{row.original.rating_source === 'issuer' ? '*' : ''}</span></Tip> },
  ], [mode, asOf, multiCur]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!portfolio) return <EmptyState title="Нет портфелей" />
  const sumMv = filtered.reduce((s, p) => s + (p.mv_rub ?? 0), 0)
  const sumW = filtered.reduce((s, p) => s + (p.weight_pct ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <div className={pageHead}>
        <div><h1>Портфель — {portfolio.name}</h1><div className={pageSub}>{countOf(items.length, ['позиция', 'позиции', 'позиций'])} · MV брутто {fmt.money(totals?.mv_gross, 'RUB', 0)} · DV01 {fmt.rub0(totals?.dv01)} · на {fmt.date(asOf)}</div></div>
      </div>
      <SectionTabs>
        <input type="search" className={cn(input(), 'w-[240px] max-md:w-full')} placeholder="поиск: бумага, ISIN, эмитент" value={text} onChange={(e) => setText(e.target.value)} data-testid="pos-search" />
        {multiCur && <Select value={cur} onChange={setCur} options={[{ value: 'all', label: 'все валюты' }, ...currencies.map((c) => ({ value: c, label: c }))]} ariaLabel="Валюта" width={140} />}
        <Segmented value={mode} onChange={setMode} options={[{ value: 'rub', label: 'MV в ₽' }, { value: 'pct', label: 'в % портфеля' }]} ariaLabel="Единицы MV" />
      </SectionTabs>
      <ErrorBanner error={q.error} />
      {!q.isPending && items.length === 0 ? <EmptyState title="Позиций нет" hint="В портфеле нет открытых позиций на дату оценки" action={<Link className={button({ size: 'sm' })} to={{ pathname: '/trades', search: location.search }}>К сделкам →</Link>} /> : (
        <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
            <DataTable data={filtered} columns={columns} onRowClick={setSel} initialSort={[{ id: 'mv_rub', desc: true }]} getRowId={(r) => String(r.bond_id)} dense stickyFirst testId="positions-table"
              mobileCard={(p) => (
                <>
                  <div className={mcardHead}><b>{p.short_name}</b><span className="tabular-nums">{mode === 'rub' ? fmt.money(p.mv_rub, 'RUB', 0) : fmt.pct(p.weight_pct, 1)}</span></div>
                  <div className={mcardSub}><span>{issuerShort(p.issuer_name, 28)}</span>{p.currency !== 'RUB' && <span className={chip}>{p.currency}</span>}<span className={chip}>{p.rating_grade}{p.rating_source === 'issuer' ? '*' : ''}</span>{stale(p) > 0 && <span className={badge({ status: 'amber' })}>locf {stale(p)} дн.</span>}</div>
                  <div className={mcardKv}>
                    <span><span className="k">YTM</span><span className="v">{fmt.pct(p.ytm_pct)}</span></span>
                    <span><span className="k">Дюрация</span><span className="v">{fmt.num(p.duration_mac)}</span></span>
                    <span><span className="k">DV01, ₽</span><span className="v">{fmt.int(p.dv01_rub)}</span></span>
                    <span><span className="k">Кол-во</span><span className="v">{fmt.int(p.qty)}</span></span>
                    <span><span className="k">Цена, %</span><span className="v">{fmt.num(p.clean_price_pct)}</span></span>
                    <span><span className="k">Доля</span><span className="v">{fmt.pct(p.weight_pct, 1)}</span></span>
                  </div>
                </>
              )}
              footer={mobile ? undefined : <tr><td colSpan={5}>Итого</td><td className="text-right tabular-nums">{mode === 'rub' ? fmt.money(sumMv, 'RUB', 0) : fmt.pct(sumW, 1)}</td><td className="text-right tabular-nums">{fmt.pct(sumW, 1)}</td><td className="text-right tabular-nums">{fmt.pct(totals?.ytm_avg)}</td><td className="text-right tabular-nums">{fmt.num(totals?.duration_mac)}</td><td className="text-right tabular-nums">{fmt.int(totals?.dv01)}</td><td className="text-right tabular-nums">{fmt.bp(totals?.g_spread_avg_bp)}</td><td>{totals?.rating_grade}</td></tr>} />
        </div>
      )}
      <p className="text-muted text-xs">* — рейтинг эмитента (у выпуска нет собственного). Бейдж «locf» — котировки на дату оценки нет, взята последняя цена в окне 90 дней.</p>
      <Dialog open={!!sel} onOpenChange={(o) => { if (!o) setSel(null) }} title={sel ? `${sel.short_name}` : ''} sheet>
        {sel && <PositionSheet p={sel} />}
      </Dialog>
    </div>
  )
}

function PositionSheet({ p }: { p: Position }) {
  const mv = p.mv_rub ?? 0
  return (
    <div className="flex flex-col gap-3" data-testid="position-sheet">
      <div className="row flex items-center gap-2 flex-wrap"><span className="font-mono text-[12.5px]">{p.isin}</span><span className={chip}>{p.currency}</span><span className={chip}>{labels.coupon[p.coupon_type]}</span><span className={chip}>{p.rating_grade}{p.rating_source === 'issuer' ? '*' : ''}</span></div>
      <p className="text-text-2">{p.issuer_name} · {p.sector}</p>
      <dl className={kv}>
        <dt>Количество</dt><dd>{fmt.int(p.qty)} шт.</dd>
        <dt>Чистая цена</dt><dd>{fmt.num(p.clean_price_pct)} % на {fmt.date(p.price_date)}</dd>
        <dt>НКД / номинал</dt><dd>{fmt.num(p.accrued_interest)} / {fmt.num(p.face_current)}</dd>
        <dt>Курс</dt><dd>{fmt.num(p.fx_rate, 4)}</dd>
        <dt>MV</dt><dd>{fmt.money(p.mv_local, p.currency)} → {fmt.money(mv, 'RUB')}</dd>
        <dt>YTM / текущая</dt><dd>{fmt.pct(p.ytm_pct)} / {fmt.pct(p.current_yield_pct)}</dd>
        <dt>Дюрация Маколея / мод.</dt><dd>{fmt.num(p.duration_mac, 3)} / {fmt.num(p.duration_mod, 3)}</dd>
        <dt>Конвексность</dt><dd>{fmt.num(p.convexity, 3)}</dd>
        <dt>DV01 / CS01</dt><dd>{fmt.rub0(p.dv01_rub)} / {fmt.rub0(p.cs01_rub)}</dd>
        <dt>G-спред</dt><dd>{fmt.bp(p.g_spread_bp)}</dd>
        <dt>Доля портфеля</dt><dd>{fmt.pct(p.weight_pct, 2)}</dd>
      </dl>
      <Card tight title="Как посчитано">
        <div className="flex flex-col gap-3">
          <FormulaBlock k="mv" values={{ q: p.qty, p: p.clean_price_pct, n: p.face_current, ai: p.accrued_interest, fx: p.fx_rate, mv }} />
          <FormulaBlock k="dv01" values={{ mv: Math.abs(mv), dmod: p.duration_mod, dv01: p.dv01_rub }} />
          <FormulaBlock k="gspread" values={{ ytm: p.ytm_pct, curve: p.ytm_pct != null && p.g_spread_bp != null ? p.ytm_pct - p.g_spread_bp / 100 : null, g: p.g_spread_bp }} />
        </div>
      </Card>
      <Link className={button()} to={{ pathname: `/bonds/${p.bond_id}`, search: location.search }}>Открыть карточку выпуска →</Link>
    </div>
  )
}
