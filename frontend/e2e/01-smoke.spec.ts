import { expect, test } from '@playwright/test'
import { ROUTES, gotoScoped, watchConsole } from './helpers'

for (const route of ROUTES) {
  test(`маршрут ${route} открывается без ошибок консоли`, async ({ page }) => {
    const errors = watchConsole(page)
    await gotoScoped(page, route)
    await expect(page.locator('h1')).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.banner.error')).toHaveCount(0)
    expect(errors, errors.join('\n')).toEqual([])
  })
}

test('шапка: логотип без подзаголовка, меню пользователя в одну строку', async ({ page }) => {
  await gotoScoped(page, '/')
  await expect(page.locator('.brand')).toHaveText('bondrisk')
  const name = page.locator('.user-btn .user-name .n')
  const box = await name.boundingBox()
  expect(box && box.height).toBeLessThan(24)
})
