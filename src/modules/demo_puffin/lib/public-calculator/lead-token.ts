/**
 * HS256 JWT used as the visitor's `quoteSessionToken`. The signing secret is
 * separate from the framework's `JWT_SECRET` (PUFFIN_PUBLIC_LEAD_JWT_SECRET)
 * so rotating one cannot invalidate the other and a leaked lead token cannot
 * be used to authenticate as a staff user.
 */

import crypto from 'node:crypto'

const ISSUER = 'puffin-public-calculator'
const AUDIENCE = 'puffin-public-calculator'
const SCOPE = 'puffin.public.quote'

export type LeadTokenPayload = {
  iss: string
  aud: string
  sub: string
  scope: typeof SCOPE
  tenantSlug: string
  jti: string
  iat: number
  exp: number
}

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest()
}

export function signLeadToken(input: {
  customerId: string
  ttlSeconds: number
  secret: string
}): { token: string; expiresAt: Date; jti: string } {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + Math.max(60, input.ttlSeconds)
  const jti = crypto.randomUUID()

  const payload: LeadTokenPayload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: input.customerId,
    scope: SCOPE,
    tenantSlug: 'puffin',
    jti,
    iat: now,
    exp,
  }

  const header = { alg: 'HS256', typ: 'JWT' }
  const encHeader = base64url(JSON.stringify(header))
  const encPayload = base64url(JSON.stringify(payload))
  const data = `${encHeader}.${encPayload}`
  const signature = base64url(hmac(input.secret, data))
  const token = `${data}.${signature}`
  return { token, expiresAt: new Date(exp * 1000), jti }
}

export type VerifyLeadTokenResult =
  | { ok: true; payload: LeadTokenPayload }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' | 'wrong_audience' | 'wrong_scope' }

export function verifyLeadToken(token: string, secret: string): VerifyLeadTokenResult {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [encHeader, encPayload, encSignature] = parts
  const data = `${encHeader}.${encPayload}`
  const expectedSig = base64url(hmac(secret, data))

  const provided = Buffer.from(encSignature)
  const expected = Buffer.from(expectedSig)
  if (provided.length !== expected.length) return { ok: false, reason: 'invalid_signature' }
  if (!crypto.timingSafeEqual(provided, expected)) return { ok: false, reason: 'invalid_signature' }

  let payload: LeadTokenPayload
  try {
    payload = JSON.parse(Buffer.from(encPayload, 'base64').toString('utf8')) as LeadTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || now >= payload.exp) {
    return { ok: false, reason: 'expired' }
  }
  if (payload.aud !== AUDIENCE || payload.iss !== ISSUER) {
    return { ok: false, reason: 'wrong_audience' }
  }
  if (payload.scope !== SCOPE) {
    return { ok: false, reason: 'wrong_scope' }
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, payload }
}
