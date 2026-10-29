import * as S from '@radix-ui/react-select'
import type { ReactNode } from 'react'
import { chip, cn, input } from '../../lib/ui'

export interface Opt { value: string; label: string; sub?: string; badge?: string; disabled?: boolean }
export function Select({ value, onChange, options, placeholder, width, ariaLabel, renderValue, size = 'md', className, testId }: {
  value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string; width?: number | string; ariaLabel?: string
  renderValue?: (o: Opt | undefined) => ReactNode; size?: 'md' | 'sm'; className?: string; testId?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <S.Root value={value} onValueChange={onChange}>
      <S.Trigger className={cn(input({ size }), 'select-trigger inline-flex items-center justify-between gap-2 cursor-pointer max-w-full', className)} style={{ width }} aria-label={ariaLabel} data-testid={testId}>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left [&>span]:block [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"><S.Value placeholder={placeholder}>{renderValue ? renderValue(current) : current?.label}</S.Value></span>
        <S.Icon><span className="text-muted text-[11px] flex-none">▾</span></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="bg-surface rounded-card shadow-pop p-1 z-[60] max-h-[320px] overflow-auto" position="popper" sideOffset={4} style={{ minWidth: 'var(--radix-select-trigger-width)' }}>
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className="px-2.5 py-1.5 rounded-[4px] cursor-pointer outline-none flex items-center gap-2 data-[highlighted]:bg-wash-2 data-[state=checked]:font-semibold data-[disabled]:opacity-50 max-md:min-h-11" disabled={o.disabled}>
                <S.ItemText>{o.label}</S.ItemText>
                {o.badge && <span className={chip}>{o.badge}</span>}
                {o.sub && <span className="text-muted text-[11.5px] ml-auto">{o.sub}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
