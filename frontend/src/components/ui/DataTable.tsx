import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type Row, type SortingState } from '@tanstack/react-table'
import { useState, type ReactNode } from 'react'
import { useIsMobile } from '../../app/media'
import { cn, empty, mcard, tableWrap, tableWrapFlat, tableWrapPage, tbl, tblDense, tblStickyFirst } from '../../lib/ui'

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  onRowClick?: (row: T) => void
  footer?: ReactNode
  flat?: boolean
  initialSort?: SortingState
  getRowId?: (row: T, i: number) => string
  emptyText?: string
  /** Своя прокрутка с заданной высотой; без неё таблица растёт вместе со страницей. */
  maxHeight?: string
  dense?: boolean
  stickyFirst?: boolean
  testId?: string
  /** Мобильный карточный режим: как рисовать строку карточкой. */
  mobileCard?: (row: T) => ReactNode
  /** На мобильном — горизонтальный скролл вместо карточек. */
  mobileScroll?: boolean
}

export function DataTable<T>({ data, columns, onRowClick, footer, flat, initialSort = [], getRowId, emptyText = 'Нет данных', maxHeight, dense, stickyFirst, testId, mobileCard, mobileScroll }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort)
  const mobile = useIsMobile()
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId })
  const rows: Row<T>[] = table.getRowModel().rows
  if (mobile && mobileCard) {
    return (
      <div className="flex flex-col gap-2" data-testid={testId} data-mode="cards">
        {rows.length === 0 && <div className={empty}>{emptyText}</div>}
        {rows.map((r) => <div key={r.id} className={cn(mcard, onRowClick && 'cursor-pointer')} onClick={onRowClick ? () => onRowClick(r.original) : undefined} {...(onRowClick ? activate(() => onRowClick(r.original)) : {})} data-testid="mcard">{mobileCard(r.original)}</div>)}
      </div>
    )
  }
  return (
    <div className={cn(tableWrap, flat && tableWrapFlat, !flat && !maxHeight && !(mobile && mobileScroll) && tableWrapPage, mobile && mobileScroll && 'overflow-x-auto [-webkit-overflow-scrolling:touch]')} style={maxHeight ? { maxHeight } : undefined} data-testid={testId}>
      <table className={cn(tbl, dense && tblDense, (stickyFirst || (mobile && mobileScroll)) && tblStickyFirst)}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const canSort = h.column.getCanSort()
                const dir = h.column.getIsSorted()
                const align = (h.column.columnDef.meta as { align?: string } | undefined)?.align
                return (
                  <th key={h.id} className={cn(canSort && 'cursor-pointer', align === 'right' && 'text-right')} onClick={canSort ? h.column.getToggleSortingHandler() : undefined} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                    {flexRender(h.column.columnDef.header, h.getContext())}{dir ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="text-muted text-center py-5">{emptyText}</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className={cn(onRowClick && 'group clickable cursor-pointer focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2')} onClick={onRowClick ? () => onRowClick(r.original) : undefined} {...(onRowClick ? activate(() => onRowClick(r.original)) : {})}>
              {r.getVisibleCells().map((c) => {
                const meta = c.column.columnDef.meta as { align?: string; wrap?: boolean } | undefined
                return <td key={c.id} className={cn(onRowClick && 'group-hover:bg-wash', meta?.align === 'right' && 'text-right tabular-nums', meta?.wrap && 'whitespace-normal')}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              })}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}

/** Кликабельная строка доступна с клавиатуры: Tab до неё, Enter/пробел — как клик. */
function activate(fn: () => void) {
  return { tabIndex: 0, role: 'button' as const, onKeyDown: (e: React.KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn() } } }
}
