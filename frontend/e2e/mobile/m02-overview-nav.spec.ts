import { expect, test } from '@playwright/test'
import { gotoScoped } from '../helpers'

test('mobile обзор: плитки видны, нижняя навигация и вкладки раздела переключают страницы', async ({ page }) => {
  await gotoScoped(page, '/')
  await expect(page.getByTestId('kpi-tile')).toHaveCount(10)
  await expect(page.getByTestId('hero-value')).toBeVisible()
  const nav = page.getByTestId('bottom-nav')
  await nav.getByRole('link', { name: 'Портфель' }).tap()
  await expect(page.locator('h1')).toContainText('Портфель')
  await page.getByTestId('section-tabs').getByRole('link', { name: 'Сделки' }).tap()
  await expect(page.getByTestId('trades-table')).toHaveAttribute('data-mode', 'cards')
  await expect(page.getByTestId('trades-table').getByTestId('mcard').first()).toBeVisible()
  await nav.getByRole('link', { name: 'Аналитика' }).tap()
  await expect(page.locator('h1')).toContainText('Аналитика')
  await nav.getByRole('link', { name: 'Лимиты' }).tap()
  await expect(page.locator('h1')).toContainText('Лимиты')
  await expect(page.getByTestId('limits-table')).toHaveAttribute('data-mode', 'cards')
  // «ⓘ» по тапу открывает и закрывает
  await nav.getByRole('link', { name: 'Обзор' }).tap()
  const btn = page.getByTestId('kpi-grid').getByTestId('info-btn').first()
  await btn.tap()
  await expect(page.getByTestId('info-popover').locator('.katex').first()).toBeVisible()
  await btn.tap()
  await expect(page.getByTestId('info-popover')).toHaveCount(0)
})

test('mobile позиции — карточки; сделка — bottom-sheet с превью', async ({ page }) => {
  await gotoScoped(page, '/positions')
  const cards = page.getByTestId('positions-table')
  await expect(cards).toHaveAttribute('data-mode', 'cards')
  await expect(cards.getByTestId('mcard').first()).toBeVisible()
  await gotoScoped(page, '/trades', { user: '2', new_trade: '135' })
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  const box = await dlg.boundingBox()
  const vp = page.viewportSize()!
  expect(box && box.width).toBeGreaterThanOrEqual(vp.width - 2)
  expect(box && box.y + box.height).toBeGreaterThanOrEqual(vp.height - 2)
  await expect(dlg.getByTestId('preview-table').locator('tbody tr').first()).toBeVisible({ timeout: 20_000 })
  const inner = await dlg.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(inner, 'bottom-sheet без горизонтального переполнения').toBeLessThanOrEqual(0)
})
