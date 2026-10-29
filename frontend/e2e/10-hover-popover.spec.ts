import { expect, test } from '@playwright/test'
import { gotoScoped } from './helpers'

test('«ⓘ» открывается при наведении, закрывается при уходе, клик пришпиливает, Esc закрывает', async ({ page }) => {
  await gotoScoped(page, '/')
  const btn = page.getByTestId('kpi-grid').getByTestId('info-btn').first()
  await btn.hover()
  await expect(page.getByTestId('info-popover').locator('.katex').first()).toBeVisible()
  // курсор переходит на само окно — оно не исчезает
  await page.getByTestId('info-popover').hover()
  await page.waitForTimeout(300)
  await expect(page.getByTestId('info-popover')).toBeVisible()
  await page.mouse.move(5, 500)
  await expect(page.getByTestId('info-popover')).toHaveCount(0)
  // клик — пришпилено
  await btn.click()
  await expect(page.getByTestId('info-popover')).toBeVisible()
  await page.mouse.move(5, 500)
  await page.waitForTimeout(400)
  await expect(page.getByTestId('info-popover')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('info-popover')).toHaveCount(0)
  // повторный клик по пришпиленному закрывает
  await btn.click()
  await expect(page.getByTestId('info-popover')).toBeVisible()
  await btn.click()
  await expect(page.getByTestId('info-popover')).toHaveCount(0)
})
