import { expect, test } from '@playwright/test'
import { API, gotoScoped, AS_ADMIN } from './helpers'

test('смена портфеля через селект меняет заголовок и данные', async ({ page }) => {
  await gotoScoped(page, '/')
  const before = await page.getByTestId('hero-value').textContent()
  await page.getByRole('combobox', { name: 'Портфель' }).click()
  await page.getByRole('option', { name: /^RGBI/ }).click()
  await expect(page.locator('h1')).toContainText('Индекс ОФЗ')
  await expect(page).toHaveURL(/portfolio=RGBI/)
  await expect(page.getByTestId('hero-value')).not.toHaveText(before ?? '')
})

test('дата оценки по умолчанию = дате последних данных; тема переключается', async ({ page, request }) => {
  await gotoScoped(page, '/')
  const fr = (await (await request.get(`${API}/market/freshness`, AS_ADMIN)).json()) as { data_as_of: string }
  await expect(page.getByTestId('as-of')).toHaveValue(fr.data_as_of)
  const [y, m, d] = fr.data_as_of.split('-')
  await expect(page.getByTestId('data-end')).toContainText(`${d}.${m}.${y}`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('строка фильтров умещается в одну строку при 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await gotoScoped(page, '/')
  const bar = page.locator('.filterbar-inner')
  const box = await bar.boundingBox()
  expect(box && box.height).toBeLessThan(56)
})

for (const width of [1280, 1440]) {
  test(`график и лимиты на обзоре стоят в одном ряду при ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await gotoScoped(page, '/')
    const a = await page.getByTestId('chart-main').boundingBox()
    const b = await page.getByTestId('limits-list').boundingBox()
    expect(a && b && a.x + a.width).toBeLessThan(b!.x)
    expect(a && b && Math.abs(a.y - b.y)).toBeLessThan(120)
  })
}

test('панель портфеля скрыта в справочнике выпусков, на карточке выпуска — только дата', async ({ page }) => {
  await gotoScoped(page, '/bonds')
  await expect(page.locator('.filterbar-inner')).toHaveCount(0)
  await page.getByTestId('bonds-table').locator('tbody tr[role="button"]').first().click()  // строки данных, не заглушка загрузки
  await expect(page.getByTestId('as-of')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Портфель' })).toHaveCount(0)
})
