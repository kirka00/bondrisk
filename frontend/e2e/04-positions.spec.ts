import { expect, test } from '@playwright/test'
import { API, gotoScoped, portfolioId, AS_ADMIN } from './helpers'

test('позиции: число строк = API, сортировка, боковая панель с формулой', async ({ page, request }) => {
  const pid = await portfolioId(request, 'RUCB')
  await gotoScoped(page, '/positions')
  const curve = (await (await request.get(`${API}/market/curve`, AS_ADMIN)).json()) as { curve_date: string }
  const api = (await (await request.get(`${API}/portfolios/${pid}/positions?as_of=${curve.curve_date}`, AS_ADMIN)).json()) as { items: { bond_id: number; mv_rub: number }[] }
  const rows = page.getByTestId('positions-table').locator('tbody tr')
  await expect(rows).toHaveCount(api.items.length)
  // все столбцы видны без горизонтального скролла при 1280
  await page.setViewportSize({ width: 1280, height: 900 })
  const wrap = page.getByTestId('positions-table')
  const fits = await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(fits).toBe(true)
  // сортировка по DV01: кликаем заголовок и сверяем порядок
  const dv01 = async () => {
    const idx = await page.getByRole('columnheader').evaluateAll((hs) => hs.findIndex((h) => /DV01/.test(h.textContent ?? '')))
    return (await rows.locator(`td:nth-child(${idx + 1})`).allTextContents()).map((t) => Number(t.replace(/[^\d,-]/g, '').replace(',', '.')))
  }
  // первое нажатие — по убыванию (TanStack для чисел), второе — по возрастанию; проверяется сам порядок
  await page.getByRole('columnheader', { name: /DV01/ }).click()
  const first = await dv01()
  const dir = first[0] >= first.at(-1)! ? -1 : 1
  expect(first).toEqual([...first].sort((a, b) => dir * (a - b)))
  await page.getByRole('columnheader', { name: /DV01/ }).click()
  const second = await dv01()
  expect(second).toEqual([...second].sort((a, b) => -dir * (a - b)))
  // панель
  await rows.first().click()
  await expect(page.getByTestId('position-sheet')).toBeVisible()
  await expect(page.getByTestId('position-sheet').locator('.katex').first()).toBeVisible()
})
