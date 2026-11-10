import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useAdv01, useByCurrency, useClosedPositions, useCurve, useFxAnalytics, useFxPosition, usePnl, usePnlAttribution, usePriceGaps, useRatingMigrations, useSpreads, useStress, useWall } from '../../api/hooks'
import type { Issuer, Page, StressRow } from '../../api/types'
import { useIsMobile } from '../../app/media'
import { useScope } from '../../app/scope'
import { BarChart } from '../../components/charts/BarChart'
import { CurveChart } from '../../components/charts/CurveChart'
import { SpreadDotPlot } from '../../components/charts/DotPlot'
import { WallChart } from '../../components/charts/WallChart'
import { Card } from '../../components/ui/Card'
import { Combobox, type ComboItem } from '../../components/ui/Combobox'
import { InfoButton } from '../../components/ui/InfoButton'
import { EmptyState, ErrorBanner } from '../../components/ui/Misc'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Tip } from '../../components/ui/Tooltip'
import { TabPanel, Tabs } from '../../components/ui/Tabs'
import { addMonths } from '../../lib/dates'
import { fmt, labels } from '../../lib/format'
import { badge, cellSub, cn, grid2, input, legend, legendKey, pageHead, pageSub, seg, segItem, segItemOn, tableWrap, tableWrapFlat, tbl } from '../../lib/ui'

const TABS = [
  { value: 'stress', label: 'Стресс-тест' }, { value: 'adv01', label: 'ADV01' }, { value: 'spreads', label: 'G-спреды' }, { value: 'wall', label: 'Стена реинвестирования' },
  { value: 'pnl', label: 'P&L' }, { value: 'fx', label: 'Валюта' }, { value: 'gaps', label: 'Пропуски котировок' }, { value: 'migrations', label: 'Миграции рейтингов' }, { value: 'curve', label: 'Кривая КБД' },
]

export function ReportsPage() {
  const { portfolio } = useScope()
  const [sp, setSp] = useSearchParams()
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab')! : 'stress'
  const setTab = (v: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', v); return n }, { replace: true })
  if (!portfolio) return <EmptyState title="Нет портфелей" />
  return (
    <div className="flex flex-col gap-3">
      <div className={pageHead}><div><h1>Аналитика — {portfolio.code}</h1><div className={pageSub}>отчёты по портфелю на дату оценки; кривая и миграции рейтингов — по рынку в целом</div></div></div>
      <Tabs value={tab} onChange={setTab} items={TABS}>
        <TabPanel value="stress"><StressTab /></TabPanel>
        <TabPanel value="adv01"><Adv01Tab /></TabPanel>
        <TabPanel value="spreads"><SpreadsTab /></TabPanel>
        <TabPanel value="wall"><WallTab /></TabPanel>
        <TabPanel value="pnl"><PnlTab /></TabPanel>
        <TabPanel value="fx"><FxTab /></TabPanel>
        <TabPanel value="gaps"><GapsTab /></TabPanel>
        <TabPanel value="migrations"><MigrationsTab /></TabPanel>
        <TabPanel value="curve"><CurveTab /></TabPanel>
      </Tabs>
    </div>
  )
}

/** Дивергентный столбик внутри ячейки: от центра вправо — прибыль, влево — убыток. */
function InlineBar({ v, max, width = 160 }: { v: number; max: number; width?: number }) {
  const w = (Math.abs(v) / (max || 1)) * 50
  return (
    <span className="relative h-3 inline-block align-middle rounded-[2px] bg-neutral-mid" style={{ width }} aria-hidden>
      <span className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-axis" />
      <i className="absolute top-0 h-full rounded-[2px]" style={{ left: v >= 0 ? '50%' : `${50 - w}%`, width: `${Math.max(w, v ? 0.5 : 0)}%`, background: v >= 0 ? 'var(--color-s1)' : 'var(--color-s8)' }} />
    </span>
  )
}

function StressTab() {
  const { portfolioId, asOf, holdings } = useScope()
  const mobile = useIsMobile()
  const q = useStress(portfolioId, asOf, holdings)
  const all = q.data ?? []
  const rows = all.filter((r) => !r.episode)
  const hist = all.filter((r) => r.episode)
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl_rub ?? 0)))
  return (
    <div className="flex flex-col gap-3">
      <Card title="Стресс-тест: P&L по сценариям" hint="параллельные сдвиги кривой, твист, гипотетические валютные шоки · критично — убыток больше 5 % стоимости, предупреждение — больше 2 %" actions={<InfoButton k="stress" />}>
        <ErrorBanner error={q.error} />
        {!rows.length ? <EmptyState title="Нет данных" hint="В портфеле нет позиций на дату оценки" /> : mobile
          ? <BarChart items={rows.map((s) => ({ label: s.code, sub: s.name, value: s.pnl_rub ?? 0 }))} format={(v) => fmt.compact(v)} />
          : (
            <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="stress-table"><thead><tr><th>Сценарий</th><th className="w-[200px]"></th><th className="text-right">P&L, ₽</th><th className="text-right">% MV</th><th>Оценка</th></tr></thead>
              <tbody>{rows.map((s) => { const v = s.pnl_rub ?? 0; return (
                <tr key={s.code}>
                  <td><span className="font-mono text-[12.5px] inline-block w-[64px]">{s.code}</span><span className="text-text-2">{s.name}</span></td>
                  <td><InlineBar v={v} max={max} /></td>
                  <td className={cn('text-right tabular-nums', v < 0 ? 'text-bad-text' : v > 0 ? 'text-good-text' : 'text-text-2')}>{fmt.rub0(s.pnl_rub)}</td>
                  <td className="text-right tabular-nums">{fmt.pct(s.pnl_pct_of_mv)}</td>
                  <td><Severity s={s} /></td>
                </tr>) })}</tbody></table></div>
          )}
      </Card>
      {hist.length > 0 && <HistoricalStress rows={hist} />}
    </div>
  )
}

function Severity({ s }: { s: StressRow }) {
  return s.severity === 'ok' ? <span className="text-muted text-xs">в пределах</span>
    : <StatusBadge status={s.severity === 'critical' ? 'breach' : 'warning'} label={s.severity === 'critical' ? 'критично' : 'предупреждение'} />
}

const FACTOR_COLS: { key: string; label: string; match: (s: StressRow) => boolean }[] = [
  { key: 'cny', label: 'Юань', match: (s) => s.kind === 'fx_hist' && s.code.includes('-CNY-') },
  { key: 'usd', label: 'Доллар', match: (s) => s.kind === 'fx_hist' && s.code.includes('-USD-') },
  { key: 'ofz', label: 'Индекс ОФЗ', match: (s) => s.kind === 'ofz_index' },
  { key: 'eq', label: 'Акции × β', match: (s) => s.kind === 'equity_index' },
]

/** Исторические эпизоды (§13): строки — кризис × горизонт, столбцы — фактор; в ячейке P&L и изменение фактора. */
function HistoricalStress({ rows }: { rows: StressRow[] }) {
  const episodes = [...new Set(rows.map((r) => r.episode!))]
  const horizons = [...new Set(rows.map((r) => r.horizon_days!))].sort((a, b) => a - b)
  const hLabel = (h: number) => ({ 1: '1 день', 5: '1 неделя', 21: '1 месяц', 63: '3 месяца', 252: '1 год' } as Record<number, string>)[h] ?? `${h} дн.`
  return (
    <Card title="Исторические сценарии" hint="наихудшее окно кризисного периода по каждому фактору: курс ЦБ и индексы MOEX; валюта — к экспозиции бумаг и кассы в валюте, индекс ОФЗ — к рублёвым позициям, акции — × β к несуверенным">
      <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="stress-hist"><thead><tr><th>Кризис</th><th>Горизонт</th>{FACTOR_COLS.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}</tr></thead>
        <tbody>{episodes.flatMap((ep) => horizons.map((h, i) => (
          <tr key={`${ep}-${h}`}>
            <td>{i === 0 ? <b className="font-medium">{ep}</b> : null}</td>
            <td className="text-text-2">{hLabel(h)}</td>
            {FACTOR_COLS.map((c) => { const r = rows.find((x) => x.episode === ep && x.horizon_days === h && c.match(x)); const v = r?.pnl_rub ?? 0; return (
              <td key={c.key} className="text-right tabular-nums">
                {r ? <Tip content={`${r.name}: ${fmt.date(r.date_from)} → ${fmt.date(r.date_to)}, изменение ${fmt.pct(r.change_pct, 1)} · ${fmt.pct(r.pnl_pct_of_mv, 2)} MV`}>
                  <span className={cn(r.severity === 'critical' ? 'text-bad-text font-semibold' : r.severity === 'warning' ? 'text-warning-text' : v < 0 ? 'text-text' : 'text-text-2')}>{fmt.compact(r.pnl_rub)}<span className={cellSub}>{fmt.pct(r.change_pct, 1)}</span></span>
                </Tip> : '—'}
              </td>) })}
          </tr>)))}</tbody></table></div>
    </Card>
  )
}

function Adv01Tab() {
  const { portfolioId, asOf } = useScope()
  const q = useAdv01(portfolioId, asOf)
  const rows = q.data ?? []
  return (
    <div className={grid2}>
      <Card title="ADV01 по рейтинговым бакетам" hint="нетто-DV01 бакета × коэффициент" actions={<InfoButton k="adv01" />}>
        <ErrorBanner error={q.error} />
        {rows.length ? <BarChart items={rows.map((r) => ({ label: `${r.bucket} ×${r.coef}`, sub: 'ADV01', value: r.adv01 }))} diverging={false} labelWidth={90} /> : <EmptyState title="Нет позиций" />}
      </Card>
      <Card title="Таблица" hint={rows[0] ? `итого ADV01 ${fmt.rub0(rows[0].adv01_total)}` : undefined}>
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl}><thead><tr><th>Бакет</th><th className="text-right">k</th><th className="text-right">Позиций</th><th className="text-right">DV01 long</th><th className="text-right">DV01 short</th><th className="text-right">Нетто</th><th className="text-right">ADV01</th><th className="text-right">Доля MV</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.bucket}><td>{r.bucket}{r.issuer_level_ratings ? <span className={cellSub}>{r.issuer_level_ratings} с рейтингом эмитента</span> : null}</td><td className="text-right tabular-nums">{fmt.num(r.coef)}</td><td className="text-right tabular-nums">{r.positions}</td><td className="text-right tabular-nums">{fmt.int(r.dv01_long)}</td><td className="text-right tabular-nums">{fmt.int(r.dv01_short)}</td><td className="text-right tabular-nums">{fmt.int(r.net_dv01)}</td><td className="text-right tabular-nums">{fmt.int(r.adv01)}</td><td className="text-right tabular-nums">{fmt.pct(r.mv_share_pct, 1)}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  )
}

function SpreadsTab() {
  const { portfolioId, asOf } = useScope()
  const q = useSpreads(portfolioId, asOf)
  const items = q.data?.items ?? []
  return (
    <div className="flex flex-col gap-3">
      <Card title="G-спреды бумаг" hint="залитые точки входят в средний спред; контурные — исключены (причина в подсказке)" actions={<InfoButton k="gspread" />}>
        <ErrorBanner error={q.error} />
        <SpreadDotPlot items={items} avg={q.data?.avg_spread_bp ?? null} />
      </Card>
      <Card title="Таблица">
        <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 360 }}><table className={tbl}><thead><tr><th>Бумага</th><th>Рейтинг</th><th className="text-right">YTM</th><th className="text-right">КБД</th><th className="text-right">G-спред</th><th className="text-right">MV, ₽</th><th>В среднем</th></tr></thead>
          <tbody>{items.map((r) => <tr key={r.bond_id}><td>{r.short_name}<span className={cn(cellSub, 'font-mono')}>{r.isin}</span></td><td>{r.rating_grade ?? '—'}</td><td className="text-right tabular-nums">{fmt.pct(r.ytm_pct)}</td><td className="text-right tabular-nums">{fmt.pct(r.curve_rate_pct)}</td><td className="text-right tabular-nums">{fmt.bp(r.g_spread_bp)}</td><td className="text-right tabular-nums">{fmt.int(r.mv_rub)}</td><td>{r.included ? <span className={badge({ status: 'ok' })}>✓ включена</span> : <span className={badge({ status: 'na' })}>{r.exclusion_reason ?? 'исключена'}</span>}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  )
}

function WallTab() {
  const { portfolioId, asOf } = useScope()
  const [months, setMonths] = useState(18)
  const q = useWall(portfolioId, asOf, months)
  const items = q.data?.items ?? []
  const total = items.length ? items[items.length - 1].cumulative_rub / (items[items.length - 1].cumulative_pct / 100) : 0
  return (
    <div className="flex flex-col gap-3">
      <Card title="Стена реинвестирования" hint={q.data ? `в горизонте ${months} мес. погашается ${fmt.pct(q.data.share_pct, 1)} стоимости портфеля · сигнальный порог 50 %` : undefined}
        actions={<div className={seg}>{[6, 12, 18, 24, 36].map((m) => <button key={m} className={cn(segItem, months === m && segItemOn)} onClick={() => setMonths(m)}>{m} мес.</button>)}</div>}>
        <ErrorBanner error={q.error} />
        <WallChart items={items} total={total} />
      </Card>
      {items.length > 0 && (
        <Card title="Таблица"><div className={cn(tableWrap, tableWrapFlat)}><table className={tbl}><thead><tr><th>Месяц</th><th>Бумаги</th><th className="text-right">К погашению, ₽</th><th className="text-right">Накопительно, ₽</th><th className="text-right">Накопительно, %</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.month}><td>{fmt.month(i.month)}</td><td className="whitespace-normal">{i.bonds}</td><td className="text-right tabular-nums">{fmt.int(i.mv_rub)}</td><td className="text-right tabular-nums">{fmt.int(i.cumulative_rub)}</td><td className="text-right tabular-nums">{fmt.pct(i.cumulative_pct, 1)}</td></tr>)}</tbody></table></div></Card>
      )}
    </div>
  )
}

function PnlTab() {
  const { portfolioId, asOf } = useScope()
  const q = usePnl(portfolioId, asOf)
  const rows = [...(q.data ?? [])].sort((a, b) => (b.unrealized_rub ?? 0) - (a.unrealized_rub ?? 0))
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.unrealized_rub ?? 0)))
  const total = rows.reduce((s, r) => s + (r.unrealized_rub ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <EconomicPnl />
      <Card title="Нереализованный P&L" hint={`(цена − средняя цена приобретения) × количество + НКД × количество · итого ${fmt.rub0(total)}`}>
        <ErrorBanner error={q.error} />
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl}><thead><tr><th>Бумага</th><th className="text-right">Кол-во</th><th className="text-right">Средняя</th><th className="text-right">Цена</th><th className="text-right">Доходность</th><th className="text-right">P&L, ₽</th><th></th></tr></thead>
          <tbody>{rows.map((r) => { const v = r.unrealized_rub ?? 0; return (
            <tr key={r.bond_id}><td>{r.short_name}<span className={cellSub}>{r.rank_best === 1 ? 'лучшая' : r.rank_worst === 1 ? 'худшая' : ''}</span></td><td className="text-right tabular-nums">{fmt.int(r.qty)}</td><td className="text-right tabular-nums">{fmt.num(r.avg_price)}</td><td className="text-right tabular-nums">{fmt.num(r.price)}<span className={cellSub}>{fmt.date(r.price_date)}</span></td><td className={cn('text-right tabular-nums', (r.return_pct ?? 0) < 0 ? 'text-bad-text' : 'text-good-text')}>{fmt.pct(r.return_pct)}</td><td className={cn('text-right tabular-nums', v < 0 ? 'text-bad-text' : 'text-good-text')}>{r.unrealized_rub == null ? '—' : fmt.rub0(v)}</td>
              <td><InlineBar v={v} max={max} width={120} /></td></tr>) })}</tbody></table></div>
      </Card>
      <ClosedPositions />
    </div>
  )
}

/** §17: экономическая переоценка с разложением по компонентам; день / неделя / месяц. */
function EconomicPnl() {
  const { portfolioId, asOf } = useScope()
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day')
  const from = asOf ? addMonths(asOf, bucket === 'day' ? -1 : bucket === 'week' ? -3 : -12) : undefined
  const q = usePnlAttribution(portfolioId, from, asOf, bucket)
  const rows = [...(q.data ?? [])].reverse()
  const sum = (k: 'price_pnl' | 'trading_pnl' | 'coupon_pnl' | 'fx_pnl' | 'fees' | 'total') => rows.reduce((s, r) => s + (r[k] ?? 0), 0)
  const cell = (v: number | null) => <td className={cn('text-right tabular-nums', (v ?? 0) < 0 ? 'text-bad-text' : (v ?? 0) > 0 ? 'text-good-text' : 'text-text-2')}>{v == null ? '—' : fmt.rub0(v)}</td>
  return (
    <Card title="Экономический P&L" hint="переоценка утренней позиции по грязной цене, сделки дня по цене закрытия, купоны и погашения, курс ЦБ, минус комиссии; без предыдущего среза — результат торгового потока"
      actions={<div className={seg}>{([['day', 'день'], ['week', 'неделя'], ['month', 'месяц']] as const).map(([v, l]) => <button key={v} className={cn(segItem, bucket === v && segItemOn)} onClick={() => setBucket(v)}>{l}</button>)}</div>}>
      <ErrorBanner error={q.error} />
      {rows.length ? (
        <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 380 }}><table className={tbl} data-testid="pnl-attr"><thead><tr><th>Период</th><th className="text-right">Цена</th><th className="text-right">Сделки</th><th className="text-right">Купоны</th><th className="text-right">Курс</th><th className="text-right">Комиссии</th><th className="text-right">Итого</th></tr></thead>
          <tbody>
            <tr className="font-medium"><td>Итого за период</td>{cell(sum('price_pnl'))}{cell(sum('trading_pnl'))}{cell(sum('coupon_pnl'))}{cell(sum('fx_pnl'))}{cell(sum('fees'))}{cell(sum('total'))}</tr>
            {rows.map((r) => <tr key={r.period}><td>{bucket === 'month' ? fmt.month(r.period) : fmt.date(r.period)}{r.flow_days ? <span className={cellSub}>торговый поток</span> : null}</td>{cell(r.price_pnl)}{cell(r.trading_pnl)}{cell(r.coupon_pnl)}{cell(r.fx_pnl)}{cell(r.fees)}{cell(r.total)}</tr>)}
          </tbody></table></div>
      ) : <EmptyState title="Нет срезов EOD за период" />}
    </Card>
  )
}

function ClosedPositions() {
  const { portfolioId, asOf } = useScope()
  const from = asOf ? `${asOf.slice(0, 4)}-01-01` : undefined
  const q = useClosedPositions(portfolioId, from, asOf)
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <Card title="Закрытые с начала года" hint="валовой принцип: продажи + купоны и погашения − покупки − комиссии, ₽ по курсу ЦБ на дату операции">
      <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 320 }}><table className={tbl}><thead><tr><th>Бумага</th><th>Закрыта</th><th className="text-right">Куплено</th><th className="text-right">Продано</th><th className="text-right">Купоны</th><th className="text-right">Результат</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.bond_id}><td>{r.short_name}<span className={cn(cellSub, 'font-mono')}>{r.isin}</span></td><td>{fmt.date(r.closed_on)}</td><td className="text-right tabular-nums">{fmt.rub0(r.bought_rub)}</td><td className="text-right tabular-nums">{fmt.rub0(r.sold_rub)}</td><td className="text-right tabular-nums">{fmt.rub0(r.coupons_rub)}</td><td className={cn('text-right tabular-nums', r.result_rub < 0 ? 'text-bad-text' : 'text-good-text')}>{fmt.rub0(r.result_rub)}</td></tr>)}</tbody></table></div>
    </Card>
  )
}

/** §11 разбивка по валютам, §18 ОВП и переоценка, §22 breakeven-курс, рублёвая доходность валютной части, carry. */
function FxTab() {
  const { portfolioId, asOf } = useScope()
  const [horizon, setHorizon] = useState(1)
  const cur = useByCurrency(portfolioId, asOf)
  const pos = useFxPosition(portfolioId, asOf)
  const an = useFxAnalytics(portfolioId, asOf, horizon)
  const sc = an.data?.scenarios ?? []
  const curs = [...new Set(sc.map((r) => r.currency))]
  const grid = [...new Set(sc.map((r) => r.fx_change_pct))]
  return (
    <div className="flex flex-col gap-3">
      <Card title="Разбивка по валютам" hint="MV в валюте и в рублях, DV01 в валюте бумаги, средние дюрация и доходность (без флоутеров)">
        <ErrorBanner error={cur.error} />
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="by-currency"><thead><tr><th>Валюта</th><th className="text-right">Позиций</th><th className="text-right">MV, валюта</th><th className="text-right">MV, ₽</th><th className="text-right">DV01, валюта</th><th className="text-right">DV01, ₽</th><th className="text-right">Дюрация</th><th className="text-right">YTM</th><th className="text-right">Портфель в валюте</th></tr></thead>
          <tbody>{(cur.data ?? []).map((r) => <tr key={r.currency}><td>{r.currency}{r.floaters ? <span className={cellSub}>флоутеров {r.floaters}</span> : null}</td><td className="text-right tabular-nums">{r.positions}</td><td className="text-right tabular-nums">{fmt.compact(r.mv_local, r.currency)}</td><td className="text-right tabular-nums">{fmt.compact(r.mv_net_rub)}</td><td className="text-right tabular-nums">{fmt.int(r.dv01_local)}</td><td className="text-right tabular-nums">{fmt.int(r.dv01_rub)}</td><td className="text-right tabular-nums">{fmt.num(r.duration_mac)}</td><td className="text-right tabular-nums">{fmt.pct(r.ytm_fixed_avg_pct)}</td><td className="text-right tabular-nums">{fmt.compact(r.portfolio_value_in_currency, r.currency)}</td></tr>)}</tbody></table></div>
      </Card>
      <Card title="Валютная позиция (ОВП) и переоценка" hint="бумаги по валюте номинала + касса + срочная секция (валютных фьючерсов нет); переоценка за день = позиция × изменение курса ЦБ к предыдущему рабочему дню; рубли — без переоценки">
        <ErrorBanner error={pos.error} />
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="fx-position"><thead><tr><th>Валюта</th><th className="text-right">Бумаги</th><th className="text-right">Касса</th><th className="text-right">Срочная секция</th><th className="text-right">Итого</th><th className="text-right">Итого, ₽</th><th className="text-right">Курс сегодня / вчера</th><th className="text-right">Переоценка, ₽</th><th className="text-right">Доля</th></tr></thead>
          <tbody>{(pos.data ?? []).map((r) => <tr key={r.currency}><td>{r.currency === 'RUB' ? 'Рубли (без переоценки)' : r.currency}</td><td className="text-right tabular-nums">{fmt.compact(r.bonds_local, r.currency)}</td><td className="text-right tabular-nums">{fmt.compact(r.cash_local, r.currency)}</td><td className="text-right tabular-nums">{fmt.int(r.futures_local)}</td><td className="text-right tabular-nums">{fmt.compact(r.position_local, r.currency)}</td><td className="text-right tabular-nums">{fmt.compact(r.position_rub)}</td><td className="text-right tabular-nums">{r.currency === 'RUB' ? '—' : `${fmt.num(r.fx_today, 4)} / ${fmt.num(r.fx_prev, 4)}`}</td><td className={cn('text-right tabular-nums', (r.revaluation_rub ?? 0) < 0 ? 'text-bad-text' : 'text-good-text')}>{r.revaluation_rub == null ? '—' : fmt.rub0(r.revaluation_rub)}</td><td className="text-right tabular-nums">{fmt.pct(r.share_pct, 1)}</td></tr>)}</tbody></table></div>
      </Card>
      {curs.length > 0 && (
        <Card title="Рублёвая доходность валютной части" hint={`R₽ = (1 + YTM)^T × (1 + ΔFX) − 1; безубыточность против рублёвой ставки (КБД на срок T): ΔFX* · удержание до горизонта, реинвестирование по той же ставке, без налогов`}
          actions={<div className={seg}>{[0.5, 1, 2, 3].map((h) => <button key={h} className={cn(segItem, horizon === h && segItemOn)} onClick={() => setHorizon(h)}>{h} г.</button>)}</div>}>
          <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl} data-testid="fx-scenarios"><thead><tr><th>Валюта</th><th className="text-right">YTM</th><th className="text-right">r₽</th>{grid.map((g) => <th key={g} className="text-right">ΔFX {g > 0 ? '+' : ''}{g} %</th>)}<th className="text-right">ΔFX*</th></tr></thead>
            <tbody>{curs.map((c) => { const rs = sc.filter((r) => r.currency === c); const f = rs[0]; return (
              <tr key={c}><td>{c}</td><td className="text-right tabular-nums">{fmt.pct(f.ytm_pct)}</td><td className="text-right tabular-nums">{fmt.pct(f.rub_rate_pct)}</td>
                {rs.map((r) => <td key={r.fx_change_pct} className={cn('text-right tabular-nums', r.rub_return_pct < (Math.pow(1 + f.rub_rate_pct / 100, horizon) - 1) * 100 ? 'text-bad-text' : 'text-good-text')}>{fmt.pct(r.rub_return_pct, 1)}</td>)}
                <td className="text-right tabular-nums font-medium">{fmt.pct(f.breakeven_fx_change_pct, 1)}</td></tr>) })}</tbody></table></div>
          {an.data?.carry && <div className="text-sm mt-2.5">Carry юаневого репо: YTM юаневых бумаг {fmt.pct(an.data.carry.ytm_cny_pct)} − RUSFAR CNY {fmt.pct(an.data.carry.rusfar_cny_pct)} ({fmt.date(an.data.carry.rusfar_date)}) = <b className={(an.data.carry.carry_pct ?? 0) < 0 ? 'text-bad-text' : 'text-good-text'}>{fmt.pct(an.data.carry.carry_pct)}</b> <span className="text-muted">· ставка овернайт волатильна, положительный carry не гарантирован</span></div>}
        </Card>
      )}
      {(an.data?.breakeven.length ?? 0) > 0 && (
        <Card title="Breakeven-курс валютных позиций" hint="FX_be ≈ FX покупки × цена покупки / текущая цена — курс, при котором позиция выходит в ноль в рублях">
          <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 360 }}><table className={tbl} data-testid="fx-breakeven"><thead><tr><th>Бумага</th><th className="text-right">Цена покупки / сейчас</th><th className="text-right">Курс покупки / сейчас</th><th className="text-right">FX_be</th><th className="text-right">До безубыточности</th></tr></thead>
            <tbody>{an.data!.breakeven.map((r) => <tr key={r.bond_id}><td>{r.short_name}<span className={cn(cellSub, 'font-mono')}>{r.isin}</span></td><td className="text-right tabular-nums">{fmt.num(r.price_purchase_pct)} / {fmt.num(r.price_now_pct)}</td><td className="text-right tabular-nums">{fmt.num(r.fx_purchase, 4)} / {fmt.num(r.fx_now, 4)}</td><td className="text-right tabular-nums">{fmt.num(r.fx_breakeven, 4)}</td><td className={cn('text-right tabular-nums', r.distance_pct > 0 ? 'text-bad-text' : 'text-good-text')}>{fmt.pct(r.distance_pct, 1)}</td></tr>)}</tbody></table></div>
        </Card>
      )}
    </div>
  )
}

function GapsTab() {
  const { asOf } = useScope()
  const q = usePriceGaps(asOf)
  return (
    <Card title="Пропуски котировок" hint={`бумаги портфелей без цены закрытия на ${fmt.date(asOf)}; применяется последняя котировка в окне 90 дней (locf)`}>
      <ErrorBanner error={q.error} />
      {q.data?.length ? (
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl}><thead><tr><th>Бумага</th><th>Погашение</th><th>Последняя котировка</th><th className="text-right">Цена</th><th className="text-right">Дней без цены</th><th>Правило</th></tr></thead>
          <tbody>{q.data.map((r) => <tr key={r.bond_id}><td>{r.short_name}<span className={cn(cellSub, 'font-mono')}>{r.isin}</span></td><td>{fmt.date(r.maturity_date)}</td><td>{fmt.date(r.last_price_date)}</td><td className="text-right tabular-nums">{fmt.num(r.last_close_pct)}</td><td className="text-right tabular-nums">{r.days_stale == null ? <span className={badge({ status: 'breach' })}>нет цены</span> : <span className={badge({ status: r.days_stale > 30 ? 'warning' : 'na' })}>{r.days_stale}</span>}</td><td className="text-muted">{r.fallback}</td></tr>)}</tbody></table></div>
      ) : <EmptyState title="Пропусков нет" hint={`у всех бумаг в портфелях есть цена закрытия на ${fmt.date(asOf)}`} />}
    </Card>
  )
}

function MigrationsTab() {
  const [issuer, setIssuer] = useState<ComboItem | null>(null)
  const q = useRatingMigrations(issuer?.id ?? null, issuer ? 200 : 60)
  const search = (s: string) => api.get<Page<Issuer>>('/issuers', { q: s || undefined, limit: 12 }).then((p) => p.items.map((i) => ({ id: i.issuer_id, label: i.short_name ?? i.name, sub: i.sector })))
  return (
    <Card title="Миграции рейтингов" hint={issuer ? `история по эмитенту и его выпускам` : 'последние рейтинговые действия по всем эмитентам; выберите эмитента для истории'} actions={<Combobox value={issuer} onChange={setIssuer} search={search} placeholder="эмитент…" width={320} />}>
      <ErrorBanner error={q.error} />
      {q.data?.length ? (
        <div className="flex flex-col gap-1.5">
          {q.data.map((r) => (
            <div key={r.rating_id} data-testid="migration-row" className="grid grid-cols-[86px_60px_1fr] gap-2.5 items-center text-[13px]" style={{ gridTemplateColumns: '86px 110px 1fr' }}>
              <span className="text-muted">{fmt.date(r.assigned_on)}</span>
              <span className="font-semibold tabular-nums">{r.prev_grade ? <><span className="text-muted">{r.prev_grade}</span> → </> : null}{r.grade}</span>
              <span>{r.action === 'upgraded' ? <span className="text-good-text">▲</span> : r.action === 'downgraded' ? <span className="text-bad-text">▼</span> : '•'} {labels.action[r.action] ?? r.action}{r.notches ? ` на ${Math.abs(r.notches)} ступ.` : ''} · {r.agency} · {r.scope === 'issue' ? `выпуск ${r.bond_name ?? ''}` : 'эмитент'}{!issuer && <span className="text-muted"> · {r.issuer_name}</span>}</span>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Записей нет" />}
    </Card>
  )
}

function CurveTab() {
  const { asOf, dataEnd } = useScope()
  const [cmp, setCmp] = useState<string>('')
  const a = useCurve(asOf)
  const b = useCurve(cmp || undefined)
  const series = [a.data && { name: `КБД ${fmt.date(a.data.curve_date)}`, color: 'var(--color-s1)', points: a.data.points }, cmp && b.data && { name: `КБД ${fmt.date(b.data.curve_date)}`, color: 'var(--color-s2)', points: b.data.points }].filter((s): s is { name: string; color: string; points: { tenor_years: number; rate_pct: number }[] } => !!s)
  return (
    <Card title="Кривая бескупонной доходности" hint="спот-ставки Московской биржи по срокам, % годовых; G-спред считается от ставки, интерполированной на дюрацию бумаги"
      actions={<div className="row flex items-center gap-2"><span className="text-muted text-xs">сравнить с</span><input type="date" className={input({ size: 'sm' })} value={cmp} onChange={(e) => setCmp(e.target.value)} max={dataEnd} /><div className={seg}>{[1, 3, 12].map((m) => <button key={m} className={cn(segItem, !!asOf && cmp === addMonths(asOf, -m) && segItemOn)} onClick={() => asOf && setCmp(addMonths(asOf, -m))}>−{m} мес.</button>)}</div></div>}>
      <ErrorBanner error={a.error} />
      {series.length > 1 && <div className={cn(legend, 'mb-1.5')}>{series.map((s) => <span key={s.name}><i className={legendKey} style={{ background: s.color }} /> {s.name}</span>)}</div>}
      <div data-testid="curve-chart"><CurveChart series={series} /></div>
      {a.data && <div className={cn(tableWrap, tableWrapFlat)} style={{ marginTop: 10 }}><table className={tbl}><thead><tr><th>Срок</th>{a.data.points.map((p) => <th key={p.tenor_years} className="text-right">{p.tenor_years < 1 ? `${p.tenor_years * 12} мес.` : `${p.tenor_years} л.`}</th>)}</tr></thead>
        <tbody><tr><td>{fmt.date(a.data.curve_date)}</td>{a.data.points.map((p) => <td key={p.tenor_years} className="text-right tabular-nums">{fmt.num(p.rate_pct)}</td>)}</tr>{cmp && b.data && <tr><td>{fmt.date(b.data.curve_date)}</td>{b.data.points.map((p) => <td key={p.tenor_years} className="text-right tabular-nums">{fmt.num(p.rate_pct)}</td>)}</tr>}</tbody></table></div>}
    </Card>
  )
}
