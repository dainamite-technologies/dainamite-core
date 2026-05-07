/**
 * Pluggable captcha verifier for the lead-form `/leads` route. Two
 * implementations: `disabled` (default in dev — accepts any token, warns
 * once) and `recaptcha_v3` (POST to siteverify, threshold + action check).
 *
 * The interface is deliberately thin so additional providers can be added
 * later without changing route handlers.
 */

import type { PuffinPublicConfig } from './env'

export type CaptchaVerification =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' | 'low_score' | 'wrong_action' | 'network_error'; score?: number }

export interface CaptchaVerifier {
  verify(token: string | undefined | null, action: string): Promise<CaptchaVerification>
}

let warned = false

class DisabledCaptchaVerifier implements CaptchaVerifier {
  async verify(_token: string | undefined | null, _action: string): Promise<CaptchaVerification> {
    if (!warned) {
      warned = true
      console.warn(
        '[puffin-public-calculator] captcha is DISABLED — set PUFFIN_PUBLIC_CAPTCHA_PROVIDER=recaptcha_v3 in production',
      )
    }
    return { ok: true }
  }
}

class RecaptchaV3Verifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string,
    private readonly minScore: number,
  ) {}

  async verify(token: string | undefined | null, action: string): Promise<CaptchaVerification> {
    if (!token || token.length === 0) return { ok: false, reason: 'missing' }

    let res: Response
    try {
      res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secret, response: token }).toString(),
        cache: 'no-store',
      })
    } catch {
      return { ok: false, reason: 'network_error' }
    }
    if (!res.ok) return { ok: false, reason: 'network_error' }

    let payload: {
      success?: boolean
      score?: number
      action?: string
    }
    try {
      payload = (await res.json()) as typeof payload
    } catch {
      return { ok: false, reason: 'network_error' }
    }

    if (!payload.success) return { ok: false, reason: 'invalid', score: payload.score }
    if (typeof payload.score === 'number' && payload.score < this.minScore) {
      return { ok: false, reason: 'low_score', score: payload.score }
    }
    if (payload.action && payload.action !== action) {
      return { ok: false, reason: 'wrong_action', score: payload.score }
    }
    return { ok: true }
  }
}

export function createCaptchaVerifier(config: PuffinPublicConfig): CaptchaVerifier {
  if (config.captcha.provider === 'recaptcha_v3') {
    return new RecaptchaV3Verifier(config.captcha.secret, config.captcha.minScore)
  }
  return new DisabledCaptchaVerifier()
}
