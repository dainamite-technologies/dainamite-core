/**
 * Thin HTTP loopback wrapper used by the public Puffin calculator routes to
 * proxy authenticated CPQ endpoints as `admin@puffin.com`. Composes:
 *
 *   1. cached admin JWT (admin-session.ts)
 *   2. one retry on 401 after invalidating the cache
 *   3. JSON encode/decode + structured error
 *
 * Returning an `ok` discriminated union (rather than throwing on every non-2xx)
 * keeps route handlers compact — they decide whether 401/404 from CPQ should
 * surface as 503/404 to the visitor.
 */

import type { PuffinPublicConfig } from './env'
import { getPuffinAdminToken, invalidatePuffinAdminToken, PuffinAdminLoginError } from './admin-session'

export type ProxyOk<T> = {
  ok: true
  status: number
  data: T
}

export type ProxyErr = {
  ok: false
  status: number
  error: string
  details?: unknown
}

export type ProxyResult<T> = ProxyOk<T> | ProxyErr

export type ProxyRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
}

function buildUrl(baseUrl: string, path: string, query?: ProxyRequestInit['query']): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, baseUrl)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function readBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  try {
    return await res.text()
  } catch {
    return null
  }
}

async function performRequest(
  config: PuffinPublicConfig,
  path: string,
  init: ProxyRequestInit,
  token: string,
): Promise<Response> {
  const url = buildUrl(config.baseUrl, path, init.query)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Cookie: `auth_token=${token}`,
    Accept: 'application/json',
    ...(init.headers ?? {}),
  }
  let body: BodyInit | undefined
  if (init.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
  }
  return fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  })
}

export async function proxyRequest<T = unknown>(
  config: PuffinPublicConfig,
  path: string,
  init: ProxyRequestInit = {},
): Promise<ProxyResult<T>> {
  let token: string
  try {
    token = await getPuffinAdminToken(config)
  } catch (err) {
    if (err instanceof PuffinAdminLoginError) {
      return { ok: false, status: err.status, error: err.code, details: err.message }
    }
    throw err
  }

  let res: Response
  try {
    res = await performRequest(config, path, init, token)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: 'proxy_network_error',
      details: err instanceof Error ? err.message : String(err),
    }
  }

  if (res.status === 401) {
    invalidatePuffinAdminToken()
    try {
      token = await getPuffinAdminToken(config)
    } catch (err) {
      if (err instanceof PuffinAdminLoginError) {
        return { ok: false, status: err.status, error: err.code, details: err.message }
      }
      throw err
    }
    try {
      res = await performRequest(config, path, init, token)
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: 'proxy_network_error',
        details: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const body = await readBody(res)
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: 'proxy_upstream_error',
      details: body,
    }
  }

  return { ok: true, status: res.status, data: body as T }
}

export const proxyClient = {
  get: <T = unknown>(config: PuffinPublicConfig, path: string, query?: ProxyRequestInit['query']) =>
    proxyRequest<T>(config, path, { method: 'GET', query }),
  post: <T = unknown>(config: PuffinPublicConfig, path: string, body?: unknown) =>
    proxyRequest<T>(config, path, { method: 'POST', body }),
}
