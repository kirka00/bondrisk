import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useDeleteLimit, useSaveLimit } from '../../api/hooks'
import type { Bond, Issuer, Limit, LimitBasis, LimitFact, LimitInput, LimitMetric, LimitSide, Page } from '../../api/types'
import { useScope } from '../../app/scope'
import { Button } from '../../components/ui/Button'
import { Combobox, type ComboItem } from '../../components/ui/Combobox'
import { DataTable } from '../../components/ui/DataTable'
import { Dialog } from '../../components/ui/Dialog'
import { Meter } from '../../components/ui/Meter'
import { ErrorBanner, errorText } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { Select } from '../../components/ui/Select'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/Toast'
import { Tip } from '../../components/ui/Tooltip'
import { fmt, fmtLimitValue, issuerShort, labels, parseNum } from '../../lib/format'
import { cellSub, chip, cn, dialogActions, field, grid2, input, mcardHead, mcardSub } from '../../lib/ui'

const METRICS = Object.keys(labels.metric) as LimitMetric[]
const STATUS_ORDER: Record<string, number> = { breach: 0, warning: 1, waived: 2, ok: 3, 'n/a': 4 }

/** Лимит вместе с фактом на дату оценки (факта нет, если лимит на эту дату не действует). */
export type LimitRow = Limit & { fact?: LimitFact }

export function joinLimits(limits: Limit[], facts: LimitFact[]): LimitRow[] {
  const byId = new Map(facts.map((f) => [f.limit_id, f]))
  return limits
    .map((l) => ({ ...l, fact: byId.get(l.limit_id) }))
    .sort((a, b) => (STATUS_ORDER[a.fact?.status ?? 'n/a'] - STATUS_ORDER[b.fact?.status ?? 'n/a']) || ((b.fact?.utilization_pct ?? -1) - (a.fact?.utilization_pct ?? -1)))
}

/** Доля брутто: лимиты DV01 и VaR — сотые доли процента, при одном знаке они превращались в «0,0 %». */
const pctGross = (v: number) => `${fmt.pct(v, v < 0.1 ? 4 : v < 10 ? 2 : 1)} брутто`

function threshold(l: Limit): string {
  if (l.threshold_abs != null) return fmtLimitValue(l.metric, l.threshold_abs)
  if (l.threshold_pct != null) return pctGross(l.threshold_pct)
  return '—'
}
const kind = (hard: boolean) => <span className={cn(chip, hard && 'bg-wash-2 text-text')}>{hard ? 'жёсткий' : 'мягкий'}</span>
const CONC: LimitMetric[] = ['conc_issuer', 'conc_issue', 'conc_sector', 'conc_portfolio']
const GRADES = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC']

/** factsLoading — факты ещё считаются: не писать «не действует» про только что созданный лимит. */
export function LimitsTable({ rows, onEdit, factsLoading }: { rows: LimitRow[]; onEdit?: (l: Limit) => void; factsLoading?: boolean }) {
  const noFact = factsLoading ? 'считаем загрузку…' : 'не действует на дату'
  const columns = useMemo<ColumnDef<LimitRow, unknown>[]>(() => [
    { header: 'Лимит', id: 'metric', accessorFn: (r) => labels.metric[r.metric], cell: ({ row: { original: l } }) => <span>{labels.metric[l.metric]}{l.scope && <span className={cellSub} title={l.scope}>{issuerShort(l.scope, 40)}</span>}</span> },
    { header: 'Тип', accessorKey: 'is_hard', cell: ({ row: { original: l } }) => <span className="inline-flex gap-1">{kind(l.is_hard)}{l.committee && <Tip content={`Регламент: ${l.committee === 'IC' ? 'инвестиционный комитет' : 'комитет по рискам'}${l.self_adjust_pct ? `; самостоятельная корректировка до ${fmt.pct(l.self_adjust_pct, 0)}, сверх — совет директоров` : ''}`}><span className={chip}>{l.committee === 'IC' ? 'ИК' : 'КРМ'}</span></Tip>}</span> },
    { header: 'Факт', id: 'fact', meta: { align: 'right' }, accessorFn: (r) => r.fact?.fact_value ?? null, cell: ({ row: { original: l } }) => l.fact ? <span>{fmtLimitValue(l.metric, l.fact.fact_value)}{CONC.includes(l.metric) && <span className={cellSub}>{labels.basis[l.basis]}{l.basis !== 'market' ? ` · рынок ${fmt.rub0(l.fact.fact_market)}` : ''}{l.fact.share_fact_pct != null ? ` · ${fmt.pct(l.fact.share_fact_pct, 2)} эмиссии` : ''}</span>}</span> : '—' },
    { header: 'Лимит', id: 'limit', meta: { align: 'right' }, accessorFn: (r) => r.fact?.limit_value ?? r.threshold_abs, cell: ({ row: { original: l } }) => <span>{l.fact ? (l.fact.limit_value == null ? '—' : fmtLimitValue(l.metric, l.fact.limit_value)) : threshold(l)}{l.metric === 'new_issuer_rating' && <span className={cellSub}>не ниже {l.min_grade}</span>}{l.threshold_pct != null && l.fact && <span className={cellSub}>{l.pct_base === 'total_limit' ? `${fmt.pct(l.threshold_pct, 1)} общего лимита` : pctGross(l.threshold_pct)}</span>}{l.emission_share_pct != null && <span className={cellSub}>{fmt.pct(l.emission_share_pct, 2)} эмиссии</span>}</span> },
    { header: 'Загрузка', id: 'util', accessorFn: (r) => r.fact?.utilization_pct ?? -1, cell: ({ row: { original: l } }) => l.fact ? <span className="flex items-center gap-2.5 min-w-[180px]"><span className="flex-1"><Meter pct={l.fact.utilization_pct} status={l.fact.status} /></span><span className="tabular-nums w-11 text-right">{fmt.pct(l.fact.utilization_pct, 0)}</span></span> : <span className="text-muted text-xs">{noFact}</span> },
    { header: 'Статус', id: 'status', accessorFn: (r) => STATUS_ORDER[r.fact?.status ?? 'n/a'], cell: ({ row: { original: l } }) => l.fact ? <StatusBadge status={l.fact.status} /> : null },
    { header: 'Действует', accessorKey: 'valid_from', cell: ({ row: { original: l } }) => <span className="text-text-2">{l.valid_to ? `${fmt.date(l.valid_from)} — ${fmt.date(l.valid_to)}` : `с ${fmt.date(l.valid_from)}`}</span> },
    ...(onEdit ? [{ header: '', id: 'actions', enableSorting: false, cell: ({ row }: { row: { original: LimitRow } }) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(row.original) }} data-testid="limit-edit">Изменить</Button> } as ColumnDef<LimitRow, unknown>] : []),
  ], [onEdit, noFact])
  return (
    <DataTable data={rows} columns={columns} getRowId={(r) => String(r.limit_id)} onRowClick={onEdit} emptyText="Лимитов нет" dense testId="limits-table"
      mobileCard={(l) => (
        <>
          <div className={mcardHead}><b>{labels.metric[l.metric]}</b>{l.fact ? <StatusBadge status={l.fact.status} /> : kind(l.is_hard)}</div>
          <div className={mcardSub}>{l.scope && <span>{issuerShort(l.scope, 36)}</span>}{kind(l.is_hard)}</div>
          {l.fact ? (
            <>
              <Meter pct={l.fact.utilization_pct} status={l.fact.status} />
              <div className="flex justify-between text-xs text-text-2 tabular-nums"><span>{fmtLimitValue(l.metric, l.fact.fact_value)} из {fmtLimitValue(l.metric, l.fact.limit_value)}</span><b className="font-semibold text-text">{fmt.pct(l.fact.utilization_pct, 0)}</b></div>
            </>
          ) : <div className="text-xs text-muted">порог {threshold(l)} · {noFact}</div>}
        </>
      )} />
  )
}

export function LimitDialog({ open, limit, onClose }: { open: boolean; limit: Limit | null; onClose: () => void }) {
  const { portfolioId } = useScope()
  const save = useSaveLimit()
  const del = useDeleteLimit()
  const toast = useToast()
  const [metric, setMetric] = useState<LimitMetric>('dv01')
  const [side, setSide] = useState<LimitSide>('both')
  const [abs, setAbs] = useState('')
  const [pct, setPct] = useState('')
  const [warn, setWarn] = useState('80')
  const [hard, setHard] = useState(true)
  const [from, setFrom] = useState('2024-01-01')
  const [to, setTo] = useState('')
  const [issuer, setIssuer] = useState<ComboItem | null>(null)
  const [bond, setBond] = useState<ComboItem | null>(null)
  const [sector, setSector] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [basis, setBasis] = useState<LimitBasis>('cost')
  const [pctBase, setPctBase] = useState<'gross' | 'total_limit'>('gross')
  const [share, setShare] = useState('')
  const [scopeName, setScopeName] = useState('')
  const [committee, setCommittee] = useState<'' | 'IC' | 'RC'>('')
  const [selfAdj, setSelfAdj] = useState('')
  const [minGrade, setMinGrade] = useState('BBB-')
  useEffect(() => {
    if (!open) return
    setMetric(limit?.metric ?? 'dv01'); setSide(limit?.side ?? 'both'); setAbs(limit?.threshold_abs != null ? String(limit.threshold_abs) : ''); setPct(limit?.threshold_pct != null ? String(limit.threshold_pct) : '')
    setWarn(String(limit?.warning_pct ?? 80)); setHard(limit?.is_hard ?? true); setFrom(limit?.valid_from ?? '2024-01-01'); setTo(limit?.valid_to ?? '')
    setIssuer(limit?.scope_issuer_id ? { id: limit.scope_issuer_id, label: limit.scope ?? String(limit.scope_issuer_id) } : null)
    setBond(limit?.scope_bond_id ? { id: limit.scope_bond_id, label: limit.scope ?? String(limit.scope_bond_id) } : null)
    setSector(limit?.scope_sector ?? ''); setConfirm(false); save.reset()
    setBasis(limit?.basis ?? 'cost'); setPctBase(limit?.pct_base ?? 'gross'); setShare(limit?.emission_share_pct != null ? String(limit.emission_share_pct) : '')
    setScopeName(limit?.scope_name ?? ''); setCommittee(limit?.committee ?? ''); setSelfAdj(limit?.self_adjust_pct != null ? String(limit.self_adjust_pct) : ''); setMinGrade(limit?.min_grade ?? 'BBB-')
  }, [open, limit]) // eslint-disable-line react-hooks/exhaustive-deps
  const scopeKind = metric === 'conc_issuer' ? 'issuer' : metric === 'conc_issue' ? 'bond' : metric === 'conc_sector' ? 'sector' : null
  const submit = () => {
    const body: LimitInput = {
      portfolio_id: portfolioId!, metric, side, threshold_abs: abs.trim() ? parseNum(abs) : null, threshold_pct: pct.trim() ? parseNum(pct) : null, warning_pct: parseNum(warn), is_hard: hard, valid_from: from, valid_to: to || null,
      scope_issuer_id: scopeKind === 'issuer' ? issuer?.id ?? null : null, scope_bond_id: scopeKind === 'bond' ? bond?.id ?? null : null, scope_sector: scopeKind === 'sector' ? sector || null : null,
      basis, pct_base: pctBase, emission_share_pct: metric === 'conc_issue' && share.trim() ? parseNum(share) : null,
      scope_name: scopeKind === 'issuer' && !issuer ? scopeName.trim() || null : null,
      committee: committee || null, self_adjust_pct: committee && selfAdj.trim() ? parseNum(selfAdj) : null,
      min_grade: metric === 'new_issuer_rating' ? minGrade : null,
    }
    if (metric === 'new_issuer_rating') { body.threshold_abs = null; body.threshold_pct = null }
    save.mutate({ id: limit?.limit_id, body }, { onSuccess: () => { toast(limit ? 'Лимит обновлён' : 'Лимит создан', 'success'); onClose() } })
  }
  const remove = () => limit && del.mutate(limit.limit_id, { onSuccess: () => { toast('Лимит удалён', 'success'); onClose() }, onError: (e) => toast(errorText(e), 'error') })
  const num = (s: string) => !s.trim() || parseNum(s) > 0
  const isConc = CONC.includes(metric)
  const valid = (metric === 'new_issuer_rating' || abs.trim() || pct.trim() || (metric === 'conc_issue' && share.trim())) && num(abs) && num(pct) && num(share) && parseNum(warn) > 0 && parseNum(warn) <= 100
    && (scopeKind !== 'issuer' || issuer || scopeName.trim()) && (scopeKind !== 'bond' || bond) && (scopeKind !== 'sector' || sector)
  // PATCH лимита меняет только пороги, тип, сторону и срок окончания: метрика, объект и начало — его идентичность
  const locked = !!limit
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }} title={limit ? 'Изменить лимит' : 'Новый лимит'}>
      <div className={grid2}>
        <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>Метрика</span>{locked ? <span className={cn(input(), 'inline-flex items-center bg-wash text-text-2 cursor-not-allowed')} data-testid="limit-metric">{labels.metric[metric]}{limit?.scope ? ` — ${issuerShort(limit.scope, 40)}` : ''}</span> : <Select value={metric} onChange={(v) => setMetric(v as LimitMetric)} options={METRICS.map((m) => ({ value: m, label: labels.metric[m] }))} ariaLabel="Метрика" testId="limit-metric" className="w-full" />}</label>
        {!locked && scopeKind === 'issuer' && !issuer && <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>или название из книги лимитов</span><input className={input()} value={scopeName} onChange={(e) => setScopeName(e.target.value)} placeholder="без учёта регистра и ОПФ, с синонимами книги" /></label>}
        {!locked && scopeKind === 'issuer' && <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>Эмитент</span><Combobox value={issuer} onChange={setIssuer} placeholder="название эмитента" search={(q) => api.get<Page<Issuer>>('/issuers', { q: q || undefined, limit: 12 }).then((p) => p.items.map((i) => ({ id: i.issuer_id, label: i.short_name ?? i.name, sub: i.sector })))} /></label>}
        {!locked && scopeKind === 'bond' && <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>Выпуск</span><Combobox value={bond} onChange={setBond} placeholder="название или ISIN" search={(q) => api.get<Page<Bond>>('/bonds', { q: q || undefined, status: 'trading', limit: 12 }).then((p) => p.items.map((b) => ({ id: b.bond_id, label: b.short_name, sub: b.isin })))} /></label>}
        {!locked && scopeKind === 'sector' && <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>Отрасль</span><input className={input()} value={sector} onChange={(e) => setSector(e.target.value)} placeholder="как в справочнике эмитентов" /></label>}
        <div className={field}><span>Тип</span><Segmented value={hard ? 'hard' : 'soft'} onChange={(v) => setHard(v === 'hard')} options={[{ value: 'hard', label: 'жёсткий' }, { value: 'soft', label: 'мягкий' }]} ariaLabel="Тип лимита" testId="limit-hard" className="w-full [&>*]:flex-1" /></div>
        <div className={field}><span>Сторона</span><Segmented value={side} onChange={setSide} options={[{ value: 'both', label: 'обе' }, { value: 'long', label: 'длинная' }, { value: 'short', label: 'короткая' }]} ariaLabel="Сторона" className="w-full [&>*]:flex-1" /></div>
        {metric === 'new_issuer_rating'
          ? <label className={cn(field, 'col-span-2 max-sm:col-span-1')}><span>Минимальный рейтинг эмитентов, которых нет в портфеле</span><Select value={minGrade} onChange={setMinGrade} options={GRADES.map((g) => ({ value: g, label: g }))} ariaLabel="Минимальный рейтинг" className="w-full" /></label>
          : <>
            <label className={field}><span>Порог, {metric === 'duration' ? 'лет' : metric === 'credit_spread' ? 'б.п.' : '₽'}</span><input className={input({ num: true })} inputMode="decimal" value={abs} onChange={(e) => setAbs(e.target.value)} data-testid="limit-abs" /></label>
            <label className={field}><span>или % {pctBase === 'total_limit' ? 'общего лимита' : 'брутто-стоимости'}</span><input className={input({ num: true })} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
          </>}
        {isConc && <div className={field}><span>База оценки позиции</span><Segmented value={basis} onChange={setBasis} options={[{ value: 'cost', label: 'цена покупки' }, { value: 'market', label: 'рынок' }, { value: 'max', label: 'большая' }]} ariaLabel="База оценки" className="w-full [&>*]:flex-1" /></div>}
        {isConc && <div className={field}><span>База процента</span><Segmented value={pctBase} onChange={setPctBase} options={[{ value: 'gross', label: 'брутто' }, { value: 'total_limit', label: 'общий лимит' }]} ariaLabel="База процента" className="w-full [&>*]:flex-1" /></div>}
        {metric === 'conc_issue' && <label className={field}><span>Доля в объёме эмиссии, %</span><input className={input({ num: true })} inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} /></label>}
        {!locked && <div className={field}><span>Регламент</span><Segmented value={committee} onChange={setCommittee} options={[{ value: '', label: 'дашборд' }, { value: 'IC', label: 'ИК' }, { value: 'RC', label: 'КРМ' }]} ariaLabel="Комитет" className="w-full [&>*]:flex-1" /></div>}
        {!locked && committee && <label className={field}><span>Самостоятельная корректировка до, %</span><input className={input({ num: true })} inputMode="decimal" value={selfAdj} onChange={(e) => setSelfAdj(e.target.value)} placeholder="сверх — совет директоров" /></label>}
        <label className={field}><span>Предупреждать с загрузки, %</span><input className={input({ num: true })} inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
        <span className="max-sm:hidden" />
        <label className={field}><span>Действует с</span><input type="date" className={input()} value={from} disabled={locked} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={field}><span>по (пусто — бессрочно)</span><input type="date" className={input()} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {locked && <p className="text-muted text-xs mt-2">Метрику, объект и дату начала у действующего лимита не меняют — для другого правила создайте новый лимит.</p>}
      <p className="text-muted text-xs mt-2">Жёсткий лимит блокирует сделку до исполнения, мягкий даёт предупреждение в расчёте EOD. Если заданы оба порога, применяется более строгий; у концентрации утилизация — наибольшая из ₽, % и доли эмиссии. Короткая позиция по любой бумаге, кроме ОФЗ, — нарушение лимита шорта независимо от размера.</p>
      {save.error && <div className="mt-2"><ErrorBanner error={save.error} /></div>}
      {confirm && limit && (
        <div className="mt-3 rounded-ctl bg-critical-bg px-3 py-2.5 text-[13px] flex items-center gap-3 flex-wrap" role="alert">
          <span className="flex-1 min-w-[200px]">Удалить лимит? История нарушений по нему удалится вместе с ним.</span>
          <Button size="sm" onClick={() => setConfirm(false)}>Отмена</Button>
          <Button size="sm" variant="danger" disabled={del.isPending} onClick={remove} data-testid="limit-delete-confirm">Удалить</Button>
        </div>
      )}
      <div className={dialogActions}>
        {limit && !confirm && <Button variant="ghost" className="mr-auto text-bad-text max-md:mr-0" onClick={() => setConfirm(true)} data-testid="limit-delete">Удалить лимит</Button>}
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" disabled={!valid || save.isPending} onClick={submit} data-testid="limit-save">Сохранить</Button>
      </div>
    </Dialog>
  )
}
