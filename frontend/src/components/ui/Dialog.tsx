import * as D from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { button, cn, dialog, dialogScroll, dialogWide, overlay, sheet } from '../../lib/ui'

export function Dialog({ open, onOpenChange, title, children, wide, sheet: isSheet }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode; wide?: boolean; sheet?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={isSheet ? sheet : cn(dialog, wide && dialogWide)} aria-describedby={undefined}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-none">
            <D.Title asChild><h2 className="m-0">{title}</h2></D.Title>
            <D.Close asChild><button className={button({ variant: 'ghost', size: 'sm', icon: true })} aria-label="Закрыть">✕</button></D.Close>
          </div>
          <div className={dialogScroll}>{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
