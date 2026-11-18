'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fxHintMessage, isHintableCurrency, type FxHint } from '../../../../../lib/fxView'
import { useGrantedFeatures } from '../../../../../components/useGrantedFeatures'

const HINT_FEATURES = ['cpq.pricing.view', 'cpq.costs.view'] as const
const DEBOUNCE_MS = 350

/**
 * Read-only rate hint under the cost dialog's currency field (FX spec §UI/UX). Asks `POST /api/cpq/cost-preview` with
 * `fxFrom`; the route needs `cpq.pricing.view` + `cpq.costs.view`, so a user without both (e.g. procurement with
 * `cpq.costs.manage` only) never triggers the call, and any failed answer is silent: no toast, no error text.
 */
export function CostFxHint({ currency, quoteCurrency }: { currency: string; quoteCurrency: string }) {
  const t = useT()
  const granted = useGrantedFeatures(HINT_FEATURES)
  const allowed = HINT_FEATURES.every((feature) => granted.includes(feature))
  const [hint, setHint] = React.useState<FxHint | null>(null)
  const wanted = allowed && isHintableCurrency(currency.trim(), quoteCurrency)

  React.useEffect(() => {
    setHint(null)
    if (!wanted) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const call = await apiCall<{ fxHint?: FxHint | null }>('/api/cpq/cost-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fxFrom: currency.trim(), currencyCode: quoteCurrency }),
        })
        if (!cancelled && call.ok) setHint(call.result?.fxHint ?? null)
      })()
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [wanted, currency, quoteCurrency])

  const message = fxHintMessage(hint, t)
  if (!message) return null
  return (
    <p className={`text-xs ${hint?.error ? 'text-amber-700' : 'text-muted-foreground'}`} data-testid="cpq-cost-fx-hint" aria-live="polite">
      {message}
    </p>
  )
}
