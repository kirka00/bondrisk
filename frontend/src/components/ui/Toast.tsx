import * as T from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '../../lib/ui'

interface Item { id: number; text: string; kind: 'success' | 'error' | 'info' }
const Ctx = createContext<(text: string, kind?: Item['kind']) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const push = useCallback((text: string, kind: Item['kind'] = 'info') => setItems((s) => [...s, { id: Date.now() + Math.random(), text, kind }]), [])
  return (
    <Ctx.Provider value={push}>
      <T.Provider duration={4000}>
        {children}
        {items.map((i) => (
          <T.Root key={i.id} className={cn('toast', i.kind, 'bg-text text-surface rounded-lg px-3 py-2.5 text-[13px] transition-[transform,opacity] duration-200 ease-out data-[state=closed]:opacity-0 data-[state=closed]:translate-y-2', i.kind === 'error' && 'bg-critical text-white', i.kind === 'success' && 'bg-good-text text-white')} onOpenChange={(o) => { if (!o) setItems((s) => s.filter((x) => x.id !== i.id)) }}>
            <T.Description>{i.text}</T.Description>
          </T.Root>
        ))}
        <T.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 z-[80] w-[360px] max-w-[calc(100vw-32px)] m-0 p-0 list-none max-md:bottom-[calc(64px+env(safe-area-inset-bottom))]" />
      </T.Provider>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx)
