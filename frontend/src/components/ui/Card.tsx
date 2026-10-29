import type { ReactNode } from 'react'
import { card, cardTight, cn } from '../../lib/ui'

export function Card({ title, hint, actions, children, className = '', tight }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; tight?: boolean }) {
  return (
    <section className={cn(tight ? cardTight : card, className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-2.5 max-md:flex-wrap">
          <div>
            {title && <h2 className="text-sm">{title}</h2>}
            {hint && <div className="text-muted text-xs">{hint}</div>}
          </div>
          {actions && <div className="flex items-center gap-2 max-md:flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Секция страницы без рамки: заголовок с действиями, ниже — таблица или карточки со своей рамкой. */
export function Section({ title, hint, actions, children, className = '', id }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5 min-w-0 scroll-mt-16', className)} id={id}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2>{title}</h2>
          {hint && <div className="text-muted text-xs mt-0.5">{hint}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
