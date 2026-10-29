# bondrisk — веб-интерфейс

React 19 + TypeScript + Vite · TanStack Query / Table · React Router · TradingView Lightweight Charts™ v5 · KaTeX · Radix UI · Playwright.

```bash
npm install
npm run dev          # http://localhost:5173, /api проксируется на http://localhost:8000
npm run build        # dist/ (tsc strict + vite)
npm run lint         # oxlint
npm run e2e          # Playwright против живого API (нужны контейнеры db + api), системный Chrome
```

В Docker Compose собирается сервис `web` (nginx, порт 3000, `/api/` → `api:8000`).

## Структура

```
src/app/            App (роутер, провайдеры), scope (портфель · дата оценки · пользователь в URL/localStorage), theme
src/api/            client (X-User-Id, ApiError), types, hooks (TanStack Query, keepPreviousData)
src/lib/            format (ru-RU, короткие имена эмитентов), formulas (KaTeX + подстановка значений), dates, colors
src/components/ui/  Button Card Select Combobox DataTable Dialog Popover Tooltip Tabs Segmented Meter StatusBadge Toast InfoButton Formula
src/components/charts/ TvChart (TradingView: панели, тема, тултип, легенда, пресеты, табличный вид) BarChart CurveChart DotPlot ScheduleTimeline WallChart Sparkline
src/features/       overview positions bonds trades limits breaches reports
e2e/                Playwright: smoke, обзор, область, позиции, выпуск, сделка, лимиты, нарушения, отчёты
screenshots/        контрольные снимки экранов
```

## Поведение

- Область (портфель, дата оценки, пользователь, тема) — в URL: `?portfolio=CORP&as_of=2026-10-23&user=2&theme=dark`.
  Дата оценки по умолчанию — дата последних рыночных данных (последняя кривая КБД / котировка MOEX).
- Роли: сделки и пополнение кассы — трейдер/администратор; лимиты и снятие нарушений — риск-менеджер/администратор; наблюдатель только смотрит.
- Deep-links: `/trades?new_trade=<bond_id>` открывает форму сделки с выбранной бумагой, `/reports?tab=curve` — вкладку отчёта.
- Формулы методологии — кнопка «ⓘ» у каждого показателя (поповер с KaTeX и подстановкой текущих значений).

Графики временных рядов — [TradingView Lightweight Charts™](https://www.tradingview.com/) (атрибуция в футере обязательна по лицензии).
