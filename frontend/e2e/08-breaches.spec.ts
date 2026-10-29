import { expect, test } from '@playwright/test'
import { gotoScoped, pickUser } from './helpers'

test('нарушения RUCB (лимит на эмитента): группировка по дате, кнопка «Снять» зависит от роли', async ({ page }) => {
  await gotoScoped(page, '/risk', { portfolio: 'RUCB' })
  await pickUser(page, 'viewer')
  await expect(page.getByTestId('breaches-table').locator('tr.group-row').first()).toBeVisible()
  await expect(page.getByTestId('breach-row').first()).toBeVisible()
  await expect(page.getByTestId('waive-btn')).toHaveCount(0)
  await expect(page.getByTestId('limit-edit')).toHaveCount(0)
  await pickUser(page, 'risk')
  await expect(page.getByTestId('waive-btn').first()).toBeVisible()
  // переключение на всю историю увеличивает число записей
  const latestCount = await page.getByTestId('breach-row').count()
  await page.getByRole('radio', { name: 'вся история' }).click()
  await expect.poll(async () => page.getByTestId('breach-row').count()).toBeGreaterThan(latestCount)
})
