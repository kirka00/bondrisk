import * as TG from '@radix-ui/react-toggle-group'
import { cn, seg, segItem } from '../../lib/ui'

export function Segmented<T extends string>({ value, onChange, options, ariaLabel, testId, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel?: string; testId?: string; className?: string }) {
  return (
    <TG.Root type="single" value={value} onValueChange={(v) => { if (v) onChange(v as T) }} className={cn(seg, className)} aria-label={ariaLabel} data-testid={testId}>
      {options.map((o) => <TG.Item key={o.value} value={o.value} className={segItem}>{o.label}</TG.Item>)}
    </TG.Root>
  )
}
