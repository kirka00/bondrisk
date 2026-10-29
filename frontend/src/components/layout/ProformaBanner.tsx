import { useLocation } from 'react-router-dom'
import { useScope } from '../../app/scope'
import { fmt } from '../../lib/format'
import { banner, button, cn } from '../../lib/ui'

/** Страницы, где показывается оценка портфеля на дату (а значит, и про-форма). */
const VALUED = ['/', '/positions', '/risk', '/reports']

/**
 * Дата оценки раньше первой сделки: позиций по факту ещё нет, поэтому показывается текущий состав
 * по рынку выбранной даты — так же, как ретроспективные (пунктирные) снапшоты EOD.
 */
export function ProformaBanner() {
  const { holdings, asOf, setAsOf } = useScope()
  const { pathname } = useLocation()
  if (!holdings || !VALUED.includes(pathname)) return null
  return (
    <div className={cn(banner({ kind: 'info' }), 'mb-4 flex items-center gap-3 flex-wrap max-md:mb-3')} role="status" data-testid="proforma-banner">
      <span className="flex-1 min-w-[240px]">
        <b className="font-semibold">Про-форма.</b> Портфель сформирован {fmt.date(holdings)}, на {fmt.date(asOf)} сделок ещё не было.
        Показан текущий состав по ценам, кривой и курсам на {fmt.date(asOf)} — как пунктир на графиках; нарушения лимитов по про-форме не фиксируются.
        {pathname === '/reports' && ' Про-форма считается для стресс-теста и ADV01 (по снапшотам); G-спреды, стена реинвестирования и P&L строятся только по фактическим позициям и до даты формирования пусты.'}
      </span>
      <button className={button({ size: 'sm' })} onClick={() => setAsOf(holdings)}>Показать на {fmt.date(holdings)}</button>
    </div>
  )
}
