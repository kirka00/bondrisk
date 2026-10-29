import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'bondrisk.theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function currentTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || t === 'light' ? t : systemTheme()
}

const listeners = new Set<() => void>()
function notify() { for (const l of listeners) l() }

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => {
    const l = () => setTheme(currentTheme())
    listeners.add(l)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', l)
    return () => { listeners.delete(l); mq.removeEventListener('change', l) }
  }, [])
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem(KEY, next) } catch { /* ignore */ }
    notify()
  }, [])
  return [theme, toggle]
}
