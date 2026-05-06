'use client'

import * as React from 'react'

type Props = {
  open: boolean
  loading: boolean
  error: string | null
  captchaProvider: 'disabled' | 'recaptcha_v3'
  captchaSiteKey?: string | null
  onSubmit: (input: { name: string; email: string; company: string; captchaToken: string | null }) => Promise<void>
  onClose: () => void
}

export function LeadFormSlideOver({ open, loading, error, captchaProvider, captchaSiteKey, onSubmit, onClose }: Props) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [company, setCompany] = React.useState('')
  const captchaInputRef = React.useRef<HTMLInputElement | null>(null)

  // Close on Escape (Cmd/Ctrl+Enter to submit handled at form level).
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
      captchaProvider === 'recaptcha_v3'
        ? captchaInputRef.current?.value ?? null
        : null
    await onSubmit({ name, email, company, captchaToken })
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <form
        onSubmit={handleSubmit}
        onKeyDown={handleKey}
        className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl bg-background border shadow-xl p-5 space-y-4"
        data-testid="lead-form"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Get a quote</h2>
            <p className="text-xs text-muted-foreground">
              We&apos;ll send your configured cart to a sales engineer who&apos;ll follow up shortly.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            ×
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            autoFocus
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Work email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Company</span>
          <input
            type="text"
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        {captchaProvider === 'recaptcha_v3' && captchaSiteKey && (
          <div className="text-[11px] text-muted-foreground">
            Protected by reCAPTCHA v3.
            {/* The integrator wires window.grecaptcha to populate this hidden field. */}
            <input ref={captchaInputRef} type="hidden" name="captcha_token" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border hover:bg-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="text-xs px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Submitting…' : 'Send quote request'}
          </button>
        </div>
      </form>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-background border shadow-xl p-6 space-y-3">
        <div className="text-3xl">✓</div>
        <h2 className="text-lg font-semibold">Thanks — we&apos;ve got it.</h2>
        <p className="text-sm text-muted-foreground">
          Your quote <span className="font-mono">{quoteNumber}</span> is in our system. A sales engineer
          will review your configuration and follow up within one business day.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Continue browsing
        </button>
      </div>
    </div>
  )
}
