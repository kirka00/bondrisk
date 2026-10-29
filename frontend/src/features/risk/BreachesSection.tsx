import { Fragment, useMemo, useState } from 'react'
import { useBreaches, useRisk, useWaive } from '../../api/hooks'
import type { Breach } from '../../api/types'
import { useIsMobile } from '../../app/media'
import { useScope } from '../../app/scope'
import { Button } from '../../components/ui/Button'
import { Section } from '../../components/ui/Card'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorBanner, Pager, errorText } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { Select } from '../../components/ui/Select'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/Toast'
import { Tip } from '../../components/ui/Tooltip'
import { countOf, fmt, fmtLimitValue, issuerShort, labels } from '../../lib/format'
import { cap, cellSub, cn, dialogActions, field, groupRow, input, mcard, mcardActions, mcardHead, mcardKv, mcardSub, tableWrap, tableWrapPage, tbl, tblDense, textarea } from '../../lib/ui'

const LIMIT = 50
const STATUS_OPTS = [{ value: 'all', label: 'все статусы' }, { value: 'breach', label: 'нарушения' }, { value: 'warning', label: 'предупреждения' }, { value: 'waived', label: 'снятые' }]

function counts(rows: Breach[]): string {
  const c = { breach: 0, warning: 0, waived: 0 }
  for (const r of rows) c[r.status]++
  const parts = [
    c.breach && countOf(c.breach, ['нарушение', 'нарушения', 'нарушений']),
    c.warning && countOf(c.warning, ['предупреждение', 'предупреждения', 'предупреждений']),
    c.waived && `${c.waived} снято`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Журнал нарушений по расчётам EOD: последний расчёт или вся история, снятие — риск-менеджером. */
export function BreachesSection() {
  const { portfolioId, isRiskManager } = useScope()
  const mobile = useIsMobile()
  const [status, setStatus] = useState('all')
  const [scope, setScope] = useState<'latest' | 'all'>('latest')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [sel, setSel] = useState<Breach | null>(null)
  const [reason, setReason] = useState('')
  // последний фактический расчёт EOD (не дата последнего нарушения: после него могли быть «чистые» расчёты)
  const risk = useRisk(portfolioId)
  const latest = [...(risk.data?.history ?? [])].reverse().find((h) => !h.is_proforma)?.as_of
  const dateFrom = scope === 'latest' ? latest : from || undefined
  const dateTo = scope === 'latest' ? latest : to || undefined
  const q = useBreaches({ portfolio_id: portfolioId ?? undefined, status: status === 'all' ? undefined : status, date_from: dateFrom, date_to: dateTo, limit: LIMIT, offset })
  const waive = useWaive()
  const toast = useToast()
  const groups = useMemo(() => {
    const m = new Map<string, Breach[]>()
    for (const b of q.data?.items ?? []) m.set(b.as_of, [...(m.get(b.as_of) ?? []), b])
    return Array.from(m.entries())
  }, [q.data])
  const openWaive = (b: Breach) => { setSel(b); setReason('') }

  const hint = scope === 'latest'
    ? latest ? `последний расчёт EOD — ${fmt.date(latest)}` : 'расчётов EOD с нарушениями ещё не было'
    : `вся история расчётов EOD${q.data ? ` · ${countOf(q.data.total, ['запись', 'записи', 'записей'])}` : ''}`
  return (
    <Section title="Журнал нарушений" hint={hint} id="breaches" actions={
      <>
        <Segmented value={scope} onChange={(v) => { setScope(v); setOffset(0) }} options={[{ value: 'latest', label: 'последний расчёт' }, { value: 'all', label: 'вся история' }]} ariaLabel="Период" />
        <Select value={status} onChange={(v) => { setStatus(v); setOffset(0) }} options={STATUS_OPTS} ariaLabel="Статус" testId="breach-status" width={170} />
        {scope === 'all' && <span className="flex items-center gap-1.5 text-xs text-muted">с <input type="date" className={input()} value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0) }} aria-label="С даты" /> по <input type="date" className={input()} value={to} onChange={(e) => { setTo(e.target.value); setOffset(0) }} aria-label="По дату" /></span>}
      </>
    }>
      <ErrorBanner error={q.error} />
      {!q.isPending && groups.length === 0 ? <EmptyState title="Нарушений нет" hint={!latest ? 'EOD ещё не рассчитывался' : scope === 'latest' ? `в расчёте за ${fmt.date(latest)} лимиты не нарушены` : 'по выбранным фильтрам записей нет'} /> : mobile ? (
        <div className="flex flex-col gap-2" data-testid="breaches-table" data-mode="cards">
          {groups.map(([date, rows]) => (
            <Fragment key={date}>
              <div className={cn(cap, 'mt-1.5')}>{fmt.date(date)} · {counts(rows)}</div>
              {rows.map((b) => (
                <div key={b.breach_id} className={mcard} data-testid="breach-row">
                  <div className={mcardHead}><b>{labels.metric[b.metric]}</b><StatusBadge status={b.status} /></div>
                  <div className={mcardSub}><span>{b.is_hard ? 'жёсткий' : 'мягкий'}</span>{b.scope && <span title={b.scope}>· {issuerShort(b.scope, 36)}</span>}</div>
                  <div className={mcardKv}>
                    <span><span className="k">Факт</span><span className="v">{fmtLimitValue(b.metric, b.fact_value)}</span></span>
                    <span><span className="k">Лимит</span><span className="v">{fmtLimitValue(b.metric, b.limit_value)}</span></span>
                    <span><span className="k">Загрузка</span><span className="v">{fmt.pct(b.utilization_pct, 1)}</span></span>
                  </div>
                  {b.status === 'waived' ? <div className="text-text-2 text-xs">{b.waived_by_name} · {fmt.dateTime(b.waived_at)}<br />{b.waive_reason}</div>
                    : isRiskManager && <div className={mcardActions}><Button size="sm" onClick={() => openWaive(b)} data-testid="waive-btn">Снять</Button></div>}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className={cn(tableWrap, tableWrapPage, 'transition-opacity', q.isFetching && 'opacity-60')} data-testid="breaches-table">
          <table className={cn(tbl, tblDense)}>
            <thead><tr><th>Лимит</th><th className="text-right">Факт</th><th className="text-right">Лимит</th><th className="text-right">Загрузка</th><th>Статус</th><th>Снятие</th></tr></thead>
            <tbody>
              {groups.map(([date, rows]) => (
                <Fragment key={date}>
                  <tr className={groupRow}><td colSpan={6}>{fmt.date(date)} <span className="text-muted font-normal">· {counts(rows)}</span></td></tr>
                  {rows.map((b) => (
                    <tr key={b.breach_id} data-testid="breach-row">
                      <td><span>{labels.metric[b.metric]} <span className="text-muted text-xs">{b.is_hard ? 'жёсткий' : 'мягкий'}</span>{b.scope && <span className={cellSub} title={b.scope}>{issuerShort(b.scope, 40)}</span>}</span></td>
                      <td className="text-right tabular-nums">{fmtLimitValue(b.metric, b.fact_value)}</td>
                      <td className="text-right tabular-nums">{fmtLimitValue(b.metric, b.limit_value)}</td>
                      <td className="text-right tabular-nums">{fmt.pct(b.utilization_pct, 1)}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="whitespace-normal max-w-[420px]">
                        {b.status === 'waived'
                          ? <span className="text-text-2 text-xs"><b className="font-medium">{b.waived_by_name}</b> · {fmt.dateTime(b.waived_at)}<span className={cn(cellSub, 'whitespace-normal')}>{b.waive_reason}</span></span>
                          : isRiskManager ? <Button size="sm" onClick={() => openWaive(b)} data-testid="waive-btn">Снять</Button> : <Tip content="Снимать нарушения может только риск-менеджер или администратор"><span className="text-muted text-xs">—</span></Tip>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.total > LIMIT && <Pager total={q.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      <Dialog open={!!sel} onOpenChange={(o) => { if (!o) setSel(null) }} title="Снять нарушение">
        {sel && <p className="text-text-2 mb-2.5">{labels.metric[sel.metric]}{sel.scope ? ` — ${issuerShort(sel.scope, 48)}` : ''} на {fmt.date(sel.as_of)}: факт {fmtLimitValue(sel.metric, sel.fact_value)}, лимит {fmtLimitValue(sel.metric, sel.limit_value)} ({fmt.pct(sel.utilization_pct, 1)}). Снятие действует, пока лимит и его статус не изменились.</p>}
        <label className={field}><span>Обоснование (не менее 5 символов)</span><textarea className={textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="решение инвестиционного комитета, план сокращения позиции…" data-testid="waive-reason" /></label>
        {waive.error && <div className="mt-2"><ErrorBanner error={waive.error} /></div>}
        <div className={dialogActions}><Button onClick={() => setSel(null)}>Отмена</Button><Button variant="primary" disabled={reason.trim().length < 5 || waive.isPending} onClick={() => sel && waive.mutate({ id: sel.breach_id, reason }, { onSuccess: () => { toast('Нарушение снято', 'success'); setSel(null) }, onError: (e) => toast(errorText(e), 'error') })}>Снять</Button></div>
      </Dialog>
    </Section>
  )
}
