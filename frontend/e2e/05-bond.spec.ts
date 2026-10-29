import { expect, test } from '@playwright/test'
import { API, gotoScoped, AS_ADMIN } from './helpers'

test('карточка выпуска: KPI заполнены, график с панелями, переключатель агрегации', async ({ page, request }) => {
  const bonds = (await (await request.get(`${API}/bonds?limit=1&status=trading&q=ОФЗ 26`, AS_ADMIN)).json()) as { items: { bond_id: number }[] }
  const id = bonds.items[0].bond_id
  await gotoScoped(page, `/bonds/${id}`)
  await expect(page.getByTestId('kpi-price')).not.toContainText('—')
  await expect(page.getByTestId('kpi-price')).toContainText('%')
  const chart = page.getByTestId('bond-chart')
  await expect(chart.locator('canvas').first()).toBeVisible()
  const canvasesDay = await chart.locator('canvas').count()
  expect(canvasesDay).toBeGreaterThanOrEqual(1)
  const req = page.waitForRequest((r) => r.url().includes(`/bonds/${id}/prices`) && r.url().includes('bucket=week'))
  await page.getByRole('radio', { name: 'неделя' }).click()
  const url = new URL((await req).url())
  // параметры, которые читает API: раньше уходили from/to, и сервер их молча игнорировал
  expect(url.searchParams.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(url.searchParams.get('date_to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await page.waitForLoadState('networkidle')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await page.getByRole('radio', { name: 'месяц' }).click()
  await page.waitForLoadState('networkidle')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(page.getByTestId('schedule-timeline').locator('svg')).toBeVisible()
})
