import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const API = 'http://127.0.0.1:8000/api/v1'
/** API требует пользователя; служебные запросы тестов — от администратора (user_id 1). */
export const AS_ADMIN = { headers: { 'X-User-Id': '1' } }
export const ROUTES = ['/', '/positions', '/trades', '/risk', '/reports', '/bonds'] as const

/** Собирает ошибки консоли и исключения страницы; warnings React тоже считаются ошибками. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

export async function gotoScoped(page: Page, path: string, q: Record<string, string> = {}) {
  const sp = new URLSearchParams({ portfolio: 'RUCB', theme: 'light', ...q })
  await page.goto(`${path}?${sp.toString()}`)
  await expect(page.locator('h1')).toBeVisible()
}

export async function portfolioId(request: APIRequestContext, code: string): Promise<number> {
  const r = await request.get(`${API}/portfolios`, AS_ADMIN)
  const d = (await r.json()) as { items: { portfolio_id: number; code: string }[] }
  const p = d.items.find((x) => x.code === code)
  if (!p) throw new Error(`portfolio ${code} not found`)
  return p.portfolio_id
}

export async function pickUser(page: Page, login: string) {
  await page.getByTestId('user-menu').click()
  await page.getByTestId(`user-${login}`).click()
}
