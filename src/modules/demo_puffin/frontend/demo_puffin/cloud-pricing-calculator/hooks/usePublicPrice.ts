'use client'

import * as React from 'react'
import type { Cart, PriceResponse } from '../types'

const PRICE_ENDPOINT = '/api/demo_puffin/cloud-pricing-calculator/price'

type State = {
  loading: boolean
  data: PriceResponse | null
  error: string | null
}

const INITIAL: State = { loading: false, data: null, error: null }

function buildBody(cart: Cart) {
  return {
    currencyCode: 'USD',
    quoteContext: {
      contract_model: cart.term,
      billing_cadence: cart.cadence,
      ...(cart.fromBundle ? { fromBundle: cart.fromBundle } : {}),
    },
    items: cart.items.map((item) => ({
      lineKey: item.lineKey,
      offeringId: item.offeringId,
      configuration: { region: cart.region, ...item.configuration },
      parentLineKey: item.parentLineKey,
      quantity: item.quantity,
    })),
  }
}

export function usePublicPrice(cart: Cart, debounceMs: number): State {
  const [state, setState] = React.useState<State>(INITIAL)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  // Stable cache key — change triggers a new request.
  const key = React.useMemo(() => JSON.stringify(buildBody(cart)), [cart])

  React.useEffect(() => {
    if (cart.items.length === 0) {
      setState({ loading: false, data: null, error: null })
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()

    const controller = new AbortController()
    abortRef.current = controller

    setState((prev) => ({ ...prev, loading: true, error: null }))

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(PRICE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: key,
          signal: controller.signal,
        })
        if (!res.ok) {
          let msg = `pricing_failed_${res.status}`
          try {
            const body = (await res.json()) as { error?: string }
            if (body?.error) msg = body.error
          } catch {
            // ignore
          }
          setState({ loading: false, data: null, error: msg })
          return
        }
        const data = (await res.json()) as PriceResponse
        setState({ loading: false, data, error: null })
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return
        setState({ loading: false, data: null, error: 'network_error' })
      }
    }, debounceMs)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [key, debounceMs, cart.items.length])

  return state
}
