import { expect, test } from '@playwright/test'
import { API, gotoScoped, pickUser, portfolioId, AS_ADMIN } from './helpers'
import type { Page } from '@playwright/test'

/** Вводит запрос в combobox бумаги, ждёт ответ поиска и выбирает первую подходящую строку. */
async function pickBond(page: Page, q: string) {
  const input = page.getByRole('dialog').getByTestId('trade-bond')
  const resp = page.waitForResponse((r) => r.url().includes('/bonds?') && new URL(r.url()).searchParams.get('q') === q)
  await input.fill(q)
  await resp
  const item = page.locator('.combobox-item', { hasText: q }).first()
  await expect(item).toBeVisible()
  await item.click()
}

test('сделка: превью «до/после», блокировка по лимиту, исполнение 1 шт. в RGBI', async ({ page, request }) => {
  await gotoScoped(page, '/trades', { portfolio: 'RUCB' })
  await pickUser(page, 'trader')
  await page.getByTestId('new-trade').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await pickBond(page, 'Сбер')
  await dlg.getByTestId('trade-qty').fill('1000')
  const rows = dlg.getByTestId('preview-table').locator('tbody tr')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
  await expect(rows.filter({ has: page.getByRole('cell', { name: 'DV01', exact: true }) })).toHaveCount(1)
  // кнопка «Исполнить» согласована с баннером блокировки (оба состояния проверяются явно)
  await expect.poll(async () => (await dlg.getByTestId('trade-blocked').count()) === (await dlg.getByTestId('trade-submit').isDisabled() ? 1 : 0)).toBe(true)
  // трейдер не может отключить проверку жёстких лимитов
  await expect(dlg.getByTestId('trade-check')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // исполнение 1 штуки ОФЗ в портфеле RGBI без проверки лимитов
  const pid = await portfolioId(request, 'RGBI')
  const before = (await (await request.get(`${API}/portfolios/${pid}/trades?limit=1`, AS_ADMIN)).json()) as { total: number }
  await gotoScoped(page, '/trades', { portfolio: 'RGBI' })
  await pickUser(page, 'trader')
  await page.getByTestId('new-trade').click()
  await pickBond(page, 'ОФЗ 26207')
  await expect(dlg.getByTestId('trade-bond')).toHaveValue('ОФЗ 26207')
  await dlg.getByTestId('trade-qty').fill('1')
  await expect(dlg.getByTestId('trade-price')).not.toHaveValue('')
  await expect(dlg.getByTestId('trade-submit')).toBeEnabled()
  await dlg.getByTestId('trade-submit').click()
  await expect(page.locator('.toast.success').last()).toContainText('куплено 1')
  await expect(dlg).toBeHidden()
  await expect(page.getByTestId('trades-table').locator('tbody tr').first()).toContainText('ОФЗ 26207')
  const after = (await (await request.get(`${API}/portfolios/${pid}/trades?limit=1`, AS_ADMIN)).json()) as { total: number }
  expect(after.total).toBe(before.total + 1)
})

test('наблюдатель не может открыть форму сделки', async ({ page }) => {
  await gotoScoped(page, '/trades')
  await pickUser(page, 'viewer')
  await expect(page.getByTestId('new-trade')).toHaveCount(0)
})

test('фильтр периода сделок и панель с деталями сделки', async ({ page }) => {
  await gotoScoped(page, '/trades')
  const rows = page.getByTestId('trades-table').locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  const sub = page.locator('h1 + div')
  const all = await sub.textContent()
  await page.getByTestId('trade-period').getByRole('radio', { name: 'месяц' }).click()
  await expect(sub).not.toHaveText(all ?? '')
  await expect(sub).toContainText(' с ')
  await page.getByTestId('trade-period').getByRole('radio', { name: 'период…' }).click()
  await expect(page.getByLabel('С даты')).toBeVisible()
  await page.getByTestId('trade-period').getByRole('radio', { name: 'всё время' }).click()
  await rows.first().click()
  await expect(page.getByTestId('trade-sheet')).toContainText('Контрагент')
})
