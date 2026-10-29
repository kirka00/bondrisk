import { useFreshness } from '../../api/hooks'
import type { Freshness } from '../../api/types'
import { fmt } from '../../lib/format'
import { cn } from '../../lib/ui'
import { Popover } from '../ui/Popover'

const DOT: Record<Freshness['status'], string> = {
  fresh: 'bg-good',
  late: 'bg-warning',
  stale: 'bg-critical',
  unknown: 'bg-muted',
}
const STATUS: Record<Freshness['status'], string> = {
  fresh: 'актуальны',
  late: 'отстают на 1–2 торговых дня',
  stale: 'устарели',
  unknown: 'нет данных',
}

function lag(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (n === 0) return 'актуально'
  return `отставание ${n} ${n === 1 ? 'торговый день' : n < 5 ? 'торговых дня' : 'торговых дней'}`
}

/** «данные на 27.10.2026 · обновлено 28.10, 21:04»; во всплывающей подсказке — каждый источник отдельно. */
export function FreshnessBadge() {
  const { data: f } = useFreshness()
  if (!f) return null
  const trigger = (
    <button type="button" className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 cursor-pointer text-muted text-xs whitespace-nowrap hover:text-text" data-testid="data-end" aria-label={`Данные ${STATUS[f.status]}`}>
      <span className={cn('w-2 h-2 rounded-full flex-none', DOT[f.status])} aria-hidden />
      <span>данные на {fmt.date(f.data_as_of)}</span>
      {f.updated_at && <span className="max-lg:hidden">· обновлено {fmt.dateTime(f.updated_at)}</span>}
    </button>
  )
  return (
    <Popover trigger={trigger} hover align="end" testId="freshness" className="w-[340px]">
      <div className="text-sm font-medium mb-1">Данные {STATUS[f.status]}</div>
      <p className="text-muted text-xs mb-2">
        Обновляются автоматически: ежедневно в 21:00 и 07:30 МСК, справочник — по воскресеньям.
        Котировки закрытия MOEX публикует вечером, поэтому днём последний торговый день — вчерашний.
      </p>
      <table className="w-full text-xs">
        <tbody>
          {f.sources.map((s) => (
            <tr key={s.key} className="align-top">
              <td className="py-0.5 pr-2">{s.name}</td>
              <td className="py-0.5 text-right whitespace-nowrap">
                {s.as_of !== undefined ? <>по {fmt.date(s.as_of)}<div className="text-muted">{lag(s.lag_days)}</div></> : <>загружено {fmt.dateTime(s.loaded_at)}</>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-muted text-xs mt-2">
        Последнее обновление: {fmt.dateTime(f.updated_at)}
        {!!f.last_update_errors && <> · ошибок источников: {f.last_update_errors}</>}
      </div>
    </Popover>
  )
}
