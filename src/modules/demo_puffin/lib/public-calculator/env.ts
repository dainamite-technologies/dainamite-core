/**
 * Validates and exposes the environment configuration for the Puffin public
 * pricing calculator. All vars are namespaced `PUFFIN_PUBLIC_*` (or reused
 * from the XD-276 admin credentials) so the demo surface is unambiguously
 * scoped.
 *
 * `readPuffinPublicConfig()` returns null when a required var is missing — the
 * caller is responsible for surfacing a 503 / ops-banner. We never throw at
 * import time, so a misconfigured deploy cannot crash the entire app.
 */

export type PuffinCaptchaProvider = 'disabled' | 'recaptcha_v3'

export type PuffinPublicConfig = {
  baseUrl: string
  adminEmail: string
  adminPassword: string
  leadJwtSecret: string
  leadJwtTtlSeconds: number
  defaultRegion: string
  captcha:
    | { provider: 'disabled' }
    | { provider: 'recaptcha_v3'; siteKey: string; secret: string; minScore: number }
  rateBudgets: {
    price: number
    attributes: number
    leads: number
    quotes: number
  }
}

export type PuffinPublicConfigError = {
  missing: string[]
  invalid: string[]
}

const DEFAULT_TTL_SECONDS = 600
const MIN_LEAD_SECRET_LENGTH = 32

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const num = Number.parseInt(raw, 10)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function readTrimmed(name: string): string | undefined {
  const raw = process.env[name]
  if (raw == null) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function buildBaseUrl(): string {
  const explicit = readTrimmed('PUFFIN_PUBLIC_BASE_URL')
  if (explicit) return explicit.replace(/\/+$/, '')
  const port = readTrimmed('PORT') ?? '3000'
  return `http://localhost:${port}`
}

/**
 * Read and validate the calculator config. Returns either the resolved config
 * or an error describing what's missing/invalid so the caller can render a
 * useful operator banner.
 */
export function readPuffinPublicConfig(): { ok: true; config: PuffinPublicConfig } | { ok: false; error: PuffinPublicConfigError } {
  const missing: string[] = []
  const invalid: string[] = []

  const adminEmail = readTrimmed('CPQ_DEMO_PUFFIN_ADMIN_EMAIL') ?? 'admin@puffin.com'
  const adminPassword = readTrimmed('CPQ_DEMO_PUFFIN_ADMIN_PASSWORD') ?? 'secret'

  const leadJwtSecret = readTrimmed('PUFFIN_PUBLIC_LEAD_JWT_SECRET')
  if (!leadJwtSecret) {
    missing.push('PUFFIN_PUBLIC_LEAD_JWT_SECRET')
  } else if (leadJwtSecret.length < MIN_LEAD_SECRET_LENGTH) {
    invalid.push(`PUFFIN_PUBLIC_LEAD_JWT_SECRET (must be at least ${MIN_LEAD_SECRET_LENGTH} characters)`)
  }

  const captchaProviderRaw = (readTrimmed('PUFFIN_PUBLIC_CAPTCHA_PROVIDER') ?? 'disabled').toLowerCase()
  let captcha: PuffinPublicConfig['captcha']
  if (captchaProviderRaw === 'disabled') {
    captcha = { provider: 'disabled' }
  } else if (captchaProviderRaw === 'recaptcha_v3') {
    const siteKey = readTrimmed('PUFFIN_PUBLIC_CAPTCHA_SITE_KEY')
    const secret = readTrimmed('PUFFIN_PUBLIC_CAPTCHA_SECRET')
    if (!siteKey) missing.push('PUFFIN_PUBLIC_CAPTCHA_SITE_KEY')
    if (!secret) missing.push('PUFFIN_PUBLIC_CAPTCHA_SECRET')
    captcha = {
      provider: 'recaptcha_v3',
      siteKey: siteKey ?? '',
      secret: secret ?? '',
      minScore: Number.parseFloat(readTrimmed('PUFFIN_PUBLIC_CAPTCHA_MIN_SCORE') ?? '0.5') || 0.5,
    }
  } else {
    invalid.push(`PUFFIN_PUBLIC_CAPTCHA_PROVIDER (got "${captchaProviderRaw}", expected "disabled" or "recaptcha_v3")`)
    captcha = { provider: 'disabled' }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, error: { missing, invalid } }
  }

  return {
    ok: true,
    config: {
      baseUrl: buildBaseUrl(),
      adminEmail,
      adminPassword,
      leadJwtSecret: leadJwtSecret as string,
      leadJwtTtlSeconds: readNumber('PUFFIN_PUBLIC_LEAD_JWT_TTL_SECONDS', DEFAULT_TTL_SECONDS),
      defaultRegion: readTrimmed('PUFFIN_PUBLIC_DEFAULT_REGION') ?? 'fra1',
      captcha,
      rateBudgets: {
        price: readNumber('PUFFIN_PUBLIC_RATE_PRICE', 120),
        attributes: readNumber('PUFFIN_PUBLIC_RATE_ATTRIBUTES', 60),
        leads: readNumber('PUFFIN_PUBLIC_RATE_LEADS', 5),
        quotes: readNumber('PUFFIN_PUBLIC_RATE_QUOTES', 3),
      },
    },
  }
}

/**
 * Convenience wrapper for routes/pages that just want the config or null on
 * error — the route is then expected to return 503 with `not_configured`.
 */
export function readPuffinPublicConfigOrNull(): PuffinPublicConfig | null {
  const result = readPuffinPublicConfig()
  return result.ok ? result.config : null
}
