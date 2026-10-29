// Снимки экрана iPhone 14 и планшета через системный Chrome: node e2e/mobile/shots.mjs
import { chromium, devices } from 'playwright'
const base = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const shots = [
  ['mobile-overview-light', '/?portfolio=RUCB&theme=light'], ['mobile-overview-dark', '/?portfolio=RUCB&theme=dark'],
  ['mobile-positions', '/positions?portfolio=RUCB&theme=light'], ['mobile-bond', '/bonds/135?theme=light'],
  ['mobile-trade-sheet', '/trades?portfolio=RUCB&theme=light&user=2&new_trade=135'], ['mobile-reports', '/reports?portfolio=RUHY&theme=light'],
]
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'ru-RU' })
for (const [name, url] of shots) {
  const page = await ctx.newPage()
  await page.goto(base + url)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `screenshots/${name}.png` })
  await page.close()
}
await ctx.close()
const tab = await browser.newContext({ viewport: { width: 820, height: 1180 }, locale: 'ru-RU' })
const p = await tab.newPage()
await p.goto(base + '/?portfolio=RUCB&theme=light')
await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500)
await p.screenshot({ path: 'screenshots/tablet-overview.png', fullPage: true })
await browser.close()
console.log('done')
