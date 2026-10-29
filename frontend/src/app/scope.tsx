/** Глобальная область: портфель, дата оценки, пользователь — в URL и localStorage. */
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { USER_KEY } from '../api/client'
import { useDataEnd, useFreshness, useMe, usePortfolios, useUsers } from '../api/hooks'
import type { Portfolio, User } from '../api/types'

interface Scope {
  portfolios: Portfolio[]
  portfolio: Portfolio | null
  portfolioId: number | null
  setPortfolio: (code: string) => void
  asOf: string | undefined          // явная дата из URL или дата последних рыночных данных
  asOfExplicit: string | undefined
  dataEnd: string | undefined       // дата последней котировки / кривой
  setAsOf: (d: string | undefined) => void
  /** дата состава для про-формы: задана, если дата оценки раньше первой сделки портфеля */
  holdings: string | undefined
  users: User[]
  user: User | null
  /** пользователь задан входом на сервере — переключателя нет */
  userFixed: boolean
  setUser: (id: number) => void
  isRiskManager: boolean
  canTrade: boolean
}

const Ctx = createContext<Scope | null>(null)
const PF_KEY = 'bondrisk.portfolio'
/** Портфель по умолчанию — репликант индекса корпоративных облигаций (настоящая история с 2024 г.). */
const DEFAULT_PF = 'RUCB'

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams()
  const { data: portfolios = [] } = usePortfolios()
  const { data: users = [] } = useUsers()
  const { data: me } = useMe()
  const { data: dataEnd } = useDataEnd()
  // сервер догрузил новые данные (сервис scheduler) — открытая страница перечитывает всё без перезагрузки
  const updatedAt = useFreshness().data?.updated_at
  const qc = useQueryClient()
  const seen = useRef(updatedAt)
  useEffect(() => {
    if (updatedAt && seen.current && updatedAt !== seen.current) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'freshness' })
    seen.current = updatedAt
  }, [updatedAt, qc])

  const code = sp.get('portfolio') ?? (() => { try { return localStorage.getItem(PF_KEY) } catch { return null } })() ?? DEFAULT_PF
  const portfolio = useMemo(() => portfolios.find((p) => p.code === code) ?? portfolios.find((p) => p.code === DEFAULT_PF) ?? portfolios[0] ?? null, [portfolios, code])
  const portfolioId = portfolio?.portfolio_id ?? null
  const asOfExplicit = sp.get('as_of') ?? undefined
  const asOf = asOfExplicit ?? dataEnd
  const inception = portfolio?.inception_date ?? undefined
  const holdings = inception && asOf && asOf < inception ? inception : undefined

  const userIdParam = Number(sp.get('user') ?? '') || null
  const userId = userIdParam ?? (() => { try { return Number(localStorage.getItem(USER_KEY)) || 1 } catch { return 1 } })()
  const user = me?.fixed ? me : users.find((u) => u.user_id === userId) ?? users.find((u) => u.user_id === 1) ?? null
  useEffect(() => { try { localStorage.setItem(USER_KEY, String(userId)) } catch { /* ignore */ } }, [userId])
  useEffect(() => { if (portfolio) try { localStorage.setItem(PF_KEY, portfolio.code) } catch { /* ignore */ } }, [portfolio])

  const update = useCallback((patch: Record<string, string | undefined>) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') next.delete(k); else next.set(k, v) }
      return next
    }, { replace: true })
  }, [setSp])

  const value: Scope = {
    portfolios, portfolio, portfolioId,
    setPortfolio: (c) => update({ portfolio: c }),
    asOf, asOfExplicit, dataEnd,
    setAsOf: (d) => update({ as_of: d && d !== dataEnd ? d : undefined }),
    holdings,
    users, user, userFixed: !!me?.fixed,
    setUser: (id) => { try { localStorage.setItem(USER_KEY, String(id)) } catch { /* ignore */ } update({ user: String(id) }) },
    isRiskManager: user?.role === 'risk_manager' || user?.role === 'admin',
    canTrade: user?.role === 'trader' || user?.role === 'admin',
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useScope(): Scope {
  const v = useContext(Ctx)
  if (!v) throw new Error('ScopeProvider missing')
  return v
}
