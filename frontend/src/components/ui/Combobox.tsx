import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cellSub, cn, input } from '../../lib/ui'

export interface ComboItem { id: number; label: string; sub?: string }
/**
 * Поле с поиском по серверу. Запросы идут через `search(q)`; устаревшие ответы (пришедшие позже
 * более нового запроса) игнорируются, поэтому список не «прыгает».
 */
export function Combobox({ value, onChange, search, placeholder, renderRight, testId, width }: {
  value: ComboItem | null; onChange: (v: ComboItem | null) => void; search: (q: string) => Promise<ComboItem[]>
  placeholder?: string; renderRight?: (i: ComboItem) => ReactNode; testId?: string; width?: number | string
}) {
  const [q, setQ] = useState(value?.label ?? '')
  const [items, setItems] = useState<ComboItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  // текст следует за значением; сброс значения снаружи очищает поле, но не набранный пользователем текст
  const shown = useRef(value?.label ?? '')
  useEffect(() => {
    if (value) { shown.current = value.label; setQ(value.label) }
    else setQ((cur) => (cur === shown.current ? '' : cur))
  }, [value])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const run = (text: string) => {
    const my = ++seq.current
    setLoading(true)
    search(text).then((res) => { if (my === seq.current) { setItems(res); setActive(0) } }).catch(() => undefined).finally(() => { if (my === seq.current) setLoading(false) })
  }
  const pick = (i: ComboItem) => { onChange(i); setQ(i.label); setOpen(false) }
  return (
    <div className="relative" ref={ref} style={{ width }}>
      <input className={cn(input(), 'w-full')} placeholder={placeholder} value={q} role="combobox" aria-expanded={open} aria-autocomplete="list" data-testid={testId}
        // любая правка текста снимает прежний выбор: иначе в поле «xyz», а выбрана бумага A
        onChange={(e) => { setQ(e.target.value); run(e.target.value); setOpen(true); if (value) onChange(null) }}
        onFocus={() => { setOpen(true); if (items.length === 0) run(q) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]) }
          if (e.key === 'Escape') setOpen(false)
        }} />
      {open && (items.length > 0 || loading) && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface rounded-card shadow-pop z-[60] max-h-[260px] overflow-auto p-1" role="listbox">
          {loading && items.length === 0 && <div className="combobox-item px-2.5 py-1.5 text-muted">поиск…</div>}
          {items.map((i, idx) => (
            <div key={i.id} role="option" aria-selected={idx === active} className={cn('combobox-item px-2.5 py-1.5 rounded-[4px] cursor-pointer flex justify-between gap-2 hover:bg-wash-2 max-md:min-h-11 max-md:items-center', idx === active && 'bg-wash-2')} onMouseDown={(e) => { e.preventDefault(); pick(i) }}>
              <span>{i.label}{i.sub && <span className={cellSub}>{i.sub}</span>}</span>
              {renderRight?.(i)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
