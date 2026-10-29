import { expect, test } from '@playwright/test'
import { ROUTES, gotoScoped, watchConsole } from '../helpers'

for (const route of ROUTES) {
  test(`mobile ${route}: без ошибок консоли и горизонтального переполнения`, async ({ page }) => {
    const errors = watchConsole(page)
    await gotoScoped(page, route)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `scrollWidth − innerWidth на ${route}`).toBeLessThanOrEqual(0)
    await expect(page.getByTestId('bottom-nav')).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
  })
}
