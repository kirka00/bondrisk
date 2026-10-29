import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import type { Bond, Page } from '../../api/types'
import { useScope } from '../../app/scope'
import { Button } from '../../components/ui/Button'
import { Section } from '../../components/ui/Card'
import { Combobox, type ComboItem } from '../../components/ui/Combobox'
import { ErrorBanner } from '../../components/ui/Misc'
import { Segmented } from '../../components/ui/Segmented'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { fmt, parseNum } from '../../lib/format'
import { cn, field, input, tableWrap, tableWrapFlat, tbl } from '../../lib/ui'

interface Override { bond_id: number; secid: string; short_name: string; as_of: string; clean_price_pct: number | null; accrued_interest: number | null; face_value: number | null; reason: string }
interface CashAdj { adjustment_id: number; currency: string; as_of: string | null; target_balance: number | null; shift: number | null; reason: string }
interface Synonym { kind: 'issuer' | 'sector'; alias: string; canonical: string }

/** Ручные корректировки риск-менеджмента (§2, §3, §19) и синонимы книги лимитов (§16.2). */
export function CorrectionsSection() {
  const { portfolioId, isRiskManager } = useScope()
  const qc = useQueryClient()
  const toast = useToast()
  const done = (msg: string) => { qc.invalidateQueries(); toast(msg, 'success') }
  const ov = useQuery({ queryKey: ['overrides'], queryFn: () => api.get<Override[]>('/price-overrides') })
  const ca = useQuery({ queryKey: ['cash-adj', portfolioId], queryFn: () => api.get<CashAdj[]>(`/portfolios/${portfolioId}/cash-adjustments`), enabled: !!portfolioId })
  const sy = useQuery({ queryKey: ['synonyms'], queryFn: () => api.get<Synonym[]>('/synonyms') })

  const [bond, setBond] = useState<ComboItem | null>(null)
  const [oDate, setODate] = useState(''); const [oPx, setOPx] = useState(''); const [oAi, setOAi] = useState(''); const [oFace, setOFace] = useState(''); const [oWhy, setOWhy] = useState('')
  const addOv = useMutation({ mutationFn: () => api.post('/price-overrides', { bond_id: bond!.id, as_of: oDate, clean_price_pct: oPx.trim() ? parseNum(oPx) : null, accrued_interest: oAi.trim() ? parseNum(oAi) : null, face_value: oFace.trim() ? parseNum(oFace) : null, reason: oWhy }), onSuccess: () => { done('Корректировка среза сохранена'); setOPx(''); setOAi(''); setOFace(''); setOWhy('') } })
  const delOv = useMutation({ mutationFn: (o: Override) => api.delete(`/price-overrides/${o.bond_id}/${o.as_of}`), onSuccess: () => done('Корректировка снята') })

  const [cCur, setCCur] = useState('RUB'); const [cKind, setCKind] = useState<'target' | 'shift'>('target'); const [cDate, setCDate] = useState(''); const [cAmt, setCAmt] = useState(''); const [cWhy, setCWhy] = useState('')
  const addCa = useMutation({ mutationFn: () => api.post(`/portfolios/${portfolioId}/cash-adjustments`, cKind === 'target' ? { currency: cCur, as_of: cDate, target_balance: parseNum(cAmt), reason: cWhy } : { currency: cCur, shift: parseNum(cAmt), reason: cWhy }), onSuccess: () => { done('Корректировка кассы сохранена'); setCAmt(''); setCWhy('') } })
  const delCa = useMutation({ mutationFn: (id: number) => api.delete(`/cash-adjustments/${id}`), onSuccess: () => done('Корректировка кассы снята') })

  const [sKind, setSKind] = useState<'issuer' | 'sector'>('issuer'); const [sAlias, setSAlias] = useState(''); const [sCanon, setSCanon] = useState('')
  const addSy = useMutation({ mutationFn: () => api.post('/synonyms', { kind: sKind, alias: sAlias, canonical: sCanon }), onSuccess: () => { done('Синоним добавлен'); setSAlias(''); setSCanon('') } })
  const delSy = useMutation({ mutationFn: (s: Synonym) => api.delete(`/synonyms/${s.kind}/${encodeURIComponent(s.alias)}`), onSuccess: () => done('Синоним удалён') })

  const search = (q: string) => api.get<Page<Bond>>('/bonds', { q: q || undefined, limit: 12 }).then((p) => p.items.map((b) => ({ id: b.bond_id, label: b.short_name, sub: b.isin })))
  const err = addOv.error ?? delOv.error ?? addCa.error ?? delCa.error ?? addSy.error ?? delSy.error
  const row = 'grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 items-end mt-2'
  return (
    <Section title="Ручные корректировки" hint="для исторических срезов: цена, НКД и номинал бумаги, уровень кассы; синонимы эмитентов и отраслей книги лимитов · изменения журналируются" id="corrections">
      <ErrorBanner error={err} />
      <div className="grid gap-4 grid-cols-3 max-lg:grid-cols-1">
        <div>
          <h3 className="text-sm">Срезы: цена, НКД, номинал</h3>
          <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 220 }}><table className={tbl}><thead><tr><th>Бумага</th><th>Дата</th><th className="text-right">Цена / НКД / номинал</th><th></th></tr></thead>
            <tbody>{(ov.data ?? []).map((o) => <tr key={`${o.bond_id}-${o.as_of}`} title={o.reason}><td>{o.short_name}</td><td>{fmt.date(o.as_of)}</td><td className="text-right tabular-nums">{fmt.num(o.clean_price_pct)} / {fmt.num(o.accrued_interest)} / {fmt.num(o.face_value)}</td><td>{isRiskManager && <Button size="sm" variant="ghost" onClick={() => delOv.mutate(o)}>снять</Button>}</td></tr>)}
              {!ov.data?.length && <tr><td colSpan={4} className="text-muted">корректировок нет</td></tr>}</tbody></table></div>
          {isRiskManager && <div className={row}>
            <label className={field}><span>Бумага</span><Combobox value={bond} onChange={setBond} search={search} placeholder="ISIN или название" /></label>
            <label className={field}><span>Дата среза</span><input type="date" className={input()} value={oDate} onChange={(e) => setODate(e.target.value)} /></label>
            <label className={field}><span>Цена, %</span><input className={input({ num: true })} value={oPx} onChange={(e) => setOPx(e.target.value)} /></label>
            <label className={field}><span>НКД</span><input className={input({ num: true })} value={oAi} onChange={(e) => setOAi(e.target.value)} /></label>
            <label className={field}><span>Номинал</span><input className={input({ num: true })} value={oFace} onChange={(e) => setOFace(e.target.value)} /></label>
            <label className={field}><span>Основание</span><input className={input()} value={oWhy} onChange={(e) => setOWhy(e.target.value)} placeholder="сверка от …" /></label>
            <Button size="sm" disabled={!bond || !oDate || !(oPx || oAi || oFace) || oWhy.trim().length < 3 || addOv.isPending} onClick={() => addOv.mutate()}>Сохранить</Button>
          </div>}
        </div>
        <div>
          <h3 className="text-sm">Касса портфеля</h3>
          <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 220 }}><table className={tbl}><thead><tr><th>Валюта</th><th>Вид</th><th className="text-right">Сумма</th><th></th></tr></thead>
            <tbody>{(ca.data ?? []).map((c) => <tr key={c.adjustment_id} title={c.reason}><td>{c.currency}</td><td>{c.as_of ? `остаток на ${fmt.date(c.as_of)}` : 'сдвиг всех исторических срезов'}</td><td className="text-right tabular-nums">{fmt.num(c.target_balance ?? c.shift, 2)}</td><td>{isRiskManager && <Button size="sm" variant="ghost" onClick={() => delCa.mutate(c.adjustment_id)}>снять</Button>}</td></tr>)}
              {!ca.data?.length && <tr><td colSpan={4} className="text-muted">корректировок нет</td></tr>}</tbody></table></div>
          {isRiskManager && <div className={row}>
            <label className={field}><span>Валюта</span><Select value={cCur} onChange={setCCur} options={['RUB', 'USD', 'EUR', 'CNY', 'GBP'].map((c) => ({ value: c, label: c }))} ariaLabel="Валюта" className="w-full" /></label>
            <div className={field}><span>Вид</span><Segmented value={cKind} onChange={setCKind} options={[{ value: 'target', label: 'на дату' }, { value: 'shift', label: 'сдвиг' }]} ariaLabel="Вид корректировки" className="w-full [&>*]:flex-1" /></div>
            {cKind === 'target' && <label className={field}><span>Дата</span><input type="date" className={input()} value={cDate} onChange={(e) => setCDate(e.target.value)} /></label>}
            <label className={field}><span>{cKind === 'target' ? 'Целевой остаток' : 'Сдвиг'}</span><input className={input({ num: true })} value={cAmt} onChange={(e) => setCAmt(e.target.value)} /></label>
            <label className={field}><span>Основание</span><input className={input()} value={cWhy} onChange={(e) => setCWhy(e.target.value)} /></label>
            <Button size="sm" disabled={!portfolioId || !cAmt.trim() || (cKind === 'target' && !cDate) || cWhy.trim().length < 3 || addCa.isPending} onClick={() => addCa.mutate()}>Сохранить</Button>
          </div>}
        </div>
        <div>
          <h3 className="text-sm">Синонимы книги лимитов</h3>
          <div className={cn(tableWrap, tableWrapFlat)} style={{ maxHeight: 220 }}><table className={tbl}><thead><tr><th>Вид</th><th>Синоним</th><th>Каноническое имя</th><th></th></tr></thead>
            <tbody>{(sy.data ?? []).map((s) => <tr key={`${s.kind}-${s.alias}`}><td>{s.kind === 'issuer' ? 'эмитент' : 'отрасль'}</td><td>{s.alias}</td><td>{s.canonical}</td><td>{isRiskManager && <Button size="sm" variant="ghost" onClick={() => delSy.mutate(s)}>удалить</Button>}</td></tr>)}
              {!sy.data?.length && <tr><td colSpan={4} className="text-muted">синонимов нет — названия сравниваются без регистра и ОПФ</td></tr>}</tbody></table></div>
          {isRiskManager && <div className={row}>
            <div className={field}><span>Вид</span><Segmented value={sKind} onChange={setSKind} options={[{ value: 'issuer', label: 'эмитент' }, { value: 'sector', label: 'отрасль' }]} ariaLabel="Вид синонима" className="w-full [&>*]:flex-1" /></div>
            <label className={field}><span>Как в книге</span><input className={input()} value={sAlias} onChange={(e) => setSAlias(e.target.value)} /></label>
            <label className={field}><span>Как в справочнике</span><input className={input()} value={sCanon} onChange={(e) => setSCanon(e.target.value)} /></label>
            <Button size="sm" disabled={!sAlias.trim() || !sCanon.trim() || addSy.isPending} onClick={() => addSy.mutate()}>Добавить</Button>
          </div>}
        </div>
      </div>
    </Section>
  )
}
