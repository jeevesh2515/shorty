export type ApiEnvelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } }

const DEFAULT_API = 'https://shorty-production-63b7.up.railway.app'
const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API).replace(/\/$/, '')
const API_TOKEN = import.meta.env.VITE_API_TOKEN || ''

export function apiIsConfigured() {
  return Boolean(API_BASE)
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), ...(init.headers || {}) } })
  const payload = await response.json() as ApiEnvelope<T>
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `API request failed (${response.status})`)
  return payload.data as T
}

export function apiBaseUrl() { return API_BASE }
