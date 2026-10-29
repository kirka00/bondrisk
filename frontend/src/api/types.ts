export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface ApiErrorBody { detail: string; code?: string; retryable?: boolean }

export type UserRole = 'trader' | 'risk_manager' | 'viewer' | 'admin'
export interface User { user_id: number; login: string; full_name: string; role: UserRole; is_active: boolean }
/** fixed — пользователь задан входом на сервере (логин и пароль), переключать его нельзя */
export interface Me extends User { fixed: boolean }

export type CouponType = 'fixed' | 'floating' | 'zero'
export type RatingSource = 'issue' | 'issuer' | 'sovereign' | 'none'

export interface Issuer {
  issuer_id: number; name: string; short_name: string | null; inn: string | null; sector: string
  country: string; is_sovereign: boolean; bonds_count?: number
}
export interface Bond {
  bond_id: number; isin: string; secid: string; short_name: string; full_name: string | null
  issuer_id: number; issuer_name: string; sector: string; is_sovereign: boolean; currency: string
  face_value_initial: number; coupon_type: CouponType; coupon_rate_pct: number | null; coupon_freq: number
  issue_date: string | null; maturity_date: string; offer_date: string | null; is_amortizing: boolean
  board: string; list_level: number | null; status: string
  rating_grade: string | null; rating_source: RatingSource | null; rating_agency: string | null
  last_price_pct: number | null; last_price_date: string | null
}
export interface ScheduleRow {
  flow_id: number; flow_type: 'coupon' | 'amortization' | 'redemption' | 'offer'
  period_start: string | null; period_end: string | null; pay_date: string
  rate_pct: number | null; amount: number | null; face_value_after: number | null; source: string
}
export interface BondMetrics {
  bond_id: number; as_of: string
  clean_price_pct: number | null; price_date: string | null; accrued_interest: number | null; face_current: number | null
  dirty_price: number | null; ytm_pct: number | null; current_yield_pct: number | null
  duration_mac: number | null; duration_mod: number | null; convexity: number | null; dv01_local: number | null
  curve_rate_pct: number | null; g_spread_bp: number | null
  rating: { grade: string; source: RatingSource; agency: string | null }
}
export interface PricePoint { ts: string; close_pct: number | null; yield_close: number | null; volume?: number | null; trading_days?: number }
export interface RatingRow {
  rating_id: number; agency: string; agency_name: string; scope: 'issue' | 'issuer'; grade: string
  outlook: string | null; action: string; assigned_on: string; status: string; source: string
}
export interface FreshnessSource { key: string; name: string; as_of?: string | null; lag_days?: number | null; loaded_at?: string | null }
export interface Freshness {
  status: 'fresh' | 'late' | 'stale' | 'unknown'
  data_as_of: string | null; expected_as_of: string; updated_at: string | null; last_update_errors: number | null
  sources: FreshnessSource[]
}
export interface Curve { as_of: string; curve_date: string | null; points: { tenor_years: number; rate_pct: number }[] }

export interface Portfolio {
  portfolio_id: number; code: string; name: string; base_currency: string; manager_id: number
  manager_name?: string; allow_short: boolean; status: 'active' | 'closed'; positions_count?: number
  /** дата первой сделки: раньше неё портфель показывается про-формой текущего состава */
  inception_date: string | null
}
export interface Position {
  bond_id: number; isin: string; short_name: string; issuer_id: number; issuer_name: string; sector: string
  currency: string; coupon_type: CouponType; is_sovereign: boolean; qty: number
  clean_price_pct: number | null; price_date: string | null; accrued_interest: number | null; face_current: number | null
  fx_rate: number | null; mv_local: number | null; mv_rub: number | null; ytm_pct: number | null; current_yield_pct: number | null
  duration_mac: number | null; duration_mod: number | null; convexity: number | null
  dv01_rub: number | null; cs01_rub: number | null; g_spread_bp: number | null
  rating_grade: string; rating_score: number | null; rating_source: RatingSource; adv01_bucket: string; adv01_coef: number
  weight_pct: number | null
  /** §3: close — закрытие D, last — последняя котировка в окне 90 дней, cost — средняя цена покупки, override — ручная корректировка */
  price_source: 'close' | 'last' | 'cost' | 'override'; ytm_source: 'market' | 'calc'
  dm_bp: number | null; z_spread_bp: number | null; dv01_local: number | null; avg_cost_pct: number | null
}
export interface Totals {
  mv_net: number; mv_gross: number; cash_total_rub: number; dv01: number; cs01: number; adv01: number
  duration_mac: number | null; duration_mod: number | null; convexity: number | null
  ytm_avg: number | null; current_yield_avg: number | null; g_spread_avg_bp: number | null
  var_99_1d: number; rating_score: number | null; rating_grade: string | null; positions_count: number
  dm_avg_bp: number | null; floater_share_pct: number | null
}
export interface PositionsResponse { as_of: string; holdings_date: string | null; items: Position[]; totals: Totals }
export interface RiskSnapshot extends Totals { as_of: string; portfolio_id: number; computed_at?: string; is_proforma?: boolean }
export interface RiskResponse { portfolio_id: number; latest: RiskSnapshot | null; history: RiskSnapshot[] }
export interface CashAccount { cash_account_id: number; currency: string; balance: number; allow_overdraft: boolean }

export type LimitMetric = 'dv01' | 'duration' | 'var_99' | 'mv_gross' | 'conc_issuer' | 'conc_sector' | 'conc_issue' | 'conc_portfolio'
  | 'short_mv' | 'below_aaa_mv' | 'fx_mv' | 'credit_spread' | 'new_issuer_rating'
export type LimitBasis = 'cost' | 'market' | 'max'
export type LimitSide = 'long' | 'short' | 'both'
export type LimitStatus = 'ok' | 'warning' | 'breach' | 'waived' | 'n/a'
export interface LimitFact {
  limit_id: number; metric: LimitMetric; scope: string | null; side: LimitSide; is_hard: boolean
  fact_value: number | null; limit_value: number | null; utilization_pct: number | null; warning_pct: number; status: LimitStatus
  /** §16.2: рыночная величина рядом с фактом по базе оценки; доля в объёме эмиссии */
  fact_market: number | null; basis: LimitBasis; share_fact_pct: number | null; share_limit_pct: number | null; committee: 'IC' | 'RC' | null
}
export interface Limit {
  limit_id: number; portfolio_id: number; portfolio_code?: string; metric: LimitMetric
  scope_issuer_id: number | null; scope_bond_id: number | null; scope_sector: string | null; scope?: string | null
  side: LimitSide; threshold_abs: number | null; threshold_pct: number | null; warning_pct: number
  is_hard: boolean; valid_from: string; valid_to: string | null
  basis: LimitBasis; pct_base: 'gross' | 'total_limit'; emission_share_pct: number | null; scope_name: string | null
  committee: 'IC' | 'RC' | null; self_adjust_pct: number | null; min_grade: string | null
}
export interface LimitInput {
  portfolio_id: number; metric: LimitMetric; scope_issuer_id?: number | null; scope_bond_id?: number | null
  scope_sector?: string | null; side?: LimitSide; threshold_abs?: number | null; threshold_pct?: number | null
  warning_pct?: number; is_hard?: boolean; valid_from?: string; valid_to?: string | null
  basis?: LimitBasis; pct_base?: 'gross' | 'total_limit'; emission_share_pct?: number | null; scope_name?: string | null
  committee?: 'IC' | 'RC' | null; self_adjust_pct?: number | null; min_grade?: string | null
}
export interface Breach {
  breach_id: number; limit_id: number; portfolio_id: number; portfolio_code: string; metric: LimitMetric
  side: LimitSide; is_hard: boolean; scope: string | null; as_of: string; fact_value: number; limit_value: number
  utilization_pct: number; status: 'warning' | 'breach' | 'waived'
  waived_by: number | null; waived_by_name: string | null; waived_at: string | null; waive_reason: string | null
}
export interface EodResponse { portfolio_id: number; as_of: string; snapshot: RiskSnapshot | null; breaches: (Breach & Record<string, unknown>)[] }

export type TradeSide = 'buy' | 'sell'
export interface Trade {
  trade_id: number; portfolio_id: number; portfolio_code: string; bond_id: number; isin: string; short_name: string
  issuer_name: string; currency: string; trade_date: string; trade_ts: string; settlement_date: string; side: TradeSide
  qty: number; clean_price_pct: number; accrued_interest: number; amount: number; fee: number; counterparty: string | null
  status: string; created_by_login: string | null; created_at: string
}
export interface TradeInput {
  bond_id: number; side: TradeSide; qty: number; clean_price_pct: number; trade_date?: string
  settlement_days?: number; fee?: number; counterparty?: string | null; check_limits?: boolean
}
export interface PreviewMetric { metric: string; before: number | null; after: number | null }
export interface PreviewLimit {
  limit_id: number; metric: string; scope: string | null; before: number | null; after: number | null
  limit_value: number | null; utilization_before: number | null; utilization_after: number | null
  status_after: LimitStatus; is_hard: boolean
  /** сделка будет отклонена из-за этого лимита (доводит до нарушения или углубляет его) */
  blocks: boolean
}
export interface Preview {
  metrics: PreviewMetric[]; limits: PreviewLimit[]; blocked: boolean
  /** §20.1: дата расчётов, перенос ручной даты с выходного, цена и НКД на дату расчётов, сумма сделки */
  settlement_date: string; settlement_shifted_from: string | null; price_pct: number | null
  accrued_at_settlement: number | null; amount_rub: number | null
}

export interface StressRow {
  code: string; name: string; kind: 'parallel' | 'twist' | 'fx' | 'fx_hist' | 'ofz_index' | 'equity_index'
  pnl_rub: number | null; pnl_pct_of_mv: number | null
  episode: string | null; horizon_days: number | null; date_from: string | null; date_to: string | null; change_pct: number | null
  severity: 'ok' | 'warning' | 'critical'
}
export interface CurrencyRow {
  currency: string; positions: number; floaters: number; mv_local: number; mv_net_rub: number; mv_gross_rub: number
  dv01_local: number; dv01_rub: number; duration_mac: number | null; ytm_fixed_avg_pct: number | null; fx_rate: number | null
  portfolio_value_in_currency: number | null
}
export interface PnlAttrRow { period: string; price_pnl: number | null; trading_pnl: number | null; coupon_pnl: number | null; fx_pnl: number | null; fees: number; total: number; flow_days: number }
export interface ClosedRow { bond_id: number; isin: string; short_name: string; currency: string; bought_rub: number; sold_rub: number; coupons_rub: number; fees_rub: number; result_rub: number; closed_on: string }
export interface FxPositionRow {
  currency: string; bonds_local: number; cash_local: number; futures_local: number; position_local: number; position_rub: number
  fx_today: number | null; fx_prev: number | null; revaluation_rub: number | null; share_pct: number | null
}
export interface FxAnalytics {
  breakeven: { bond_id: number; isin: string; short_name: string; currency: string; qty: number; price_purchase_pct: number; price_now_pct: number; fx_purchase: number; fx_now: number; fx_breakeven: number; distance_pct: number }[]
  scenarios: { currency: string; ytm_pct: number; rub_rate_pct: number; horizon_years: number; fx_change_pct: number; rub_return_pct: number; breakeven_fx_change_pct: number }[]
  carry: { ytm_cny_pct: number; rusfar_cny_pct: number | null; rusfar_date: string | null; carry_pct: number | null } | null
}
export interface Adv01Row {
  bucket: string; coef: number; positions: number; issuer_level_ratings: number; dv01_long: number; dv01_short: number
  net_dv01: number; adv01: number; mv_rub: number; mv_share_pct: number; adv01_total: number
}
export interface SpreadRow {
  bond_id: number; isin: string; short_name: string; currency: string; rating_grade: string | null; ytm_pct: number | null
  curve_rate_pct: number | null; g_spread_bp: number | null; mv_rub: number | null; included: boolean; exclusion_reason: string | null
}
export interface SpreadsResponse { avg_spread_bp: number | null; items: SpreadRow[] }
export interface WallItem { month: string; mv_rub: number; positions: number; bonds: string; cumulative_rub: number; cumulative_pct: number; share_pct: number }
export interface Wall { months: number; share_pct: number; items: WallItem[] }
export interface PnlRow {
  bond_id: number; isin: string; short_name: string; currency: string; qty: number; avg_price: number | null; price: number | null
  price_date: string | null; ai: number | null; fx: number | null; price_pnl_local: number | null; accrued_local: number | null
  unrealized_rub: number | null; return_pct: number | null; rank_best: number; rank_worst: number; quartile: number
}
export interface PriceGapRow { bond_id: number; isin: string; short_name: string; maturity_date: string; last_price_date: string | null; last_close_pct: number | null; days_stale: number | null; fallback: string }
export interface RatingMigrationRow {
  rating_id: number; agency: string; issuer_id: number | null; issuer_name: string; bond_id: number | null; bond_name: string | null
  scope: 'issue' | 'issuer'; grade: string; prev_grade: string | null; outlook: string | null; action: string; assigned_on: string
  prev_date: string | null; status: string; source: string; migration: string; notches: number | null; days_since_prev: number | null
}
