/** Обёртка TradingView Lightweight Charts v5: тема, панели, тултип, легенда, пресеты периода, табличный вид. */
import { AreaSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type SeriesType, type Time } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../app/theme'
import { series as tok, withAlpha } from '../../lib/colors'
import { addMonths } from '../../lib/dates'
import { fmt } from '../../lib/format'
import { button, chartTooltip, cn, empty, legend, legendKey, legendKeyRect, seg, segItem, segItemOn, tableWrap, tbl } from '../../lib/ui'

export interface TvSeries {
  id: string
  name: string
  color: string          // имя токена: s1…s8, muted
  kind: 'line' | 'area' | 'histogram'
  data: { time: string; value: number }[]
  pane?: number
  precision?: number
  format?: (v: number) => string
  unit?: string
  lastValue?: boolean   // подпись последнего значения на шкале (по умолчанию да)
  dashed?: boolean      // пунктир (про-форма / ретроспектива)
}
export type RangePreset = '1M' | '3M' | '6M' | '1Y' | 'ALL'

interface Props {
  series: TvSeries[]
  height?: number
  loading?: boolean
  paneHeights?: number[]
  defaultRange?: RangePreset
  showPresets?: boolean
  title?: string
  hint?: string
  testId?: string
}

const colorOf = (name: string): string => (tok as Record<string, () => string>)[name]?.() ?? name

export function TvChart({ series, height = 260, loading, paneHeights, defaultRange = 'ALL', showPresets = true, title, hint, testId }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const apisRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map())
  const [theme] = useTheme()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [range, setRange] = useState<RangePreset>(defaultRange)
  const [tableView, setTableView] = useState(false)
  const lastTime = useMemo(() => series.reduce<string | null>((acc, s) => { const t = s.data.at(-1)?.time; return t && (!acc || t > acc) ? t : acc }, null), [series])

  // создание графика
  useEffect(() => {
    if (!ref.current || tableView) return
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: tok.surface() }, textColor: tok.muted(), attributionLogo: false, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: tok.grid() } },
      rightPriceScale: { borderColor: tok.axis() },
      timeScale: { borderColor: tok.axis(), timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: tok.axis(), labelBackgroundColor: tok.text2() }, horzLine: { color: tok.axis(), labelBackgroundColor: tok.text2() } },
      handleScroll: { vertTouchDrag: false },
      localization: { priceFormatter: (v: number) => (Math.abs(v) >= 100_000 ? axisCompact(v) : fmt.num(v, series[0]?.precision ?? 2)) },
    })
    chartRef.current = chart
    const apis = apisRef.current
    apis.clear()
    for (const s of series) {
      const color = colorOf(s.color)
      const pf = { type: 'price' as const, precision: s.precision ?? 2, minMove: Math.pow(10, -(s.precision ?? 2)) }
      const common = { priceFormat: pf, priceLineVisible: false, lastValueVisible: s.lastValue ?? true, title: '' }
      let api: ISeriesApi<SeriesType>
      if (s.kind === 'area') api = chart.addSeries(AreaSeries, { ...common, lineColor: color, lineWidth: 2, lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid, topColor: withAlpha(color, 0.12), bottomColor: withAlpha(color, 0.0), crosshairMarkerRadius: 4, crosshairMarkerBorderColor: tok.surface(), crosshairMarkerBorderWidth: 2 }, s.pane ?? 0)
      else if (s.kind === 'histogram') api = chart.addSeries(HistogramSeries, { ...common, color: withAlpha(color, 0.55), lastValueVisible: false }, s.pane ?? 0)
      else api = chart.addSeries(LineSeries, { ...common, color, lineWidth: 2, lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: tok.surface(), crosshairMarkerBorderWidth: 2 }, s.pane ?? 0)
      api.setData(s.data.map((d) => ({ time: d.time as Time, value: d.value })))
      api.applyOptions({ visible: !hidden.has(s.id) })
      apis.set(s.id, api)
    }
    // доли высоты, а не пиксели: setHeight до первого замера autoSize перетирается, и нижние панели сжимаются в полоску
    if (paneHeights) {
      const panes = chart.panes()
      paneHeights.forEach((h, i) => panes[i]?.setStretchFactor(h))
    }
    chart.timeScale().fitContent()

    const tip = tipRef.current
    const handler = (p: MouseEventParams) => {
      if (!tip) return
      if (!p.time || !p.point) { tip.style.display = 'none'; return }
      const rows: string[] = []
      for (const s of series) {
        const api = apis.get(s.id)
        if (!api || hidden.has(s.id)) continue
        const d = p.seriesData.get(api) as { value?: number } | undefined
        if (!d || d.value == null) continue
        const v = s.format ? s.format(d.value) : `${fmt.num(d.value, s.precision ?? 2)}${s.unit ? ' ' + s.unit : ''}`
        rows.push(`<div class="flex justify-between gap-3"><span><i class="inline-block w-3 h-0.5 align-middle mr-1.5 rounded-[1px]" style="background:${colorOf(s.color)}"></i>${esc(s.name)}</span><b class="font-semibold tabular-nums">${esc(v)}</b></div>`)
      }
      if (!rows.length) { tip.style.display = 'none'; return }
      tip.innerHTML = `<div class="text-muted mb-0.5">${fmt.date(String(p.time))}</div>${rows.join('')}`
      tip.style.display = 'block'
      const w = ref.current?.clientWidth ?? 0
      const x = p.point.x + 16 + 180 > w ? p.point.x - 16 - tip.offsetWidth : p.point.x + 16
      tip.style.left = `${Math.max(0, x)}px`
      tip.style.top = `${Math.max(0, p.point.y - 12)}px`
    }
    chart.subscribeCrosshairMove(handler)
    return () => { chart.unsubscribeCrosshairMove(handler); chart.remove(); chartRef.current = null; apis.clear() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, tableView, paneHeights])

  // тема
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: tok.surface() }, textColor: tok.muted() },
      grid: { horzLines: { color: tok.grid() } },
      rightPriceScale: { borderColor: tok.axis() }, timeScale: { borderColor: tok.axis() },
    })
    for (const s of series) {
      const api = apisRef.current.get(s.id)
      if (!api) continue
      const color = colorOf(s.color)
      if (s.kind === 'area') api.applyOptions({ lineColor: color, topColor: withAlpha(color, 0.12), bottomColor: withAlpha(color, 0) } as never)
      else if (s.kind === 'histogram') api.applyOptions({ color: withAlpha(color, 0.55) } as never)
      else api.applyOptions({ color } as never)
    }
  }, [theme, series])

  // видимость серий
  useEffect(() => {
    for (const s of series) apisRef.current.get(s.id)?.applyOptions({ visible: !hidden.has(s.id) })
  }, [hidden, series])

  // пресет периода
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !lastTime) return
    if (range === 'ALL') { chart.timeScale().fitContent(); return }
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range]
    chart.timeScale().setVisibleRange({ from: addMonths(lastTime, -months) as Time, to: lastTime as Time })
  }, [range, lastTime, series, tableView])

  const multi = series.length > 1
  return (
    <div className="chart relative" data-testid={testId}>
      <div className="flex flex-col gap-1.5 mb-2">
        {(title || hint) && <div>{title && <h2 className="text-sm">{title}</h2>}{hint && <div className="text-muted text-xs whitespace-nowrap overflow-hidden text-ellipsis max-md:whitespace-normal">{hint}</div>}</div>}
        <div className="flex items-center justify-between gap-2.5 min-h-7 max-md:flex-wrap max-md:gap-1.5">
          <div className={cn(legend, 'flex-1 min-w-0 overflow-hidden whitespace-nowrap flex-nowrap max-md:flex-[1_1_100%] max-md:overflow-x-auto')} role="group" aria-label="Серии">
            {multi ? series.map((s) => (
              <button key={s.id} className={cn('bg-transparent border-0 px-1 py-0.5 inline-flex items-center gap-1.5 cursor-pointer text-inherit rounded-[4px]', hidden.has(s.id) && 'opacity-40 line-through')} aria-pressed={!hidden.has(s.id)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })}>
                <i className={s.kind === 'histogram' ? legendKeyRect : legendKey} style={{ background: colorOf(s.color) }} />{s.name}
              </button>
            )) : null}
          </div>
          <div className="flex items-center gap-2 flex-none">
            {showPresets && !tableView && (
              <div className={seg} role="group" aria-label="Период">
                {(['1M', '3M', '6M', '1Y', 'ALL'] as RangePreset[]).map((r) => <button key={r} className={cn(segItem, range === r && segItemOn)} onClick={() => setRange(r)}>{r === 'ALL' ? 'Всё' : r === '1Y' ? '1Г' : r.replace('M', 'М')}</button>)}
              </div>
            )}
            <button className={button({ variant: 'ghost', size: 'sm' })} onClick={() => setTableView((v) => !v)} aria-pressed={tableView} data-testid="chart-table-toggle">{tableView ? 'График' : 'Таблица'}</button>
          </div>
        </div>
      </div>
      {tableView ? (
        <TableTwin series={series} maxHeight={height} />
      ) : (
        <div className={cn('w-full relative transition-opacity duration-200', loading && 'opacity-60')} style={{ height }}>
          {series.every((s) => s.data.length === 0) && <div className={cn(empty, 'absolute inset-0 grid place-items-center')}>Нет данных за период</div>}
          <div ref={ref} className="absolute inset-0" />
          <div ref={tipRef} className={chartTooltip} style={{ display: 'none' }} />
        </div>
      )}
    </div>
  )
}

function TableTwin({ series, maxHeight }: { series: TvSeries[]; maxHeight: number }) {
  const times = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.time)))).sort().reverse()
  const maps = series.map((s) => new Map(s.data.map((d) => [d.time, d.value])))
  return (
    <div className={tableWrap} style={{ maxHeight }}>
      <table className={tbl}>
        <thead><tr><th>Дата</th>{series.map((s) => <th key={s.id} className="text-right">{s.name}</th>)}</tr></thead>
        <tbody>
          {times.map((t) => (
            <tr key={t}><td>{fmt.date(t)}</td>{series.map((s, i) => { const v = maps[i].get(t); return <td key={s.id} className="text-right tabular-nums">{v == null ? '—' : s.format ? s.format(v) : fmt.num(v, s.precision ?? 2)}</td> })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Подписи шкалы: больше знаков, чем у compact, чтобы соседние деления не совпадали (1,70 / 1,73 млрд). */
function axisCompact(v: number): string {
  const a = Math.abs(v)
  const f = (x: number, d: number) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })
  if (a >= 1e12) return `${f(v / 1e12, 2)} трлн`
  if (a >= 1e9) return `${f(v / 1e9, 2)} млрд`
  if (a >= 1e6) return `${f(v / 1e6, 1)} млн`
  return `${f(v / 1e3, 0)} тыс.`
}
