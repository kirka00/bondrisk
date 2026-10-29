/** Цвета серий читаются из CSS-токенов Tailwind (@theme), чтобы графики следовали теме. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
const c = (n: string) => () => token(`--color-${n}`)
export const series = {
  s1: c('s1'), s2: c('s2'), s3: c('s3'), s4: c('s4'), s5: c('s5'), s6: c('s6'), s7: c('s7'), s8: c('s8'),
  muted: c('muted'), surface: c('surface'), grid: c('grid'), axis: c('axis'), text: c('text'), text2: c('text-2'),
  critical: c('critical'), good: c('good'),
}
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
