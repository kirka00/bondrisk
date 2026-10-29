import { useIsFetching } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { portfolioFree, scopeFree } from '../../app/nav'
import { useScope } from '../../app/scope'
import { button, cn, input } from '../../lib/ui'
import { Select } from '../ui/Select'
import { FreshnessBadge } from './Freshness'

const lbl = 'text-xs text-muted mr-0.5 max-md:hidden'

export function FilterBar() {
  const { portfolios, portfolio, setPortfolio, asOf, asOfExplicit, dataEnd, setAsOf } = useScope()
  const fetching = useIsFetching()
  const { pathname } = useLocation()
  if (scopeFree(pathname)) return null
  const showPortfolio = !portfolioFree(pathname)
  const opts = portfolios.map((p) => ({ value: p.code, label: `${p.code} · ${p.name}`, badge: p.allow_short ? 'шорт' : undefined }))
  return (
    <div className="relative border-b border-border bg-surface max-md:sticky max-md:top-[52px] max-md:z-[19]">
      <div className="filterbar-inner max-w-[1440px] mx-auto px-6 py-2 flex items-center gap-2 whitespace-nowrap max-md:flex-wrap max-md:px-4">
        {showPortfolio && <><div className="flex items-center gap-2 max-md:w-full">
          <label className={lbl}>Портфель</label>
          <Select ariaLabel="Портфель" width={270} className="max-md:w-full!" value={portfolio?.code ?? ''} onChange={setPortfolio} options={opts} placeholder="выберите портфель"
            renderValue={(o) => o ? <><b>{o.value}</b><span className="text-muted"> · </span>{o.label.split(' · ').slice(1).join(' · ')}</> : null} />
        </div>
        <span className="w-3 max-md:hidden" /></>}
        <div className="flex items-center gap-2 max-md:w-full">
          <label className={lbl} htmlFor="as-of">Дата оценки</label>
          <input id="as-of" type="date" className={cn(input(), 'max-md:flex-1')} value={asOf ?? ''} max={dataEnd} onChange={(e) => setAsOf(e.target.value || undefined)} data-testid="as-of" />
          <button className={cn(button({ variant: 'ghost', size: 'sm' }), 'max-md:w-11 max-md:px-0')} disabled={!asOfExplicit} onClick={() => setAsOf(undefined)} title="Сбросить дату к последним данным" aria-label="К последним данным">
            <span className="max-md:hidden">к последним данным</span>
            <svg className="hidden max-md:inline" viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" /></svg>
          </button>
          <FreshnessBadge />
        </div>
        <div className="flex-1" />
        {fetching > 0 && <span className="text-muted text-xs max-md:hidden" aria-live="polite">обновление…</span>}
      </div>
      <div className={cn('absolute left-0 right-0 -bottom-px h-0.5 overflow-hidden', fetching > 0 && 'progress-on')} aria-hidden />
    </div>
  )
}
