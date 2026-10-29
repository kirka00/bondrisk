import { expect, test } from '@playwright/test'
import { gotoScoped, pickUser } from './helpers'

// Регрессии по итогам ревью: каждый тест воспроизводит найденный баг.

test('смена портфеля со 2-й страницы сделок сбрасывает страницу и фильтры', async ({ page }) => {
  await gotoScoped(page, '/trades', { portfolio: 'RUCB' })
  const rows = page.getByTestId('trades-table').locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  await page.getByRole('button', { name: '→' }).click()
  await expect(page.getByText(/стр\. 2 из/)).toBeVisible()
  await page.getByRole('combobox', { name: 'Портфель' }).click()
  await page.getByRole('option', { name: /^RUCNY/ }).click()
  await expect(page.locator('h1')).not.toContainText('корп. облигаций')
  await expect(rows.first()).toBeVisible()
  await expect(page.getByText('Сделок нет')).toHaveCount(0)
})

test('ссылка «новая сделка» открывает диалог один раз и уходит из адреса', async ({ page }) => {
  await gotoScoped(page, '/trades', { user: '2', new_trade: '135' })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).not.toHaveURL(/new_trade=/)
  await page.keyboard.press('Escape')
  await page.getByTestId('section-tabs').getByRole('link', { name: 'Позиции' }).click()
  await page.getByTestId('section-tabs').getByRole('link', { name: 'Сделки' }).click()
  await expect(page.getByTestId('trades-table')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('цена сделки с запятой принимается, поле можно очистить', async ({ page }) => {
  await gotoScoped(page, '/trades', { portfolio: 'RGBI', user: '2', new_trade: '1' })
  const dlg = page.getByRole('dialog')
  const price = dlg.getByTestId('trade-price')
  await expect(price).not.toHaveValue('')
  await price.fill('')
  await expect(price).toHaveValue('')
  await expect(dlg.getByTestId('trade-submit')).toBeDisabled()
  await price.fill('98,5')
  await dlg.getByTestId('trade-qty').fill('1')
  await expect(dlg.getByTestId('trade-submit')).toBeEnabled({ timeout: 20_000 })
})

test('строка справочника открывается с клавиатуры', async ({ page }) => {
  await gotoScoped(page, '/bonds')
  await page.waitForLoadState('networkidle')
  const first = page.getByTestId('bonds-table').locator('tbody tr[role="button"]').first()
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/bonds\/\d+/)
  await expect(page.getByTestId('kpi-price')).toBeVisible()
})

test('некорректный адрес выпуска — сообщение, а не вечная загрузка', async ({ page }) => {
  await page.goto('/bonds/abc?theme=light')   // h1 на этой странице нет — gotoScoped не подходит
  await expect(page.getByText('Выпуск не найден')).toBeVisible()
})

test('наблюдатель видит раздел «Лимиты» без кнопок изменения', async ({ page }) => {
  await gotoScoped(page, '/risk', { portfolio: 'RUHY' })
  await pickUser(page, 'viewer')
  await expect(page.getByTestId('limits-table').locator('tbody tr').first()).toBeVisible()
  await expect(page.getByTestId('new-limit')).toHaveCount(0)
  await expect(page.getByTestId('limit-edit')).toHaveCount(0)
})
