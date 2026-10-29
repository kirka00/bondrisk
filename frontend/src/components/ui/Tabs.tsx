import * as T from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

export function Tabs({ value, onChange, items, children }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; children: ReactNode }) {
  return (
    <T.Root value={value} onValueChange={onChange}>
      <T.List className="flex gap-0.5 border-b border-border mb-3.5 overflow-x-auto no-scrollbar max-md:gap-1.5 max-md:border-b-0 max-md:pb-1">
        {items.map((i) => (
          <T.Trigger key={i.value} value={i.value} className="border-0 bg-transparent px-3 py-2 text-text-2 cursor-pointer font-medium border-b-2 border-transparent -mb-px whitespace-nowrap data-[state=active]:text-text data-[state=active]:border-b-accent max-md:border max-md:border-border-strong max-md:rounded-full max-md:px-3.5 max-md:py-2 max-md:m-0 max-md:min-h-10 max-md:data-[state=active]:bg-wash-2 max-md:data-[state=active]:border-transparent">{i.label}</T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  )
}
export const TabPanel = T.Content
