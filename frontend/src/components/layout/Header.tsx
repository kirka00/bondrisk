import * as D from '@radix-ui/react-dialog'
import * as P from '@radix-ui/react-popover'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useIsMobile } from '../../app/media'
import { SECTIONS, isActive } from '../../app/nav'
import { useScope } from '../../app/scope'
import { useTheme } from '../../app/theme'
import type { User } from '../../api/types'
import { labels } from '../../lib/format'
import { button, cap, cn, dialog, overlay, popover } from '../../lib/ui'

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}
function shortName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
}
const avatar = 'w-[26px] h-[26px] rounded-full bg-s1-soft text-accent text-[11px] font-bold inline-flex items-center justify-center flex-none'
const userName = 'user-name flex flex-col items-start min-w-0 leading-[1.15] [&>.n]:font-medium [&>.n]:text-[13px] [&>.n]:whitespace-nowrap [&>.n]:overflow-hidden [&>.n]:text-ellipsis [&>.n]:max-w-[180px] [&>.r]:text-[11px] [&>.r]:text-muted [&>.r]:whitespace-nowrap'

// Basic auth нельзя «разлогинить» из страницы. Запрос с учёткой-заглушкой, которую Caddy принимает только
// на /logout, подменяет запомненную браузером учётку; следующий запрос к сайту с ней не проходит,
// и браузер снова спрашивает логин и пароль. Chrome и Firefox так делают, Safari — не всегда.
function switchUser() {
  const x = new XMLHttpRequest()
  x.open('GET', '/logout', true, 'logout', 'logout')
  x.onloadend = () => { window.location.href = '/' }
  x.send()
}

function UserList({ users, user, fixed, onPick }: { users: User[]; user: User | null; fixed: boolean; onPick: (id: number) => void }) {
  if (fixed) return (
    <>
      <div className={cn(cap, 'mb-1.5')}>Вы вошли как</div>
      {user && <div className="flex items-center gap-2 px-2 py-1.5"><span className={avatar} aria-hidden>{initials(user.full_name)}</span><span className={userName}><span className="n">{shortName(user.full_name)}</span><span className="r">{labels.role[user.role] ?? user.role}</span></span></div>}
      <button className={cn(button(), 'w-full mt-2')} onClick={switchUser} data-testid="switch-user">Сменить пользователя</button>
      <p className="text-muted text-xs mt-2">Браузер снова спросит логин и пароль. Если не спросил (бывает в Safari), закройте браузер или откройте сайт в приватном окне.</p>
    </>
  )
  return (
    <>
      <div className={cn(cap, 'mb-1.5')}>Работать как</div>
      {users.map((u) => (
        <button key={u.user_id} className={cn('flex items-center gap-2 w-full border-0 bg-transparent px-2 py-1.5 rounded-md cursor-pointer text-left hover:bg-wash-2 max-md:min-h-12', u.user_id === user?.user_id && 'bg-wash')} onClick={() => onPick(u.user_id)} data-testid={`user-${u.login}`}>
          <span className={avatar} aria-hidden>{initials(u.full_name)}</span>
          <span className={userName}><span className="n">{shortName(u.full_name)}</span><span className="r">{labels.role[u.role] ?? u.role}</span></span>
          {u.user_id === user?.user_id && <span className="text-muted">✓</span>}
        </button>
      ))}
      <p className="text-muted text-xs mt-2">Роль определяет права: сделки — трейдер, снятие нарушений — риск-менеджер.</p>
    </>
  )
}

export function Header() {
  const { users, user, userFixed, setUser } = useScope()
  const [theme, toggle] = useTheme()
  const [open, setOpen] = useState(false)
  const mobile = useIsMobile()
  const loc = useLocation()
  const pick = (id: number) => { setUser(id); setOpen(false) }
  const triggerBtn: ReactNode = (
    <button className="user-btn inline-flex items-center gap-2 h-9 pl-1 pr-2 rounded-ctl border border-transparent bg-transparent cursor-pointer max-w-[260px] transition-colors duration-150 hover:bg-wash data-[state=open]:bg-wash-2 max-md:px-1 max-md:min-h-11" aria-label="Пользователь" data-testid="user-menu">
      <span className={avatar} aria-hidden>{user ? initials(user.full_name) : '?'}</span>
      <span className={cn(userName, 'max-md:hidden')}>
        <span className="n">{user ? shortName(user.full_name) : '…'}</span>
        <span className="r">{user ? labels.role[user.role] ?? user.role : ''}</span>
      </span>
      <span className="text-muted text-[11px] flex-none" aria-hidden>▾</span>
    </button>
  )
  return (
    <header className="sticky top-0 z-20 bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] backdrop-blur-[8px] border-b border-border">
      <div className="max-w-[1440px] mx-auto px-6 h-[52px] flex items-center gap-5 max-md:gap-3 max-md:px-4">
        <NavLink to={{ pathname: '/', search: loc.search }} className="brand font-bold text-base tracking-[-0.02em] text-text hover:no-underline">bondrisk</NavLink>
        <nav className="flex gap-0.5 max-md:hidden" aria-label="Разделы">
          {SECTIONS.map((s) => <Link key={s.to} to={{ pathname: s.to, search: loc.search }} aria-current={isActive(s, loc.pathname) ? 'page' : undefined} className={cn('px-3 py-1.5 rounded-ctl text-text-2 font-medium hover:bg-wash hover:no-underline hover:text-text', isActive(s, loc.pathname) && 'bg-wash-2 text-text')}>{s.name}</Link>)}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button className={button({ icon: true })} onClick={toggle} aria-label="Переключить тему" data-testid="theme-toggle" title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>{theme === 'dark' ? '☀' : '☾'}</button>
          {mobile ? (
            <D.Root open={open} onOpenChange={setOpen}>
              <D.Trigger asChild>{triggerBtn}</D.Trigger>
              <D.Portal>
                <D.Overlay className={overlay} />
                <D.Content className={dialog} aria-describedby={undefined}>
                  <D.Title asChild><h2>Пользователь</h2></D.Title>
                  <UserList users={users} user={user} fixed={userFixed} onPick={pick} />
                </D.Content>
              </D.Portal>
            </D.Root>
          ) : (
            <P.Root open={open} onOpenChange={setOpen}>
              <P.Trigger asChild>{triggerBtn}</P.Trigger>
              <P.Portal>
                <P.Content className={cn(popover, 'w-[280px] p-2.5')} align="end" sideOffset={6}>
                  <UserList users={users} user={user} fixed={userFixed} onPick={pick} />
                </P.Content>
              </P.Portal>
            </P.Root>
          )}
        </div>
      </div>
    </header>
  )
}
