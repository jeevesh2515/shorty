export type ApiEnvelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } }

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const API_TOKEN = import.meta.env.VITE_API_TOKEN || ''

export function apiIsConfigured() {
  return Boolean(API_BASE) || typeof window !== 'undefined'
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = API_BASE ? `${API_BASE}${path}` : path
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), ...(init.headers || {}) } })
  const payload = await response.json() as ApiEnvelope<T>
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `API request failed (${response.status})`)
  return payload.data as T
}

export function apiBaseUrl() { return API_BASE }
