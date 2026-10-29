import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  status: number
  code?: string
  retryable?: boolean
  constructor(status: number, body: ApiErrorBody | string) {
    super(typeof body === 'string' ? body : body.detail)
    this.status = status
    if (typeof body !== 'string') { this.code = body.code; this.retryable = body.retryable }
  }
}

const BASE = '/api/v1'
export const USER_KEY = 'bondrisk.user'
export function currentUserId(): number {
  try { return Number(localStorage.getItem(USER_KEY) ?? '1') || 1 } catch { return 1 }
}

type Query = Record<string, string | number | boolean | null | undefined>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, body?: unknown, q?: Query): Promise<T> {
  const res = await fetch(`${BASE}${path}${qs(q)}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': String(currentUserId()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const b = data as ApiErrorBody | { detail?: unknown } | string | null
    if (b && typeof b === 'object' && typeof (b as ApiErrorBody).detail === 'string') throw new ApiError(res.status, b as ApiErrorBody)
    if (b && typeof b === 'object' && Array.isArray((b as { detail?: unknown }).detail)) {
      const d = (b as { detail: { loc?: unknown[]; msg: string }[] }).detail
      throw new ApiError(res.status, d.map((x) => `${(x.loc ?? []).slice(-1)[0] ?? ''}: ${x.msg}`).join('; '))
    }
    throw new ApiError(res.status, typeof b === 'string' ? b : `HTTP ${res.status}`)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', path, undefined, q),
  post: <T>(path: string, body?: unknown, q?: Query) => request<T>('POST', path, body ?? {}, q),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
