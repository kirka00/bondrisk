import { Link, useLocation } from 'react-router-dom'
import { SECTIONS, isActive } from '../../app/nav'
import { cn } from '../../lib/ui'

const Icon: Record<string, React.ReactNode> = {
  '/': <svg viewBox="0 0 24 24" aria-hidden><path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6Zm10-12h8V3h-8v6Z" /></svg>,
  '/positions': <svg viewBox="0 0 24 24" aria-hidden><path d="M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Z" /></svg>,
  '/risk': <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 5h2v6h-2V7Zm0 8h2v2h-2v-2Z" /></svg>,
  '/reports': <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z" /></svg>,
  '/bonds': <svg viewBox="0 0 24 24" aria-hidden><path d="M4 4h16v16H4V4Zm2 2v12h12V6H6Zm2 2h8v2H8V8Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z" /></svg>,
}
const item = 'flex flex-col items-center justify-center gap-0.5 h-14 min-w-11 text-muted text-[11px] font-medium no-underline active:scale-[0.96] hover:no-underline [&>svg]:w-[22px] [&>svg]:h-[22px] [&>svg]:fill-current'

export function BottomNav() {
  const loc = useLocation()
  return (
    <nav className="hidden max-md:grid fixed left-0 right-0 bottom-0 z-30 grid-cols-5 bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] backdrop-blur-[10px] border-t border-border pb-[env(safe-area-inset-bottom)]" aria-label="Разделы" data-testid="bottom-nav">
      {SECTIONS.map((s) => {
        const on = isActive(s, loc.pathname)
        return <Link key={s.to} to={{ pathname: s.to, search: loc.search }} aria-current={on ? 'page' : undefined} className={cn(item, on && 'text-accent')}>{Icon[s.to]}<span>{s.name}</span></Link>
      })}
    </nav>
  )
}
