/** Формулы методологии (KaTeX) с подстановкой текущих значений. */
import { fmt } from './format'

export interface FormulaSpec {
  title: string
  tex: string
  note?: string
}

export const formulas = {
  mv: { title: 'Рыночная стоимость', tex: String.raw`MV = Q\cdot\left(\frac{P\%}{100}\cdot N + AI\right)\cdot FX`, note: 'Грязная цена (с НКД) в валюте выпуска, пересчитанная по курсу ЦБ РФ. Нетто — с учётом знака позиции, брутто — сумма модулей.' },
  ai: { title: 'Накопленный купонный доход', tex: String.raw`AI = C_{\text{пер}}\cdot\frac{d_{\text{прошло}}}{d_{\text{пер}}}`, note: 'На дату расчётов T+2 рабочих дня по графику купонов (§3); без графика — по текущему купонному периоду. В сумме сделки — AI(S) = AI(D) + c·N·(S − D)/365.' },
  ytm: { title: 'Доходность к погашению (эффективная годовая)', tex: String.raw`\sum_i \frac{CF_i}{(1+y)^{t_i}} = P_{dirty}`, note: 'Приоритет — рыночная доходность MOEX на дату (биржевая конвенция, к оферте); иначе бисекция по фактическим потокам до ближайшей оферты.' },
  cy: { title: 'Текущая доходность', tex: String.raw`CY = \frac{c}{P\%}\cdot 100` },
  dmac: { title: 'Дюрация Маколея', tex: String.raw`D_{Mac} = \frac{\sum_i t_i\,PV_i}{\sum_i PV_i}`, note: 'Порядок: флоутер — срок до пересмотра купона; рыночная дюрация MOEX; по потокам; аппроксимация. Портфельная — средневзвешенная по |MV| облигаций.' },
  dmod: { title: 'Модифицированная дюрация', tex: String.raw`D_{mod} = \frac{D_{Mac}}{1+y}` },
  convexity: { title: 'Конвексность', tex: String.raw`C = \frac{1}{f^2}\cdot\frac{\sum_i CF_i\, n_i(n_i+1)/(1+i_p)^{n_i+2}}{\sum_i CF_i/(1+i_p)^{n_i}},\quad n_i = f\,t_i`, note: 'i_p — периодическая ставка, эквивалентная эффективной y; без потоков — C ≈ D(D + 0,5)/(1 + y/2)²; флоутер — как бескупонная на срок до пересмотра.' },
  dv01: { title: 'DV01', tex: String.raw`DV01 = \frac{|MV|\cdot D_{mod}}{10\,000},\qquad DV01_{\text{портф}} = \sum_i \operatorname{sgn}(Q_i)\,DV01_i`, note: 'Изменение стоимости при сдвиге ставок на 1 б.п.; короткая позиция входит со знаком «минус».' },
  cs01: { title: 'CS01', tex: String.raw`CS01 = |Q|\cdot\bigl(P(z) - P(z + 1\,\text{б.п.})\bigr)\cdot FX`, note: 'z — Z-спред к КБД; где он не определён — CS01 ≈ DV01. Суверенные бумаги исключены.' },
  dm: { title: 'Дисконтная маржа флоутера', tex: String.raw`P + AI = \sum_i \frac{C_i + N_i}{\bigl(1 + \frac{r/100 + DM}{f}\bigr)^{t_i f}}`, note: 'r — последняя ненулевая ставка купона, потоки до погашения; средняя DM — по |MV| флоутеров с определённой маржой.' },
  gspread: { title: 'G-спред', tex: String.raw`G = \bigl(Y_{\text{бумаги}} - Y_{\text{КБД}}(D_{mod})\bigr)\cdot 100\ \text{б.п.}`, note: 'Среднее — взвешено по |MV| по рублёвым фиксированным бумагам в коридоре [−200; 3000] б.п., без суверенных и дефолтных.' },
  var: { title: 'VaR 99 %, 1 день (параметрический)', tex: String.raw`VaR_{99\%}^{1d} = |DV01|\cdot z_{99\%}\cdot\sigma_{1d} = |DV01|\cdot 2{,}326\cdot 32\ \text{б.п.}` },
  stress: { title: 'Стресс-сценарий', tex: String.raw`P\&L(\Delta y) = -DV01\cdot\Delta y + \tfrac12\,MV\,\bar C\,\left(\tfrac{\Delta y}{10^4}\right)^2`, note: 'Твист: ±θ·DV01(<5 лет) ∓ θ·DV01(≥5 лет).' },
  adv01: { title: 'ADV01 (кредитно-взвешенный DV01)', tex: String.raw`ADV01 = \sum_b k_b\Bigl(\sum_{\text{long}\in b} DV01 - \sum_{\text{short}\in b} DV01\Bigr)`, note: 'k: AAA 0,9 · AA 1,0 · A 1,1 · BBB 1,25 · BB 1,5 · B 1,75 · CCC 2,0 · без рейтинга 3,0 · D 5,0.' },
  rating: { title: 'Средний рейтинг', tex: String.raw`\bar s = \frac{\sum_i s_i\,|MV_i|}{\sum_i |MV_i|}\ \to\ \text{ближайшая ступень шкалы (AAA = 1)}` },
  utilization: { title: 'Утилизация лимита', tex: String.raw`u = \frac{\text{факт}}{\text{лимит}}`, note: 'u > 80 % — предупреждение, u > 100 % — нарушение; у лимита концентрации — наибольшая из утилизаций по ₽, % и доле эмиссии. Снятое нарушение действует, пока лимит не изменился.' },
  cash: { title: 'Касса', tex: String.raw`K = \sum_{\text{валюты}} \Bigl(\sum \text{движения}\Bigr)\cdot FX`, note: 'Учётный остаток + денежные ноги сделок, расчёты по которым ещё не наступили (по дате сделки); рубль, доллар, евро, юань, фунт; ручная корректировка риск-менеджера.' },
} satisfies Record<string, FormulaSpec>

export type FormulaKey = keyof typeof formulas

/** Строка подстановки значений для поповера. */
type Vals = Record<string, number | string | null | undefined>
const num = (x: unknown): number | null => (typeof x === 'number' ? x : null)

export function substitution(key: FormulaKey, raw: Vals): string | null {
  const v: Record<string, number | null> = {}
  for (const k of Object.keys(raw)) v[k] = num(raw[k])
  const n = (x: number | null | undefined, d = 2) => fmt.num(x, d)
  switch (key) {
    case 'dv01':
      return v.mv != null && v.dmod != null ? `|MV| = ${fmt.rub0(v.mv)}, D_mod = ${n(v.dmod, 3)} → DV01 = ${fmt.rub0(v.dv01)}` : null
    case 'var':
      return v.dv01 != null ? `|DV01| = ${fmt.rub0(Math.abs(v.dv01))} × 2,326 × 32 = ${fmt.rub0(v.var)}` : null
    case 'dmod':
      return v.dmac != null && v.y != null ? `D_Mac = ${n(v.dmac, 3)}, y = ${fmt.pct(v.y)} → D_mod = ${n(v.dmod, 3)}` : null
    case 'cy':
      return v.c != null && v.p != null ? `c = ${fmt.pct(v.c)}, P = ${n(v.p)} % → CY = ${fmt.pct(v.cy)}` : null
    case 'gspread':
      return v.ytm != null && v.curve != null ? `Y = ${fmt.pct(v.ytm)}, Y_КБД = ${fmt.pct(v.curve)} → G = ${fmt.bp(v.g)}` : null
    case 'mv':
      return v.q != null && v.p != null ? `Q = ${fmt.int(v.q)}, P = ${n(v.p)} %, N = ${n(v.n)}, AI = ${n(v.ai)}, FX = ${n(v.fx, 4)} → MV = ${fmt.rub0(v.mv)}` : null
    case 'rating':
      return v.score != null ? `s̄ = ${n(v.score)} → ${typeof raw.grade === 'string' ? raw.grade : ''}`.trim() : null
    case 'utilization':
      return v.fact != null && v.limit != null ? `факт ${n(v.fact, 0)} / лимит ${n(v.limit, 0)} = ${fmt.pct(v.u, 1)}` : null
    default:
      return null
  }
}
