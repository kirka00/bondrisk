import { useEffect, useState } from 'react'

/** Реактивный media query. Брейкпоинты: sm 640, md 900, lg 1200. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  const [m, setM] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const h = () => setM(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return m
}
export const useIsMobile = () => useMediaQuery('(max-width: 899px)')
export const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
