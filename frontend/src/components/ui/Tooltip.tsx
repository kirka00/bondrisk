import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { tooltip } from '../../lib/ui'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={300} skipDelayDuration={400}>{children}</T.Provider>
}
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={tooltip} side={side} sideOffset={4} collisionPadding={8}>{content}</T.Content>
      </T.Portal>
    </T.Root>
  )
}
