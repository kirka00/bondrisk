import { expect, test } from '@playwright/test'
import { API, AS_ADMIN, gotoScoped, pickUser, portfolioId } from './helpers'

test.setTimeout(120_000)

test('лимиты: создать мягкий лимит dv01 в RGBI, увидеть загрузку, изменить и удалить из формы', async ({ page, request }) => {
  const pid = await portfolioId(request, 'RGBI')
  await gotoScoped(page, '/risk', { portfolio: 'RGBI' })
  await pickUser(page, 'risk')
  try {
    await page.getByTestId('new-limit').click()
    const dlg = page.getByRole('dialog')
    await dlg.getByTestId('limit-metric').click()
    await page.getByRole('option', { name: 'DV01 портфеля' }).click()
    await dlg.getByTestId('limit-abs').fill('1 000 000 000,5')   // пробелы и запятая — как вводят по-русски
    await dlg.getByTestId('limit-hard').getByRole('radio', { name: 'мягкий' }).click()
    await dlg.getByTestId('limit-save').click()
    await expect(page.locator('.toast.success').last()).toContainText('создан')
    const row = page.getByTestId('limits-table').locator('tbody tr').filter({ hasText: 'DV01 портфеля' }).filter({ hasText: '1 000 000 001' })
    await expect(row).toHaveCount(1)
    // после сохранения пересчитываются все отчёты портфеля, факт приходит не сразу
    await expect(row.getByRole('meter')).toBeVisible({ timeout: 45_000 })
    // в изменении метрика зафиксирована (PATCH её не меняет), порог — меняется
    await row.getByTestId('limit-edit').click()
    await expect(dlg.getByTestId('limit-metric')).not.toHaveAttribute('role', 'combobox')
    await dlg.getByTestId('limit-abs').fill('2000000000')
    await dlg.getByTestId('limit-save').click()
    await expect(page.locator('.toast.success').last()).toContainText('обновлён')
    const row2 = page.getByTestId('limits-table').locator('tbody tr').filter({ hasText: '2 000 000 000' })
    await expect(row2).toHaveCount(1)
    await row2.getByTestId('limit-edit').click()
    await dlg.getByTestId('limit-delete').click()
    await dlg.getByTestId('limit-delete-confirm').click()
    await expect(page.locator('.toast.success').last()).toContainText('удалён')
    await expect(row2).toHaveCount(0)
  } finally {
    // при падении посреди теста лимит не должен остаться в RGBI и сломать следующий прогон
    const risk = (await (await request.get(`${API}/users`, AS_ADMIN)).json()) as { user_id: number; login: string }[]
    const rid = String(risk.find((u) => u.login === 'risk')!.user_id)
    const left = (await (await request.get(`${API}/limits?portfolio_id=${pid}&limit=200`, { headers: { 'X-User-Id': rid } })).json()) as { items: { limit_id: number; metric: string; threshold_abs: number | null }[] }
    for (const l of left.items.filter((x) => x.metric === 'dv01' && (x.threshold_abs ?? 0) >= 1e9)) await request.delete(`${API}/limits/${l.limit_id}`, { headers: { 'X-User-Id': rid } })
  }
})

test('старые адреса /limits и /breaches ведут в раздел «Лимиты»', async ({ page }) => {
  await gotoScoped(page, '/limits')
  await expect(page).toHaveURL(/\/risk\?/)
  await gotoScoped(page, '/breaches', { portfolio: 'RUHY' })
  await expect(page).toHaveURL(/\/risk\?.*#breaches/)
  await expect(page.locator('h1')).toContainText('Лимиты')
})
