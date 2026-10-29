import { labels } from '../../lib/format'
import { badge } from '../../lib/ui'

const icon: Record<string, string> = { ok: '✓', warning: '!', breach: '✕', waived: '–', 'n/a': '·' }
type St = 'ok' | 'warning' | 'breach' | 'waived' | 'na'
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const st: St = status === 'n/a' ? 'na' : (['ok', 'warning', 'breach', 'waived'] as const).find((s) => s === status) ?? 'na'
  return <span className={badge({ status: st })}><span aria-hidden>{icon[status] ?? '·'}</span>{label ?? labels.status[status] ?? status}</span>
}
