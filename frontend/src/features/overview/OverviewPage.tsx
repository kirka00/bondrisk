import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCash, useDeposit, useLimitFacts, usePositions, useRisk, useRunEod, useStress } from '../../api/hooks'
import type { LimitFact, RiskSnapshot, Totals } from '../../api/types'
import { useIsMobile } from '../../app/media'
import { useScope } from '../../app/scope'
import { TvChart, type TvSeries } from '../../components/charts/TvChart'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Dialog } from '../../components/ui/Dialog'
import { FormulaBlock } from '../../components/ui/Formula'
import { InfoButton } from '../../components/ui/InfoButton'
import { Meter } from '../../components/ui/Meter'
import { Delta, EmptyState, ErrorBanner, errorText } from '../../components/ui/Misc'
import { Popover } from '../../components/ui/Popover'
import { Segmented } from '../../components/ui/Segmented'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/Toast'
import { Tip } from '../../components/ui/Tooltip'
import { countOf, fmt, fmtLimitValue, issuerShort, labels, parseNum } from '../../lib/format'
import type { FormulaKey } from '../../lib/formulas'
import { banner, button, cn, dialogActions, field, grid2, input, kv, pageHead, pageSub, tableWrap, tableWrapFlat, tbl, tileLabel, tileValue } from '../../lib/ui'

/** Полоса показателей: зазор 1px на фоне рамки рисует разделители при любом числе колонок. */
const statGrid = 'grid gap-px bg-border border border-border rounded-card overflow-hidden'
const STATUS_ORDER: Record<string, number> = { breach: 0, warning: 1, waived: 2, ok: 3, 'n/a': 4 }

export function OverviewPage() {
  const { portfolio, portfolioId, asOf, dataEnd, holdings, isRiskManager, canTrade } = useScope()
  const mobile = useIsMobile()
  const pos = usePositions(portfolioId, asOf, holdings)
  const risk = useRisk(portfolioId)
  const facts = useLimitFacts(portfolioId, asOf, holdings)
  const stress = useStress(portfolioId, asOf, holdings)
  const cash = useCash(portfolioId)
  const [chart, setChart] = useState<'dv01' | 'mv'>('dv01')

  const history = useMemo(() => risk.data?.history ?? [], [risk.data])
  const totals: Totals | undefined = pos.data?.totals
  // предыдущий снапшот относительно даты оценки — для дельт
  const prev = useMemo<RiskSnapshot | undefined>(() => {
    if (!asOf) return undefined
    return history.filter((h) => h.as_of < asOf).at(-1)
  }, [history, asOf])
  const d = (key: keyof Totals): number | null => {
    const a = totals?.[key], b = prev?.[key]
    return prev && typeof a === 'number' && typeof b === 'number' ? a - b : null
  }
  const limitRows = useMemo(() => [...(facts.data ?? [])].sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || ((b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))), [facts.data])
  const worst = useMemo(() => (stress.data ?? []).filter((s) => (s.pnl_rub ?? 0) < 0).sort((a, b) => (a.pnl_rub ?? 0) - (b.pnl_rub ?? 0))[0], [stress.data])

  if (!portfolio) return <EmptyState title="Нет портфелей" hint="Загрузите демо-данные: make demo" />

  // про-форма (ретроспектива текущего состава) рисуется пунктиром отдельной серией, стык — общая точка
  const pf = history.filter((h) => h.is_proforma)
  const act = history.filter((h) => !h.is_proforma)
  const pfPlus = pf.length && act.length ? [...pf, act[0]] : pf
  const hasPf = pf.length > 0
  const mvAxis = (v: number) => `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} млн`
  const pick = (rows: RiskSnapshot[], key: 'dv01' | 'mv_net' | 'mv_gross') => rows.map((h) => ({ time: h.as_of, value: h[key] }))
  const chartDv01: TvSeries[] = [
    ...(hasPf ? [{ id: 'dv01pf', name: 'DV01 про-форма', color: 's1', kind: 'line' as const, data: pick(pfPlus, 'dv01'), precision: 0, format: fmt.rub0, dashed: true, lastValue: false }] : []),
    ...(act.length ? [{ id: 'dv01', name: hasPf ? 'DV01 факт' : 'DV01, ₽', color: 's1', kind: 'area' as const, data: pick(act, 'dv01'), precision: 0, format: fmt.rub0 }] : []),
  ]
  const sameMv = history.every((h) => Math.abs(h.mv_gross - h.mv_net) < 1)
  const chartMv: TvSeries[] = sameMv
    ? [
      ...(hasPf ? [{ id: 'netpf', name: 'MV про-форма', color: 's1', kind: 'line' as const, data: pick(pfPlus, 'mv_net'), precision: 0, format: mvAxis, dashed: true, lastValue: false }] : []),
      ...(act.length ? [{ id: 'net', name: hasPf ? 'MV факт' : 'MV, ₽', color: 's1', kind: 'area' as const, data: pick(act, 'mv_net'), precision: 0, format: mvAxis }] : []),
    ]
    : [
      { id: 'gross', name: 'MV брутто', color: 's2', kind: 'line', data: pick(history, 'mv_gross'), precision: 0, format: mvAxis, lastValue: false },
      { id: 'net', name: 'MV нетто', color: 's1', kind: 'line', data: pick(history, 'mv_net'), precision: 0, format: mvAxis },
    ]
  const pfHint = hasPf ? ` · до ${fmt.date(act[0]?.as_of ?? pf.at(-1)?.as_of)} пунктиром — ретроспектива текущего состава` : ''
  const chartHint = chart === 'dv01' ? `снапшоты EOD, ₽ за 1 б.п.${pfHint}` : `${sameMv ? 'коротких позиций нет — нетто = брутто' : 'брутто и нетто'}, ₽${pfHint}`

  const t = totals
  const isSovereignOnly = t?.g_spread_avg_bp == null && (pos.data?.items.length ?? 0) > 0 && pos.data!.items.every((p) => p.is_sovereign)
  const bigMv = t != null && Math.abs(t.mv_net) >= 1e9
  const otherCash = (cash.data ?? []).filter((c) => c.currency !== 'RUB' && Math.abs(c.balance) > 0)
  const rubCash = (cash.data ?? []).find((c) => c.currency === 'RUB')
  // остатки по валютам API отдаёт только текущие; на прошлую дату — итог в рублях из оценки портфеля
  const cashNow = !asOf || !dataEnd || asOf >= dataEnd
  const vsPrev = prev ? `к ${fmt.date(prev.as_of)}` : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className={pageHead}>
        <div>
          <h1>Обзор — {portfolio.name}</h1>
          <div className={pageSub}>Оценка на {fmt.date(asOf)}{holdings ? ` · состав на ${fmt.date(holdings)}` : ''} · {t ? countOf(t.positions_count, ['позиция', 'позиции', 'позиций']) : '…'}{prev ? ` · изменения к срезу ${fmt.date(prev.as_of)}` : ''}</div>
        </div>
        <div className="row flex items-center gap-2">
          {canTrade && <DepositButton />}
          {(isRiskManager || canTrade) && <EodButton />}
        </div>
      </div>
      <ErrorBanner error={pos.error} />

      <section className={cn(statGrid, 'grid-cols-[minmax(300px,1.15fr)_repeat(4,minmax(0,1fr))] max-lg:grid-cols-4 max-md:grid-cols-2')} data-testid="kpi-grid">
        <div className="hero bg-surface px-5 py-4 flex flex-col justify-center gap-1.5 max-lg:col-span-4 max-md:col-span-2 max-md:px-4" data-testid="hero">
          <div className="text-muted text-xs flex items-center gap-2">Рыночная стоимость, нетто <InfoButton k="mv" hint="Сумма рыночных стоимостей позиций с учётом знака; брутто — сумма модулей." /></div>
          {bigMv
            ? <Tip content={fmt.money(t?.mv_net, 'RUB', 2)}><div className="text-[36px] font-semibold tracking-[-0.03em] leading-none max-md:text-[30px]" data-testid="hero-value">{fmt.compact(t?.mv_net)}</div></Tip>
            : <div className="text-[36px] font-semibold tracking-[-0.03em] leading-none whitespace-nowrap max-md:text-[30px] max-[380px]:text-[26px]" data-testid="hero-value">{fmt.money(t?.mv_net, 'RUB', 0)}</div>}
          <div className="flex flex-col gap-0.5">
            {prev && <Delta value={d('mv_net')} digits={0} suffix=" ₽" hint={`за день, ${vsPrev}`} />}
            <span className="text-text-2 text-xs">брутто {bigMv ? fmt.compact(t?.mv_gross) : fmt.money(t?.mv_gross, 'RUB', 0)} · касса {fmt.compact(t?.cash_total_rub)}</span>
          </div>
        </div>
        <Stat label="DV01" value={fmt.rub0(t?.dv01)} sub="на 1 б.п." hint="Нетто-чувствительность к сдвигу ставок на 1 б.п., с учётом знака позиций." delta={d('dv01')} digits={0} k="dv01" vals={{ mv: t?.mv_gross, dmod: t?.duration_mod, dv01: t?.dv01 }} />
        <Stat label="VaR 99 % / 1 день" value={fmt.rub0(t?.var_99_1d)} hint="Параметрический: |DV01| × 2,326 × 32 б.п." delta={d('var_99_1d')} digits={0} k="var" vals={{ dv01: t?.dv01, var: t?.var_99_1d }} />
        <Stat label="Дюрация" value={fmt.years(t?.duration_mac)} sub={`мод. ${fmt.num(t?.duration_mod)}`} hint="Дюрация Маколея, средневзвешенная по |MV| облигаций." delta={d('duration_mac')} digits={2} k="dmac" vals={{ dmac: t?.duration_mac, dmod: t?.duration_mod, y: t?.ytm_avg }} />
        <Stat label="YTM средняя" value={fmt.pct(t?.ytm_avg)} sub={`текущая ${fmt.pct(t?.current_yield_avg)}`} hint="Эффективная годовая доходность, взвешенная по |MV|." delta={d('ytm_avg')} digits={2} suffix=" п.п." k="ytm" />
      </section>

      <section className={cn(statGrid, 'grid-cols-6 max-lg:grid-cols-3 max-md:grid-cols-2')} data-testid="kpi-grid-2">
        <Stat small label="Средний рейтинг" value={t?.rating_grade ?? '—'} sub={`балл ${fmt.num(t?.rating_score)}`} hint="Балл по шкале AAA = 1 … D = 22, взвешенный по |MV|; показана ближайшая ступень." delta={d('rating_score')} digits={2} k="rating" vals={{ score: t?.rating_score, grade: t?.rating_grade }} />
        <Stat small label="ADV01" value={fmt.rub0(t?.adv01)} hint="Кредитно-взвешенный DV01: нетто-DV01 рейтингового бакета × коэффициент." delta={d('adv01')} digits={0} k="adv01" />
        {isSovereignOnly
          ? <Stat small label="G-спред средний" value="н/д" na sub="только суверенные бумаги" hint="Средний спред считается по рублёвым несуверенным бумагам с фиксированным купоном." delta={null} digits={0} k="gspread" />
          : <Stat small label="G-спред средний" value={fmt.bp(t?.g_spread_avg_bp)} hint="Взвешен по |MV| бумаг в коридоре [−200; 3000] б.п., без суверенных и дефолтных." delta={d('g_spread_avg_bp')} digits={0} suffix=" б.п." k="gspread" />}
        <Stat small label="Флоутеры: DM" value={t?.floater_share_pct ? fmt.bp(t?.dm_avg_bp) : '—'} na={!t?.floater_share_pct} sub={`доля флоутеров ${fmt.pct(t?.floater_share_pct, 1)}`} hint="Дисконтная маржа — премия к референсной ставке, при которой цена флоутера сходится с рыночной; средняя по |MV| флоутеров с определённой маржой. Доля — от брутто-стоимости." delta={d('dm_avg_bp')} digits={0} suffix=" б.п." k="dm" />
        <Stat small label="Касса" value={fmt.compact(cashNow ? rubCash?.balance ?? t?.cash_total_rub : t?.cash_total_rub)} sub={cashNow && otherCash.length ? otherCash.map((c) => fmt.compact(c.balance, c.currency)).join(' · ') : cashNow ? undefined : 'в рублях на дату оценки'} hint={`Остатки по валютам: ${(cash.data ?? []).map((c) => fmt.money(c.balance, c.currency, 2)).join(' · ') || '—'}. Итого в рублях по курсу ЦБ: ${fmt.money(t?.cash_total_rub, 'RUB', 0)}.`} delta={d('cash_total_rub')} digits={0} suffix=" ₽" k="cash" />
        <Stat small className="max-lg:col-span-2 max-md:col-span-2" label="Худший стресс" value={worst ? fmt.compact(worst.pnl_rub) : '—'} na={!worst} hint="Наибольший убыток среди сценариев стресс-теста на дату оценки." delta={null} digits={0} k="stress"
          sub={worst ? <>{worst.code} · {fmt.pct(worst.pnl_pct_of_mv, 1)} MV · <Link to={{ pathname: '/reports', search: withTab('stress') }}>все сценарии</Link></> : stress.data?.length ? 'убыточных сценариев нет' : 'нет позиций'} />
      </section>

      <div className="grid gap-4 grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)] max-lg:grid-cols-1">
        <Card>
          {history.length > 1 ? (
            <>
              <div className="flex items-start justify-between gap-3 mb-1 max-md:flex-col max-md:gap-2">
                <div className="min-w-0"><h2 className="text-sm">{chart === 'dv01' ? 'DV01 портфеля' : 'Стоимость портфеля'}</h2><div className="text-muted text-xs">{chartHint}</div></div>
                <Segmented value={chart} onChange={setChart} options={[{ value: 'dv01', label: 'DV01' }, { value: 'mv', label: 'Стоимость' }]} ariaLabel="Показатель" testId="chart-switch" />
              </div>
              <TvChart key={chart} series={chart === 'dv01' ? chartDv01 : chartMv} height={mobile ? 220 : 380} loading={risk.isFetching} defaultRange="ALL" testId="chart-main" />
            </>
          ) : history.length === 1
            ? <EmptyState title="Пока один снапшот" hint={`DV01 ${fmt.rub0(history[0].dv01)} на ${fmt.date(history[0].as_of)} — история появится после следующих расчётов EOD`} />
            : <EmptyState title="Нет снапшотов" hint="Запустите расчёт EOD — появятся история DV01 и стоимости" />}
        </Card>
        <Card title="Лимиты" hint={`загрузка на ${fmt.date(asOf)}`} actions={<Link className={button({ variant: 'ghost', size: 'sm' })} to={{ pathname: '/risk', search: location.search }}>все лимиты →</Link>}>
          {limitRows.length ? <div data-testid="limits-list">{limitRows.map((f) => <LimitRow key={f.limit_id} f={f} />)}</div>
            : facts.isPending ? <div className="text-muted text-sm py-6 text-center">загрузка…</div>
            : <EmptyState title="Лимиты не заданы" hint="Без лимитов сделки не блокируются, а EOD не фиксирует нарушения" action={<Link className={button({ size: 'sm' })} to={{ pathname: '/risk', search: location.search }}>Задать лимиты →</Link>} />}
        </Card>
      </div>
    </div>
  )
}

function withTab(tab: string): string {
  const sp = new URLSearchParams(location.search)
  sp.set('tab', tab)
  return `?${sp.toString()}`
}

/** Показатель в полосе KPI. Изменение без оценки «хорошо/плохо»: рост DV01 — решение, а не ошибка. */
function Stat({ label, value, sub, hint, delta, digits, suffix, k, vals, na, small, className }: { className?: string; label: string; value: string; sub?: ReactNode; hint?: string; delta: number | null; digits: number; suffix?: string; k: FormulaKey; vals?: Record<string, number | string | null | undefined>; na?: boolean; small?: boolean }) {
  return (
    <div className={cn('bg-surface px-4 py-3.5 flex flex-col gap-1 min-w-0 max-md:px-3.5', small && 'py-3', className)} data-testid="kpi-tile">
      <div className={tileLabel}><span>{label}</span><InfoButton k={k} values={vals} hint={hint} /></div>
      <div className={cn(tileValue, small ? 'text-[17px]' : 'text-[22px]', na && 'text-muted font-medium')}>{value}</div>
      <div className="text-xs text-text-2 flex flex-wrap gap-x-2 gap-y-0.5 items-center min-h-4">
        {delta != null && <Delta value={delta} neutral digits={digits} suffix={suffix} flatText="без изменений" />}
        {sub && <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{sub}</span>}
      </div>
    </div>
  )
}

function LimitRow({ f }: { f: LimitFact }) {
  const name = labels.metric[f.metric] ?? f.metric
  return (
    <Popover hover trigger={
      <div className="flex flex-col gap-1.5 py-2.5 border-t border-border first:border-t-0 first:pt-1 cursor-pointer rounded-md hover:bg-wash hover:-mx-2 hover:px-2" role="button" tabIndex={0} data-testid="limit-row" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}>
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}{f.scope && <span className="text-muted"> · {issuerShort(f.scope, 28)}</span>}</span>
          <span className="flex items-center gap-2 flex-none"><span className="tabular-nums font-medium">{fmt.pct(f.utilization_pct, 0)}</span>{f.status !== 'ok' && <StatusBadge status={f.status} />}</span>
        </div>
        <Meter pct={f.utilization_pct} status={f.status} />
      </div>
    }>
      <h4>{name}{f.scope ? ` — ${issuerShort(f.scope, 48)}` : ''}</h4>
      <dl className={kv}>
        <dt>Факт</dt><dd>{fmtLimitValue(f.metric, f.fact_value)}</dd>
        <dt>Лимит</dt><dd>{fmtLimitValue(f.metric, f.limit_value)}</dd>
        <dt>Загрузка</dt><dd>{fmt.pct(f.utilization_pct, 1)} (предупреждение с {fmt.pct(f.warning_pct, 0)})</dd>
        <dt>Сторона</dt><dd>{labels.side[f.side]}</dd>
        <dt>Тип</dt><dd>{f.is_hard ? 'жёсткий — блокирует сделку' : 'мягкий — только предупреждение'}</dd>
      </dl>
      <div className="mt-2"><FormulaBlock k="utilization" values={{ fact: f.fact_value, limit: f.limit_value, u: f.utilization_pct }} /></div>
    </Popover>
  )
}

function EodButton() {
  const { portfolio, portfolioId, asOf } = useScope()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(asOf ?? '')
  const run = useRunEod(portfolioId)
  // до первой сделки снапшот — про-форма текущего состава; без даты состава он перезаписался бы нулевым
  const inception = portfolio?.inception_date ?? undefined
  const holdings = inception && date && date < inception ? inception : undefined
  const toast = useToast()
  return (
    <>
      <Button variant="primary" onClick={() => { setDate(asOf ?? ''); run.reset(); setOpen(true) }} data-testid="eod-open">Рассчитать EOD</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Расчёт на конец дня">
        <p className="text-text-2" style={{ marginBottom: 12 }}>Снапшот позиций и портфеля на дату, сверка с лимитами, фиксация нарушений. Повторный расчёт за ту же дату перезаписывает снапшот, снятые нарушения сохраняются, если лимит не менялся.</p>
        <label className={field}><span>Дата расчёта</span><input type="date" className={input()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {holdings && <div className={cn(banner({ kind: 'info' }), 'mt-2.5')}>Портфель сформирован {fmt.date(holdings)} — на эту дату будет рассчитан про-форма снапшот текущего состава; нарушения лимитов по нему не фиксируются.</div>}
        {run.error && <div style={{ marginTop: 10 }}><ErrorBanner error={run.error} /></div>}
        {run.data && <EodResult r={run.data} />}
        <div className={dialogActions}>
          <Button onClick={() => setOpen(false)}>Закрыть</Button>
          <Button variant="primary" disabled={!date || run.isPending} onClick={() => run.mutate({ asOf: date, holdings }, { onSuccess: () => toast(`EOD за ${fmt.date(date)} рассчитан`, 'success'), onError: (e) => toast(errorText(e), 'error') })}>{run.isPending ? 'Считаем…' : 'Рассчитать'}</Button>
        </div>
      </Dialog>
    </>
  )
}

function EodResult({ r }: { r: NonNullable<ReturnType<typeof useRunEod>['data']> }): ReactNode {
  return (
    <div className="flex flex-col gap-3 mt-3">
      <div className={banner({ kind: 'info' })}>Снапшот на {fmt.date(r.as_of)}: MV брутто {fmt.compact(r.snapshot?.mv_gross)}, DV01 {fmt.rub0(r.snapshot?.dv01)}, VaR {fmt.rub0(r.snapshot?.var_99_1d)}, рейтинг {r.snapshot?.rating_grade ?? '—'}.</div>
      {r.breaches.length ? (
        <div className={cn(tableWrap, tableWrapFlat)}><table className={tbl}><thead><tr><th>Лимит</th><th>Объект</th><th className="text-right">Утилизация</th><th>Статус</th></tr></thead>
          <tbody>{r.breaches.map((b) => <tr key={b.breach_id}><td>{labels.metric[b.metric] ?? b.metric}</td><td>{b.scope ?? 'портфель'}</td><td className="text-right tabular-nums">{fmt.pct(b.utilization_pct, 1)}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody></table></div>
      ) : <div className={banner({ kind: 'info' })}>Нарушений и предупреждений нет.</div>}
    </div>
  )
}

function DepositButton() {
  const { portfolioId } = useScope()
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState('RUB')
  const [amount, setAmount] = useState('1000000')
  const [note, setNote] = useState('')
  const dep = useDeposit(portfolioId)
  const toast = useToast()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Пополнить кассу</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Пополнение кассы">
        <div className={grid2}>
          <div className={field}><span>Валюта</span><Segmented value={cur} onChange={setCur} options={['RUB', 'USD', 'EUR', 'CNY'].map((c) => ({ value: c, label: c }))} ariaLabel="Валюта" className="w-full [&>*]:flex-1" /></div>
          <label className={field}><span>Сумма</span><input className={input({ num: true })} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <label className={field} style={{ marginTop: 10 }}><span>Комментарий</span><input className={input()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="пополнение" /></label>
        {dep.error && <div style={{ marginTop: 10 }}><ErrorBanner error={dep.error} /></div>}
        <div className={dialogActions}>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" disabled={!(parseNum(amount) > 0) || dep.isPending} onClick={() => dep.mutate({ currency: cur, amount: parseNum(amount), note: note || undefined }, { onSuccess: () => { toast('Касса пополнена', 'success'); setOpen(false) } })}>Пополнить</Button>
        </div>
      </Dialog>
    </>
  )
}
