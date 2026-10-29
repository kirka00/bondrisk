import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBonds } from '../../api/hooks'
import type { Bond } from '../../api/types'
import { useScope } from '../../app/scope'
import { DataTable } from '../../components/ui/DataTable'
import { ErrorBanner, Pager } from '../../components/ui/Misc'
import { Select } from '../../components/ui/Select'
import { Tip } from '../../components/ui/Tooltip'
import { countOf, fmt, issuerShort, labels } from '../../lib/format'
import { badge, cellSub, chip, cn, input, mcardHead, mcardKv, mcardSub, pageHead, pageSub } from '../../lib/ui'

const LIMIT = 50
const CUR_OPTS = [{ value: 'all', label: 'все валюты' }, ...['RUB', 'USD', 'EUR', 'CNY'].map((c) => ({ value: c, label: c }))]
const COUPON_OPTS = [{ value: 'all', label: 'любой купон' }, { value: 'fixed', label: 'фиксированный' }, { value: 'floating', label: 'плавающий' }, { value: 'zero', label: 'дисконтный' }]
// погашенные выпуски нужны для истории портфелей индексов, но в справочнике по умолчанию скрыты
const STATUS_OPTS = [{ value: 'trading', label: 'в обращении' }, { value: 'matured', label: 'погашенные' }, { value: 'all', label: 'все статусы' }]
const SORT_OPTS = [{ value: 'maturity_date:asc', label: 'сначала ближние погашения' }, { value: 'maturity_date:desc', label: 'сначала дальние погашения' }, { value: 'short_name:asc', label: 'по названию' }, { value: 'isin:asc', label: 'по ISIN' }]

export function BondsPage() {
  const nav = useNavigate()
  const { dataEnd } = useScope()
  const [q, setQ] = useState('')
  const [cur, setCur] = useState('all')
  const [ct, setCt] = useState('all')
  const [st, setSt] = useState('trading')
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState('maturity_date:asc')
  const [sortBy, order] = sort.split(':') as [string, 'asc' | 'desc']
  const res = useBonds({ q: q || undefined, currency: cur === 'all' ? undefined : cur, coupon_type: ct === 'all' ? undefined : ct, status: st === 'all' ? undefined : st, limit: LIMIT, offset, sort: sortBy, order })
  const stale = (b: Bond) => !!b.last_price_date && !!dataEnd && b.last_price_date < dataEnd
  const columns = useMemo<ColumnDef<Bond, unknown>[]>(() => [
    { header: 'Бумага', accessorKey: 'short_name', enableSorting: false, cell: ({ row: { original: b } }) => <span><span className="font-medium">{b.short_name}</span>{b.currency !== 'RUB' && <span className={cn(chip, 'ml-1.5')}>{b.currency}</span>}{b.status !== 'trading' && <span className={cn(badge({ status: 'na' }), 'ml-1.5')}>{labels.bondStatus[b.status] ?? b.status}</span>}<span className={cn(cellSub, 'font-mono')}>{b.isin}</span></span> },
    { header: 'Эмитент', accessorKey: 'issuer_name', enableSorting: false, meta: { wrap: true }, cell: ({ getValue }) => <Tip content={String(getValue())}><span>{issuerShort(String(getValue()), 40)}</span></Tip> },
    { header: 'Купон', accessorKey: 'coupon_type', enableSorting: false, cell: ({ row: { original: b } }) => <span><span className="tabular-nums">{b.coupon_rate_pct != null ? fmt.pct(b.coupon_rate_pct) : '—'}</span><span className={cellSub}>{labels.coupon[b.coupon_type]}</span></span> },
    { header: 'Погашение', accessorKey: 'maturity_date', enableSorting: false, cell: ({ row }) => <span>{fmt.date(row.original.maturity_date)}{row.original.offer_date && <span className={cellSub}>оферта {fmt.date(row.original.offer_date)}</span>}</span> },
    { header: 'Цена, %', accessorKey: 'last_price_pct', enableSorting: false, meta: { align: 'right' }, cell: ({ row: { original: b } }) => <span>{fmt.num(b.last_price_pct)}{stale(b) && <span className={cellSub}>на {fmt.date(b.last_price_date)}</span>}</span> },
    { header: 'Рейтинг', accessorKey: 'rating_grade', enableSorting: false, cell: ({ row }) => <Tip content={`${row.original.rating_source ? labels.ratingSource[row.original.rating_source] : 'без рейтинга'}${row.original.rating_agency ? ` · ${row.original.rating_agency}` : ''}`}><span>{row.original.rating_grade ?? '—'}{row.original.rating_source === 'issuer' ? '*' : ''}</span></Tip> },
  ], [dataEnd]) // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => setOffset(0)
  return (
    <div className="flex flex-col gap-3">
      <div className={pageHead}>
        <div><h1>Выпуски</h1><div className={pageSub}>{res.data ? `${countOf(res.data.total, ['выпуск', 'выпуска', 'выпусков'])} в справочнике` : '…'}{dataEnd ? ` · цены на ${fmt.date(dataEnd)}` : ''}</div></div>
      </div>
      <div className="flex items-center gap-2 flex-wrap max-md:[&>*]:flex-1">
        <input type="search" className={cn(input(), 'w-[280px] max-md:w-full max-md:basis-full')} placeholder="ISIN, название или эмитент" value={q} onChange={(e) => { setQ(e.target.value); reset() }} data-testid="bonds-search" />
        <Select value={cur} onChange={(v) => { setCur(v); reset() }} options={CUR_OPTS} ariaLabel="Валюта" width={140} />
        <Select value={ct} onChange={(v) => { setCt(v); reset() }} options={COUPON_OPTS} ariaLabel="Тип купона" width={170} />
        <Select value={st} onChange={(v) => { setSt(v); reset() }} options={STATUS_OPTS} ariaLabel="Статус" width={150} />
        <Select value={sort} onChange={(v) => { setSort(v); reset() }} options={SORT_OPTS} ariaLabel="Сортировка" width={240} className="ml-auto max-md:ml-0" />
      </div>
      <ErrorBanner error={res.error} />
      <div className={cn('transition-opacity', res.isFetching && 'opacity-60')}>
        <DataTable data={res.data?.items ?? []} columns={columns} onRowClick={(b) => nav({ pathname: `/bonds/${b.bond_id}`, search: location.search })} getRowId={(r) => String(r.bond_id)} emptyText={res.isPending ? 'Загрузка…' : 'Нет данных'} dense testId="bonds-table"
          mobileCard={(b) => (
            <>
              <div className={mcardHead}><b>{b.short_name}</b><span className={chip}>{b.rating_grade ?? '—'}{b.rating_source === 'issuer' ? '*' : ''}</span></div>
              <div className={mcardSub}><span>{issuerShort(b.issuer_name, 30)}</span>{b.currency !== 'RUB' && <span className={chip}>{b.currency}</span>}</div>
              <div className={mcardKv}>
                <span><span className="k">Купон</span><span className="v">{labels.coupon[b.coupon_type]}{b.coupon_rate_pct != null ? ` ${fmt.pct(b.coupon_rate_pct)}` : ''}</span></span>
                <span><span className="k">Погашение</span><span className="v">{fmt.date(b.maturity_date)}</span></span>
                <span><span className="k">Цена, %</span><span className="v">{fmt.num(b.last_price_pct)}</span></span>
              </div>
            </>
          )} />
      </div>
      {res.data && res.data.total > LIMIT && <Pager total={res.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      <p className="text-muted text-xs">* — рейтинг эмитента (у выпуска нет собственного); агентство и источник — в подсказке.</p>
    </div>
  )
}
