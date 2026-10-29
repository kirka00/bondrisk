export function Footer() {
  return (
    <footer className="border-t border-border text-muted text-xs max-md:hidden">
      <div className="max-w-[1440px] mx-auto px-6 py-3 flex gap-4 flex-wrap">
        <span>bondrisk · курсовой проект по БД, PostgreSQL 18 + TimescaleDB</span>
        <span>Графики — <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></span>
        <span>Данные: MOEX ISS, Банк России, АКРА/НКР/НРА</span>
      </div>
    </footer>
  )
}
