import { expect, test } from '@playwright/test'
import { gotoScoped, watchConsole } from './helpers'

const TABS = ['Стресс-тест', 'ADV01', 'G-спреды', 'Стена реинвестирования', 'P&L', 'Пропуски котировок', 'Миграции рейтингов', 'Кривая КБД']

test('отчёты: каждая вкладка рендерит таблицу или график', async ({ page }) => {
  const errors = watchConsole(page)
  await gotoScoped(page, '/reports')
  for (const t of TABS) {
    await page.getByRole('tab', { name: t, exact: true }).click()
    await page.waitForLoadState('networkidle')
    const panel = page.locator('[role="tabpanel"][data-state="active"]')
    const data = panel.locator('table tbody tr, svg circle, svg path, canvas, [data-testid=migration-row]')
    if (t === 'Пропуски котировок') await expect.poll(async () => (await data.count()) + (await panel.locator('.empty').count()), `вкладка ${t}`).toBeGreaterThan(0)
    else await expect.poll(() => data.count(), `вкладка ${t}: есть данные, а не пустое состояние`).toBeGreaterThan(0)
  }
  await expect(page).toHaveURL(/tab=curve/)
  await page.getByRole('tab', { name: 'Кривая КБД' }).click()
  await expect.poll(async () => page.getByTestId('curve-chart').locator('circle').count()).toBeGreaterThanOrEqual(5)
  expect(errors, errors.join('\n')).toEqual([])
})
