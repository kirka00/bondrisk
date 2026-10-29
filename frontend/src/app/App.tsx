import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from '../components/layout/BottomNav'
import { Footer } from '../components/layout/Footer'
import { FilterBar } from '../components/layout/FilterBar'
import { Header } from '../components/layout/Header'
import { ProformaBanner } from '../components/layout/ProformaBanner'
import { ToastProvider } from '../components/ui/Toast'
import { TooltipProvider } from '../components/ui/Tooltip'
import { BondPage } from '../features/bonds/BondPage'
import { BondsPage } from '../features/bonds/BondsPage'
import { OverviewPage } from '../features/overview/OverviewPage'
import { PositionsPage } from '../features/positions/PositionsPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { RiskPage } from '../features/risk/RiskPage'
import { useScope } from './scope'
import { TradesPage } from '../features/trades/TradesPage'
import { ScopeProvider } from './scope'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <TooltipProvider>
          <ToastProvider>
            <ScopeProvider>
              <div className="min-h-full flex flex-col">
                <Header />
                <FilterBar />
                <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 pt-5 pb-10 max-md:px-4 max-md:pt-3.5 max-md:pb-[calc(72px+env(safe-area-inset-bottom))]">
                  <ProformaBanner />
                  <ScopedRoutes>
                    <Route path="/" element={<OverviewPage />} />
                    <Route path="/positions" element={<PositionsPage />} />
                    <Route path="/bonds" element={<BondsPage />} />
                    <Route path="/bonds/:id" element={<BondPage />} />
                    <Route path="/trades" element={<TradesPage />} />
                    <Route path="/risk" element={<RiskPage />} />
                    <Route path="/limits" element={<KeepSearch to="/risk" />} />
                    <Route path="/breaches" element={<KeepSearch to="/risk" hash="breaches" />} />
                    <Route path="/reports" element={<ReportsPage />} />
                  </ScopedRoutes>
                </main>
                <Footer />
                <BottomNav />
              </div>
            </ScopeProvider>
          </ToastProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

/** Старые адреса (/limits, /breaches) ведут в раздел «Лимиты» с теми же параметрами. */
function KeepSearch({ to, hash }: { to: string; hash?: string }) {
  const loc = useLocation()
  return <Navigate to={{ pathname: to, search: loc.search, hash }} replace />
}

/**
 * Смена портфеля пересоздаёт страницу: фильтры, номер страницы таблицы и открытые диалоги относятся
 * к прежнему портфелю. Первая загрузка списка портфелей (пусто → портфель по умолчанию) сменой не считается — иначе
 * страница монтировалась бы дважды и теряла одноразовые параметры адреса (new_trade).
 */
function ScopedRoutes({ children }: { children: ReactNode }) {
  const code = useScope().portfolio?.code
  const [state, setState] = useState<{ code?: string; gen: number }>({ code, gen: 0 })
  if (code && code !== state.code) setState({ code, gen: state.code ? state.gen + 1 : state.gen })
  return <Routes key={state.gen}>{children}</Routes>
}
