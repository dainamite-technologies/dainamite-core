'use client'

import * as React from 'react'
import { Check, X } from 'lucide-react'

type Props = {
  open: boolean
  loading: boolean
  error: string | null
  captchaProvider: 'disabled' | 'recaptcha_v3'
  captchaSiteKey?: string | null
  totalMonthly?: number
  currencyCode?: string
  itemCount?: number
  onSubmit: (input: { name: string; email: string; company: string; captchaToken: string | null }) => Promise<void>
  onClose: () => void
}

function formatCurrency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(value)
  } catch {
    return `${currencyCode} ${value.toFixed(2)}`
  }
}

export function LeadFormSlideOver({
  open,
  loading,
  error,
  captchaProvider,
  captchaSiteKey,
  totalMonthly = 0,
  currencyCode = 'USD',
  itemCount = 0,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [company, setCompany] = React.useState('')
  const captchaInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const captchaToken =
      captchaProvider === 'recaptcha_v3' ? captchaInputRef.current?.value ?? null : null
    await onSubmit({ name, email, company, captchaToken })
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="pf-modal-overlay" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pf-modal-head">
          <div>
            <h3 className="pf-modal-title">Get a quote</h3>
            <p className="pf-modal-sub">
              We&apos;ll send your configured cart to a sales engineer who&apos;ll follow up shortly.
            </p>
          </div>
          <button type="button" className="pf-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {(totalMonthly > 0 || itemCount > 0) && (
          <div className="pf-modal-summary">
            <div className="pf-eyebrow">YOUR ESTIMATE</div>
            <div className="pf-modal-total">
              <span className="pf-mono pf-mono--xl">{formatCurrency(totalMonthly, currencyCode)}</span>
              <span className="pf-price-suffix">/ mo</span>
            </div>
            <div className="pf-modal-summary-meta">
              {itemCount} {itemCount === 1 ? 'line' : 'lines'} · {currencyCode}
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          onKeyDown={handleKey}
          className="pf-form"
          data-testid="lead-form"
        >
          <label className="pf-field">
            <span>Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              autoFocus
            />
          </label>

          <label className="pf-field">
            <span>Work email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
            />
          </label>

          <label className="pf-field">
            <span>Company</span>
            <input
              type="text"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme, Inc."
            />
          </label>

          {captchaProvider === 'recaptcha_v3' && captchaSiteKey && (
            <div className="pf-config-help">
              Protected by reCAPTCHA v3.
              <input ref={captchaInputRef} type="hidden" name="captcha_token" />
            </div>
          )}

          {error && <p className="pf-modal-error">{error}</p>}

          <div className="pf-modal-actions">
            <button type="button" onClick={onClose} className="pf-btn pf-btn--ghost">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="pf-btn pf-btn--primary"
              style={{ width: 'auto' }}
            >
              {loading ? 'Submitting…' : 'Send quote request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function ConfirmationScreen({
  quoteNumber,
  onClose,
}: {
  quoteNumber: string
  onClose: () => void
}) {
  return (
    <div className="pf-modal-overlay" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pf-modal-success">
          <div className="pf-success-mark">
            <Check size={28} aria-hidden />
          </div>
          <h3 className="pf-modal-title">Quote on its way.</h3>
          <p className="pf-modal-sub">
            Your quote <span className="pf-mono">{quoteNumber}</span> is in our system. A sales
            engineer will review your configuration and follow up within one business day.
          </p>
          <div className="pf-modal-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" onClick={onClose} className="pf-btn pf-btn--primary" style={{ width: 'auto' }}>
              Continue browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
