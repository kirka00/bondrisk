/** Разделы приложения: шапка, нижняя навигация и вкладки внутри раздела берут их отсюда. */
export interface Section {
  to: string
  name: string
  /** Пути, при которых раздел подсвечен как активный. */
  match: string[]
  /** Вкладки внутри раздела (отдельные маршруты). */
  tabs?: { to: string; name: string }[]
}

export const SECTIONS: Section[] = [
  { to: '/', name: 'Обзор', match: ['/'] },
  {
    to: '/positions', name: 'Портфель', match: ['/positions', '/trades'],
    tabs: [{ to: '/positions', name: 'Позиции' }, { to: '/trades', name: 'Сделки' }],
  },
  { to: '/risk', name: 'Лимиты', match: ['/risk'] },
  { to: '/reports', name: 'Аналитика', match: ['/reports'] },
  { to: '/bonds', name: 'Выпуски', match: ['/bonds'] },
]

export function isActive(s: Section, pathname: string): boolean {
  return s.match.some((m) => (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`)))
}

/** Страницы, где выбор портфеля не влияет на содержимое. */
export const portfolioFree = (pathname: string) => pathname === '/bonds' || pathname.startsWith('/bonds/')
/** Страницы, где не нужна и дата оценки. */
export const scopeFree = (pathname: string) => pathname === '/bonds'
