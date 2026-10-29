const nf = (min: number, max: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: max })
const f0 = nf(0, 0)
const f1 = nf(1, 1)
const f2 = nf(2, 2)
const f4 = nf(4, 4)

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** Число из поля ввода: русская запятая и пробелы-разделители допустимы; пусто или мусор — NaN. */
export function parseNum(s: string): number {
  const t = s.replace(/[\s\u00a0]/g, '').replace(',', '.')
  return t === '' ? NaN : Number(t)
}

export const fmt = {
  money(v: number | null | undefined, cur = 'RUB', digits = 2): string {
    if (!isNum(v)) return '—'
    const s = (digits === 0 ? f0 : f2).format(v)
    return `${s} ${curSign(cur)}`
  },
  rub0(v: number | null | undefined): string { return isNum(v) ? `${f0.format(Math.round(v) || 0)} ₽` : '—' },
  compact(v: number | null | undefined, cur = 'RUB'): string {
    if (!isNum(v)) return '—'
    const a = Math.abs(v)
    const sign = v < 0 ? '−' : ''
    const unit = a >= 1e12 ? [1e12, 'трлн'] as const : a >= 1e9 ? [1e9, 'млрд'] as const : a >= 1e6 ? [1e6, 'млн'] as const : a >= 1e3 ? [1e3, 'тыс.'] as const : [1, ''] as const
    const d = a / unit[0] >= 100 ? 0 : 1
    const num = unit[0] === 1 ? f0.format(a) : nf(d, d).format(a / unit[0])
    // копеечный остаток не должен выглядеть как «−0 ₽»
    return `${num === '0' ? '' : sign}${num} ${unit[1]} ${cur ? curSign(cur) : ''}`.replace(/\s+/g, ' ').trim()
  },
  pct(v: number | null | undefined, digits = 2): string { return isNum(v) ? `${nf(digits, digits).format(Number(v.toFixed(digits)) || 0)} %` : '—' },
  num(v: number | null | undefined, digits = 2): string {
    if (!isNum(v)) return '—'
    return (digits === 0 ? f0 : digits === 1 ? f1 : digits === 4 ? f4 : nf(digits, digits)).format(v)
  },
  int(v: number | null | undefined): string { return isNum(v) ? f0.format(v) : '—' },
  bp(v: number | null | undefined): string { return isNum(v) ? `${f0.format(Math.round(v))} б.п.` : '—' },
  years(v: number | null | undefined): string { return isNum(v) ? `${f2.format(v)} лет` : '—' },
  signed(v: number | null | undefined, digits = 2, suffix = ''): string {
    if (!isNum(v)) return '—'
    const s = nf(digits, digits).format(Math.abs(v))
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}${suffix}`
  },
  date(v: string | null | undefined): string {
    if (!v) return '—'
    const [y, m, d] = v.slice(0, 10).split('-')
    return `${d}.${m}.${y}`
  },
  dateTime(v: string | null | undefined): string {
    if (!v) return '—'
    // дата и время — оба в местном поясе (toISOString дал бы дату по UTC: 01:30 «вчерашнего» дня)
    return new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  },
  month(v: string): string {
    const d = new Date(v)
    return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
  },
}

/** Русское множественное число: plural(5, ['запись', 'записи', 'записей']) → «записей». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2]
}
export const countOf = (n: number, forms: [string, string, string]) => `${f0.format(n)} ${plural(n, forms)}`

/** Короткое имя эмитента: без организационно-правовой формы и кавычек, с общими сокращениями. */
const ISSUER_ALIASES: [RegExp, string][] = [
  [/^Министерство финансов Российской Федерации$/i, 'Минфин России'],
  [/^Государственная транспортная лизинговая компания$/i, 'ГТЛК'],
  [/^Российские железные дороги$/i, 'РЖД'],
  [/^Федеральная гидрогенерирующая компания\s*[-–]\s*РусГидро$/i, 'РусГидро'],
  [/^Акционерная финансовая корпорация "?Система"?$/i, 'АФК Система'],
  [/^Атомный энергопромышленный комплекс$/i, 'Атомэнергопром'],
  [/^Сбербанк России$/i, 'Сбербанк'],
]
export function issuerShort(name: string | null | undefined, max = 32): string {
  if (!name) return '—'
  let n = name
    .replace(/^(Публичное акционерное общество|Акционерное общество|Общество с ограниченной ответственностью|Открытое акционерное общество|Закрытое акционерное общество|Международная компания публичное акционерное общество|Международная компания акционерное общество|Акционерный коммерческий банк|Коммерческий банк|Акционерное общество Холдинговая компания|Публичное акционерное общество Группа компаний)\s*/i, '')
    .replace(/^(ПАО|АО|ООО|ОАО|ЗАО|МКПАО|МКАО|АКБ|КБ)\s+/i, '')
    .replace(/^["«]|["»]$/g, '').replace(/^"(.*)"$/s, '$1').replace(/"/g, '').trim()
  for (const [re, alias] of ISSUER_ALIASES) if (re.test(n)) { n = alias; break }
  return n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n
}

export function curSign(cur: string): string {
  return ({ RUB: '₽', USD: '$', EUR: '€', CNY: '¥' } as Record<string, string>)[cur] ?? cur
}

export const labels = {
  metric: {
    dv01: 'DV01 портфеля', duration: 'Дюрация', var_99: 'VaR 99 % / 1 день', mv_gross: 'Объём (брутто)',
    conc_issuer: 'Концентрация: эмитент', conc_sector: 'Концентрация: отрасль', conc_issue: 'Концентрация: выпуск',
    conc_portfolio: 'Концентрация: портфель (общий)',
    short_mv: 'Короткие позиции', below_aaa_mv: 'Бумаги ниже AAA', fx_mv: 'Валютные бумаги',
    credit_spread: 'Средний кредитный спред', new_issuer_rating: 'Новые эмитенты: мин. рейтинг',
  } as Record<string, string>,
  side: { long: 'длинная', short: 'короткая', both: 'обе' } as Record<string, string>,
  status: { ok: 'в норме', warning: 'предупреждение', breach: 'нарушение', waived: 'снято', 'n/a': 'н/д' } as Record<string, string>,
  coupon: { fixed: 'фиксированный', floating: 'плавающий', zero: 'дисконтный' } as Record<string, string>,
  bondStatus: { trading: 'торгуется', matured: 'погашена', defaulted: 'дефолт', suspended: 'приостановлена' } as Record<string, string>,
  ratingStatus: { active: 'действует', withdrawn: 'отозван', suspended: 'приостановлен', expired: 'истёк' } as Record<string, string>,
  tradeStatus: { settled: 'исполнена', new: 'новая', cancelled: 'отменена' } as Record<string, string>,
  role: { trader: 'трейдер', risk_manager: 'риск-менеджер', viewer: 'наблюдатель', admin: 'администратор' } as Record<string, string>,
  ratingSource: { issue: 'рейтинг выпуска', issuer: 'рейтинг эмитента', withdrawn: 'последний известный (отозван)', sovereign: 'суверенный (AAA по умолчанию)', none: 'без рейтинга' } as Record<string, string>,
  basis: { cost: 'по цене покупки', market: 'по рынку', max: 'большая из двух' } as Record<string, string>,
  priceSource: { close: 'закрытие дня', last: 'последняя котировка (окно 90 дней)', cost: 'средняя цена покупки — котировки нет 90 дней', override: 'ручная корректировка риск-менеджера' } as Record<string, string>,
  action: { assigned: 'присвоен', affirmed: 'подтверждён', upgraded: 'повышен', downgraded: 'понижен', withdrawn: 'отозван', other: 'изменён' } as Record<string, string>,
  errorCode: {
    BR001: 'недостаточно бумаг в позиции', BR002: 'недостаточно денег на счёте', BR003: 'нарушение жёсткого лимита',
    BR004: 'бумага не торгуется или дата вне срока обращения', BR005: 'недостаточно прав', BR006: 'нарушено бизнес-правило справочника',
    BR404: 'объект не найден',
  } as Record<string, string>,
}

export function limitUnit(metric: string): 'rub' | 'years' | 'bp' | 'score' {
  return metric === 'duration' ? 'years' : metric === 'credit_spread' ? 'bp' : metric === 'new_issuer_rating' ? 'score' : 'rub'
}
export function fmtLimitValue(metric: string, v: number | null | undefined): string {
  const u = limitUnit(metric)
  return u === 'years' ? fmt.years(v) : u === 'bp' ? fmt.bp(v) : u === 'score' ? (v == null ? '—' : `балл ${fmt.num(v, 0)}`) : fmt.rub0(v)
}
