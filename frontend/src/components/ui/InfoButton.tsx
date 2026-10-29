import type { FormulaKey } from '../../lib/formulas'
import { infoBtn } from '../../lib/ui'
import { FormulaBlock } from './Formula'
import { Popover } from './Popover'

export function InfoButton({ k, values, hint, label = 'Как считается' }: { k: FormulaKey; values?: Record<string, number | string | null | undefined>; hint?: string; label?: string }) {
  return (
    <Popover hover testId="info-popover" trigger={<button className={infoBtn} aria-label={label} title={label} data-testid="info-btn" onClick={(e) => e.stopPropagation()}>i</button>}>
      {hint && <p className="text-text-2 text-xs mb-2">{hint}</p>}
      <FormulaBlock k={k} values={values} />
    </Popover>
  )
}
