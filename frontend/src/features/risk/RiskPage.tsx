import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLimitFacts, useLimits } from '../../api/hooks'
import type { Limit } from '../../api/types'
import { useScope } from '../../app/scope'
import { Button } from '../../components/ui/Button'
import { Section } from '../../components/ui/Card'
import { InfoButton } from '../../components/ui/InfoButton'
import { EmptyState, ErrorBanner } from '../../components/ui/Misc'
import { countOf, fmt } from '../../lib/format'
import { cn, pageHead, pageSub } from '../../lib/ui'
import { BreachesSection } from './BreachesSection'
import { CorrectionsSection } from './CorrectionsSection'
import { LimitDialog, LimitsTable, joinLimits } from './LimitsSection'

/** Раздел «Лимиты»: лимиты с фактом и загрузкой на дату оценки + журнал нарушений по расчётам EOD. */
export function RiskPage() {
  const { portfolio, portfolioId, asOf, holdings, isRiskManager } = useScope()
  const { hash } = useLocation()
  const limits = useLimits(portfolioId)
  const facts = useLimitFacts(portfolioId, asOf, holdings)
  const [edit, setEdit] = useState<Limit | null | 'new'>(null)
  const rows = useMemo(() => joinLimits(limits.data ?? [], facts.data ?? []), [limits.data, facts.data])
  useEffect(() => { if (hash === '#breaches' && limits.isSuccess) document.getElementById('breaches')?.scrollIntoView() }, [hash, limits.isSuccess])

  if (!portfolio) return <EmptyState title="Нет портфелей" />
  const n = { breach: 0, warning: 0 }
  for (const r of rows) if (r.fact?.status === 'breach' || r.fact?.status === 'warning') n[r.fact.status]++
  const summary = [
    countOf(rows.length, ['лимит', 'лимита', 'лимитов']),
    n.breach ? countOf(n.breach, ['нарушение', 'нарушения', 'нарушений']) : 'нарушений нет',
    n.warning ? countOf(n.warning, ['предупреждение', 'предупреждения', 'предупреждений']) : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-6 max-md:gap-5">
      <div className={cn(pageHead, 'mb-0')}>
        <div><h1>Лимиты — {portfolio.code}</h1><div className={pageSub}>{limits.data ? summary : '…'} · на {fmt.date(asOf)}</div></div>
        <div className="row flex items-center gap-2">
          {isRiskManager ? <Button variant="primary" onClick={() => setEdit('new')} data-testid="new-limit">Новый лимит</Button> : <span className="text-muted text-xs">лимиты задаёт риск-менеджер</span>}
        </div>
      </div>
      <ErrorBanner error={limits.error ?? facts.error} />
      <Section title="Действующие лимиты" hint="загрузка = факт / лимит; предупреждение — выше порога лимита (обычно 80 %), нарушение — выше 100 %" actions={<InfoButton k="utilization" />}>
        {!limits.isPending && rows.length === 0
          ? <EmptyState title="Лимитов нет" hint="Без лимитов сделки не блокируются, а EOD не фиксирует нарушения" action={isRiskManager ? <Button size="sm" onClick={() => setEdit('new')}>Задать первый лимит</Button> : undefined} />
          : <LimitsTable rows={rows} onEdit={isRiskManager ? setEdit : undefined} factsLoading={facts.isFetching} />}
      </Section>
      <BreachesSection />
      <CorrectionsSection />
      <LimitDialog open={edit !== null} limit={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
    </div>
  )
}
