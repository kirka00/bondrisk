import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SECTIONS, isActive } from '../../app/nav'
import { cn } from '../../lib/ui'

/** Вкладки раздела из нескольких страниц (Портфель: Позиции · Сделки); справа — фильтры текущей вкладки. */
export function SectionTabs({ children }: { children?: ReactNode }) {
  const loc = useLocation()
  const section = SECTIONS.find((s) => s.tabs && isActive(s, loc.pathname))
  if (!section?.tabs) return null
  return (
    <div className="flex items-end justify-between gap-3 border-b border-border max-md:flex-col max-md:items-stretch max-md:border-b-0 max-md:gap-2.5">
      <nav className="flex gap-1 max-md:gap-1.5" aria-label={section.name} data-testid="section-tabs">
        {section.tabs.map((t) => {
          const on = loc.pathname === t.to
          return (
            <Link key={t.to} to={{ pathname: t.to, search: loc.search }} aria-current={on ? 'page' : undefined}
              className={cn('px-3 py-2 -mb-px border-b-2 border-transparent text-text-2 font-medium hover:no-underline hover:text-text', on && 'text-text border-b-accent',
                'max-md:border max-md:border-border-strong max-md:rounded-full max-md:px-4 max-md:mb-0 max-md:min-h-10 max-md:inline-flex max-md:items-center', on && 'max-md:bg-wash-2 max-md:border-transparent')}>
              {t.name}
            </Link>
          )
        })}
      </nav>
      {children && <div className="flex items-center gap-2 pb-2 flex-wrap max-md:pb-0">{children}</div>}
    </div>
  )
}
