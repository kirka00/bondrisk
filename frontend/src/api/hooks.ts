import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Adv01Row, Bond, BondMetrics, Breach, CashAccount, ClosedRow, CurrencyRow, Curve, EodResponse, Freshness, FxAnalytics, FxPositionRow, PnlAttrRow, Limit, LimitFact, LimitInput,
  Me, Page, PnlRow, Portfolio, PositionsResponse, Preview, PriceGapRow, PricePoint, RatingMigrationRow, RatingRow,
  RiskResponse, ScheduleRow, SpreadsResponse, StressRow, Trade, TradeInput, User, Wall,
} from './types'

const keep = { placeholderData: keepPreviousData } as const
/** Показывать прежние данные во время загрузки только в пределах того же портфеля: иначе под заголовком нового
 *  портфеля секунду видны цифры старого. Портфель — второй элемент ключа запроса. */
const keepFor = (pid: number | null | undefined) =>
  ({ placeholderData: <T,>(prev: T | undefined, q?: { queryKey: readonly unknown[] }) => (q && q.queryKey[1] === pid ? prev : undefined) }) as const

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/users/me'), staleTime: Infinity })
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users'), staleTime: Infinity })
/** Актуальность данных; опрос раз в 5 минут — автообновление на сервере подтягивает новые дни само. */
export const useFreshness = () =>
  useQuery({ queryKey: ['freshness'], queryFn: () => api.get<Freshness>('/market/freshness'), staleTime: 60_000, refetchInterval: 300_000 })
/** Дата последних рыночных данных: последний день, на который есть и котировки MOEX, и кривая КБД. */
export const useDataEnd = () => {
  const q = useFreshness()
  return { ...q, data: q.data?.data_as_of ?? undefined }
}
export const usePortfolios = () => useQuery({ queryKey: ['portfolios'], queryFn: () => api.get<Page<Portfolio>>('/portfolios'), staleTime: 60_000, select: (p) => p.items })

// holdings — про-форма: состав на эту дату (дата формирования портфеля), рынок на asOf
export const usePositions = (pid: number | null, asOf?: string, holdings?: string) =>
  useQuery({ queryKey: ['positions', pid, asOf, holdings], queryFn: () => api.get<PositionsResponse>(`/portfolios/${pid}/positions`, { as_of: asOf, holdings_date: holdings }), enabled: !!pid, ...keepFor(pid) })
export const useRisk = (pid: number | null) =>
  useQuery({ queryKey: ['risk', pid], queryFn: () => api.get<RiskResponse>(`/portfolios/${pid}/risk`, { days: 1100 }), enabled: !!pid, ...keepFor(pid) })
export const useLimitFacts = (pid: number | null, asOf?: string, holdings?: string) =>
  useQuery({ queryKey: ['limit-facts', pid, asOf, holdings], queryFn: () => api.get<LimitFact[]>(`/portfolios/${pid}/limits`, { as_of: asOf, holdings_date: holdings }), enabled: !!pid, ...keepFor(pid) })
export const useCash = (pid: number | null) =>
  useQuery({ queryKey: ['cash', pid], queryFn: () => api.get<CashAccount[]>(`/portfolios/${pid}/cash`), enabled: !!pid, ...keepFor(pid) })
export const useStress = (pid: number | null, asOf?: string, holdings?: string) =>
  useQuery({ queryKey: ['stress', pid, asOf, holdings], queryFn: () => api.get<StressRow[]>('/reports/stress', { portfolio_id: pid, as_of: asOf, holdings_date: holdings }), enabled: !!pid, ...keepFor(pid) })
export const useAdv01 = (pid: number | null, asOf?: string) =>
  useQuery({ queryKey: ['adv01', pid, asOf], queryFn: () => api.get<Adv01Row[]>('/reports/adv01', { portfolio_id: pid, as_of: asOf }), enabled: !!pid, ...keepFor(pid) })
export const useSpreads = (pid: number | null, asOf?: string) =>
  useQuery({ queryKey: ['spreads', pid, asOf], queryFn: () => api.get<SpreadsResponse>('/reports/spreads', { portfolio_id: pid, as_of: asOf }), enabled: !!pid, ...keepFor(pid) })
export const useWall = (pid: number | null, asOf?: string, months = 18) =>
  useQuery({ queryKey: ['wall', pid, asOf, months], queryFn: () => api.get<Wall>('/reports/reinvestment-wall', { portfolio_id: pid, as_of: asOf, months }), enabled: !!pid, ...keepFor(pid) })
export const usePnlAttribution = (pid: number | null, from: string | undefined, to: string | undefined, bucket: 'day' | 'week' | 'month') =>
  useQuery({ queryKey: ['pnl-attr', pid, from, to, bucket], queryFn: () => api.get<PnlAttrRow[]>('/reports/pnl-attribution', { portfolio_id: pid, date_from: from, date_to: to, bucket }), enabled: !!pid && !!from, ...keepFor(pid) })
export const useClosedPositions = (pid: number | null, from: string | undefined, to: string | undefined) =>
  useQuery({ queryKey: ['closed', pid, from, to], queryFn: () => api.get<ClosedRow[]>('/reports/closed-positions', { portfolio_id: pid, date_from: from, date_to: to }), enabled: !!pid && !!from, ...keepFor(pid) })
export const useByCurrency = (pid: number | null, asOf?: string) =>
  useQuery({ queryKey: ['by-currency', pid, asOf], queryFn: () => api.get<CurrencyRow[]>('/reports/by-currency', { portfolio_id: pid, as_of: asOf }), enabled: !!pid, ...keepFor(pid) })
export const useFxPosition = (pid: number | null, asOf?: string) =>
  useQuery({ queryKey: ['fx-position', pid, asOf], queryFn: () => api.get<FxPositionRow[]>('/reports/fx-position', { portfolio_id: pid, as_of: asOf }), enabled: !!pid, ...keepFor(pid) })
export const useFxAnalytics = (pid: number | null, asOf: string | undefined, horizon: number) =>
  useQuery({ queryKey: ['fx-analytics', pid, asOf, horizon], queryFn: () => api.get<FxAnalytics>('/reports/fx-analytics', { portfolio_id: pid, as_of: asOf, horizon_years: horizon }), enabled: !!pid, ...keepFor(pid) })
export const usePnl = (pid: number | null, asOf?: string) =>
  useQuery({ queryKey: ['pnl', pid, asOf], queryFn: () => api.get<PnlRow[]>('/reports/pnl', { portfolio_id: pid, as_of: asOf }), enabled: !!pid, ...keepFor(pid) })
export const usePriceGaps = (asOf?: string) =>
  useQuery({ queryKey: ['gaps', asOf], queryFn: () => api.get<PriceGapRow[]>('/reports/price-gaps', { as_of: asOf }), ...keep })
export const useRatingMigrations = (issuerId: number | null, limit = 200) =>
  useQuery({ queryKey: ['migrations', issuerId, limit], queryFn: () => api.get<RatingMigrationRow[]>('/reports/rating-migrations', { issuer_id: issuerId, limit }), ...keep })
export const useCurve = (asOf?: string) =>
  useQuery({ queryKey: ['curve', asOf], queryFn: () => api.get<Curve>('/market/curve', { as_of: asOf }), ...keep })

export interface BondsQuery { q?: string; issuer_id?: number; currency?: string; coupon_type?: string; status?: string; limit: number; offset: number; sort?: string; order?: string }
export const useBonds = (q: BondsQuery, enabled = true) =>
  useQuery({ queryKey: ['bonds', q], queryFn: () => api.get<Page<Bond>>('/bonds', { ...q }), enabled, ...keep })
export const useBond = (id: number | null) => useQuery({ queryKey: ['bond', id], queryFn: () => api.get<Bond>(`/bonds/${id}`), enabled: !!id })
export const useBondMetrics = (id: number | null, asOf?: string) =>
  useQuery({ queryKey: ['bond-metrics', id, asOf], queryFn: () => api.get<BondMetrics>(`/bonds/${id}/metrics`, { as_of: asOf }), enabled: !!id, ...keepFor(id) })
export const useBondPrices = (id: number | null, from: string, to: string, bucket: 'day' | 'week' | 'month') =>
  useQuery({ queryKey: ['bond-prices', id, from, to, bucket], queryFn: () => api.get<PricePoint[]>(`/bonds/${id}/prices`, { date_from: from, date_to: to, bucket }), enabled: !!id, ...keepFor(id) })
export const useSchedule = (id: number | null) => useQuery({ queryKey: ['schedule', id], queryFn: () => api.get<ScheduleRow[]>(`/bonds/${id}/schedule`), enabled: !!id })
export const useBondRatings = (id: number | null) => useQuery({ queryKey: ['bond-ratings', id], queryFn: () => api.get<RatingRow[]>(`/bonds/${id}/ratings`), enabled: !!id })

export interface TradesQuery { bond_id?: number; side?: string; date_from?: string; date_to?: string; limit: number; offset: number; sort?: string; order?: string }
export const useTrades = (pid: number | null, q: TradesQuery) =>
  useQuery({ queryKey: ['trades', pid, q], queryFn: () => api.get<Page<Trade>>(`/portfolios/${pid}/trades`, { ...q }), enabled: !!pid, ...keepFor(pid) })

export const useLimits = (pid: number | null) =>
  useQuery({ queryKey: ['limits', pid], queryFn: () => api.get<Page<Limit>>('/limits', { portfolio_id: pid, limit: 200 }), enabled: !!pid, select: (p) => p.items, ...keepFor(pid) })
export interface BreachesQuery { portfolio_id?: number; status?: string; date_from?: string; date_to?: string; limit: number; offset: number }
export const useBreaches = (q: BreachesQuery) =>
  useQuery({ queryKey: ['breaches', q], queryFn: () => api.get<Page<Breach>>('/breaches', { ...q }),
    placeholderData: (prev, pq) => ((pq?.queryKey[1] as BreachesQuery | undefined)?.portfolio_id === q.portfolio_id ? prev : undefined) })

/**
 * Инвалидация всего, что зависит от портфеля. Запросы, начатые до мутации, сначала отменяются:
 * иначе invalidate переиспользует ещё идущий запрос и в кэш попадают данные без только что сохранённого.
 */
function usePortfolioInvalidate() {
  const qc = useQueryClient()
  return async () => {
    const keys = ['positions', 'risk', 'limit-facts', 'cash', 'stress', 'adv01', 'spreads', 'wall', 'pnl', 'trades', 'limits', 'breaches', 'portfolios']
    await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: [k] })))
    await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }
}

export function useExecuteTrade(pid: number | null) {
  const inv = usePortfolioInvalidate()
  return useMutation({ mutationFn: (body: TradeInput) => api.post<Trade>(`/portfolios/${pid}/trades`, body), onSuccess: inv })
}
export function usePreviewTrade(pid: number | null) {
  return useMutation({ mutationFn: (body: { bond_id: number; side: string; qty: number; as_of?: string; clean_price_pct?: number; settlement_days?: number; settlement_date?: string }) => api.post<Preview>(`/portfolios/${pid}/trades/preview`, body) })
}
export function useRunEod(pid: number | null) {
  const inv = usePortfolioInvalidate()
  return useMutation({ mutationFn: (p: { asOf: string; holdings?: string }) => api.post<EodResponse>(`/portfolios/${pid}/eod`, {}, { as_of: p.asOf, holdings_date: p.holdings }), onSuccess: inv })
}
export function useDeposit(pid: number | null) {
  const inv = usePortfolioInvalidate()
  return useMutation({ mutationFn: (b: { currency: string; amount: number; note?: string }) => api.post<CashAccount[]>(`/portfolios/${pid}/cash/deposit`, b), onSuccess: inv })
}
export function useWaive() {
  const inv = usePortfolioInvalidate()
  return useMutation({ mutationFn: (p: { id: number; reason: string }) => api.post<Breach>(`/breaches/${p.id}/waive`, { reason: p.reason }), onSuccess: inv })
}
export function useSaveLimit() {
  const inv = usePortfolioInvalidate()
  return useMutation({
    mutationFn: (p: { id?: number; body: LimitInput }) => (p.id ? api.patch<Limit>(`/limits/${p.id}`, p.body) : api.post<Limit>('/limits', p.body)),
    onSuccess: inv,
  })
}
export function useDeleteLimit() {
  const inv = usePortfolioInvalidate()
  return useMutation({ mutationFn: (id: number) => api.delete<void>(`/limits/${id}`), onSuccess: inv })
}
