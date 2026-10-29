import type { ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { labels } from '../../lib/format'
import { banner, button, cn, empty } from '../../lib/ui'

export function EmptyState({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return <div className={empty}><b>{title}</b>{hint}{action && <div className="mt-2.5">{action}</div>}</div>
}
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const human = e.code ? labels.errorCode[e.code] : undefined
    return human ? `${human} (${e.code}): ${e.message}` : e.message
  }
  return e instanceof Error ? e.message : String(e)
}
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  return <div className={cn('banner error', banner({ kind: 'error' }))} role="alert">{errorText(error)}</div>
}
/** Изменение со стрелкой. neutral — без оценки «хорошо/плохо» (рост DV01 или дюрации — не ошибка, а решение). */
export function Delta({ value, goodWhenUp = true, neutral, digits = 2, suffix = '', hint, flatText = 'без изменений' }: { value: number | null | undefined; goodWhenUp?: boolean; neutral?: boolean; digits?: number; suffix?: string; hint?: string; flatText?: string | null }) {
  if (value == null || !Number.isFinite(value)) return null
  const eps = digits === 0 ? 0.5 : Math.pow(10, -digits) / 2
  if (Math.abs(value) < eps) return flatText ? <span className="delta text-xs text-muted">{flatText}{hint ? <span className="text-muted"> {hint}</span> : null}</span> : null
  const up = value > 0
  const good = up === goodWhenUp
  const s = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))
  return <span className={cn('delta text-xs font-medium', neutral ? 'text-text-2' : good ? 'text-good-text' : 'text-bad-text')}>{up ? '▲' : '▼'} {s}{suffix}{hint ? <span className="text-muted"> {hint}</span> : null}</span>
}
export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="flex items-center gap-2 py-2 text-muted text-[12.5px]">
      <button className={cn(button({ size: 'sm' }), 'max-md:min-w-11')} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>←</button>
      <span>стр. {page} из {pages} · всего {total}</span>
      <button className={cn(button({ size: 'sm' }), 'max-md:min-w-11')} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>→</button>
    </div>
  )
}
