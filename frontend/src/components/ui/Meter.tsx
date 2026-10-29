import { fmt } from '../../lib/format'
import { meterFill, meterTrack } from '../../lib/ui'

export function Meter({ pct, status }: { pct: number | null; status: string }) {
  const w = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  const st = (['ok', 'warning', 'breach', 'waived'] as const).find((s) => s === status) ?? 'ok'
  return (
    <div className={meterTrack} role="meter" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Утилизация ${fmt.pct(pct, 0)}`}>
      <div className={meterFill({ status: st })} style={{ width: `${w}%` }} />
    </div>
  )
}
