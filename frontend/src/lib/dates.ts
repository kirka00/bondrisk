export const toISO = (d: Date): string => d.toISOString().slice(0, 10)
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return toISO(d)
}
export const todayISO = (): string => toISO(new Date())
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
}
