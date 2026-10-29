import { expect, test } from '@playwright/test'
import { gotoScoped, watchConsole } from './helpers'

test('обзор RUCB: hero, 10 показателей с формулами, график с переключателем, лимиты, табличный вид', async ({ page }) => {
  const errors = watchConsole(page)
  await gotoScoped(page, '/')
  await expect(page.locator('h1')).toContainText('Индекс корп. облигаций')
  await expect(page.getByTestId('hero-value')).toContainText('₽')
  await expect(page.getByTestId('hero-value')).not.toContainText('—')
  const tiles = page.getByTestId('kpi-tile')
  await expect(tiles).toHaveCount(10)
  // подписи не обрезаны: ширина текста ≤ ширины плитки
  for (const t of await tiles.all()) {
    const label = t.locator('.tile-label > span').first()
    const sw = await label.evaluate((el) => (el as HTMLElement).scrollWidth <= (el as HTMLElement).clientWidth + 1)
    expect(sw).toBe(true)
  }
  // каждая «ⓘ» открывает поповер с KaTeX
  for (let i = 0; i < 10; i++) {
    await tiles.nth(i).getByTestId('info-btn').click()
    await expect(page.locator('.popover .katex').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.popover')).toHaveCount(0)
  }
  const chart = page.getByTestId('chart-main')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await page.getByTestId('chart-switch').getByRole('radio', { name: 'Стоимость' }).click()
  await expect(page.locator('h2').filter({ hasText: 'Стоимость портфеля' })).toBeVisible()
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(page.getByTestId('limits-list').getByTestId('limit-row').first()).toBeVisible()
  // табличный вид графика
  await chart.getByTestId('chart-table-toggle').click()
  await expect(chart.locator('table tbody tr').first()).toBeVisible()
  await chart.getByTestId('chart-table-toggle').click()
  await expect(chart.locator('canvas').first()).toBeVisible()
  // «все сценарии» ведёт на вкладку стресс-теста
  await page.getByRole('link', { name: 'все сценарии' }).click()
  await expect(page).toHaveURL(/\/reports\?.*tab=stress/)
  await expect(page.getByTestId('stress-table')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(errors, errors.join('\n')).toEqual([])
})

test('дата раньше первой сделки: про-форма текущего состава с пояснением, а не нули', async ({ page }) => {
  await gotoScoped(page, '/', { portfolio: 'BOND', as_of: '2026-10-22' })
  const banner = page.getByTestId('proforma-banner')
  await expect(banner).toContainText('Про-форма')
  await expect(page.getByTestId('hero-value')).not.toHaveText(/^0 ₽$/)
  await expect(page.locator('h1 + div')).toContainText('состав на 23.10.2026')
  await banner.getByRole('button', { name: /Показать на/ }).click()
  await expect(page.getByTestId('as-of')).toHaveValue('2026-10-23')
  await expect(banner).toHaveCount(0)
  // у портфеля с историей сделок (репликант индекса с 2024 г.) про-формы нет
  await gotoScoped(page, '/', { portfolio: 'RUCB', as_of: '2026-10-22' })
  await expect(page.getByTestId('hero-value')).toBeVisible()
  await expect(page.getByTestId('proforma-banner')).toHaveCount(0)
})
