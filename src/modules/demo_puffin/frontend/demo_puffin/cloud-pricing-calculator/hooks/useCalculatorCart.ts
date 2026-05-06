'use client'

import * as React from 'react'
import type { Cart, CartItem } from '../types'

const STORAGE_KEY = 'puffin.public.calculator.cart.v1'

const DEFAULT_CART: Cart = {
  flow: null,
  region: 'fra1',
  term: 'on_demand',
  cadence: 'monthly',
  fromBundle: null,
  items: [],
}

function safeBase64Encode(value: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.btoa(unescape(encodeURIComponent(value)))
  } catch {
    return ''
  }
}

function safeBase64Decode(value: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return decodeURIComponent(escape(window.atob(value)))
  } catch {
    return ''
  }
}

function normalizeCart(input: unknown): Cart {
  const cart: Cart = { ...DEFAULT_CART }
  if (!input || typeof input !== 'object') return cart
  const r = input as Partial<Cart>
  if (r.flow === 'solutions' || r.flow === 'custom') cart.flow = r.flow
  if (typeof r.region === 'string') cart.region = r.region
  if (r.term === 'on_demand' || r.term === 'reserved_1y' || r.term === 'reserved_3y') cart.term = r.term
  if (r.cadence === 'monthly' || r.cadence === 'annual_prepay') cart.cadence = r.cadence
  if (typeof r.fromBundle === 'string' || r.fromBundle === null) cart.fromBundle = r.fromBundle ?? null
  if (Array.isArray(r.items)) {
    cart.items = r.items
      .filter((i) => i && typeof i === 'object' && typeof (i as CartItem).offeringId === 'string')
      .map((i) => ({
        lineKey: (i as CartItem).lineKey ?? `line-${Math.random().toString(36).slice(2, 10)}`,
        offeringId: (i as CartItem).offeringId,
        configuration: ((i as CartItem).configuration ?? {}) as Record<string, unknown>,
        quantity: typeof (i as CartItem).quantity === 'number' ? (i as CartItem).quantity : 1,
        parentLineKey: (i as CartItem).parentLineKey ?? null,
        bundleSlotKey: (i as CartItem).bundleSlotKey ?? null,
      }))
  }
  return cart
}

function makeLineKey(): string {
  return `line-${Math.random().toString(36).slice(2, 10)}`
}

type CartReducerAction =
  | { type: 'set'; cart: Cart }
  | { type: 'setFlow'; flow: Cart['flow'] }
  | { type: 'setRegion'; region: string }
  | { type: 'setTerm'; term: Cart['term'] }
  | { type: 'setCadence'; cadence: Cart['cadence'] }
  | { type: 'addItem'; item: Omit<CartItem, 'lineKey'> & { lineKey?: string } }
  | { type: 'updateItem'; lineKey: string; patch: Partial<CartItem> }
  | { type: 'removeItem'; lineKey: string }
  | { type: 'replaceItems'; items: CartItem[]; fromBundle: string | null }
  | { type: 'reset' }

function reducer(state: Cart, action: CartReducerAction): Cart {
  switch (action.type) {
    case 'set':
      return action.cart
    case 'setFlow':
      return { ...state, flow: action.flow }
    case 'setRegion':
      return { ...state, region: action.region }
    case 'setTerm':
      return { ...state, term: action.term }
    case 'setCadence':
      return { ...state, cadence: action.cadence }
    case 'addItem': {
      const lineKey = action.item.lineKey ?? makeLineKey()
      return {
        ...state,
        items: [
          ...state.items,
          {
            lineKey,
            offeringId: action.item.offeringId,
            configuration: action.item.configuration ?? {},
            quantity: action.item.quantity ?? 1,
            parentLineKey: action.item.parentLineKey ?? null,
            bundleSlotKey: action.item.bundleSlotKey ?? null,
          },
        ],
      }
    }
    case 'updateItem':
      return {
        ...state,
        items: state.items.map((i) => (i.lineKey === action.lineKey ? { ...i, ...action.patch } : i)),
      }
    case 'removeItem':
      return { ...state, items: state.items.filter((i) => i.lineKey !== action.lineKey) }
    case 'replaceItems':
      return { ...state, items: action.items, fromBundle: action.fromBundle }
    case 'reset':
      return { ...DEFAULT_CART, region: state.region, term: state.term, cadence: state.cadence }
  }
}

/**
 * Read the cart from URL/sessionStorage. Returns null when called server-side
 * so the initial reducer state is identical on SSR and the first client
 * render — preventing hydration mismatches when the URL carries `?flow=...`.
 * The shell calls this from a `useEffect` after mount.
 */
function readFromBrowser(defaultRegion: string): Cart | null {
  if (typeof window === 'undefined') return null

  // 1. Permalink wins.
  try {
    const params = new URLSearchParams(window.location.search)
    const flow = params.get('flow')
    const region = params.get('region') ?? defaultRegion
    const term = params.get('term')
    const cadence = params.get('cadence')
    const cartParam = params.get('cart')

    let items: CartItem[] = []
    let fromBundle: string | null = null
    if (cartParam) {
      const decoded = safeBase64Decode(cartParam)
      if (decoded) {
        try {
          const parsed = JSON.parse(decoded) as { items?: unknown; fromBundle?: string | null }
          const fromBundleParsed = parsed?.fromBundle
          if (typeof fromBundleParsed === 'string' || fromBundleParsed === null) fromBundle = fromBundleParsed ?? null
          const merged = normalizeCart({ items: parsed?.items })
          items = merged.items
        } catch {
          // ignore corrupt permalink
        }
      }
    } else {
      // 2. SessionStorage fallback.
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          const stored = JSON.parse(raw) as Cart
          return normalizeCart({ ...stored, region: stored.region ?? defaultRegion })
        }
      } catch {
        // ignore
      }
    }

    return normalizeCart({
      flow: flow === 'solutions' || flow === 'custom' ? flow : null,
      region,
      term: term ?? 'on_demand',
      cadence: cadence ?? 'monthly',
      fromBundle,
      items,
    })
  } catch {
    return { ...DEFAULT_CART, region: defaultRegion }
  }
}

function writeUrl(cart: Cart): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (cart.flow) params.set('flow', cart.flow)
  else params.delete('flow')
  params.set('region', cart.region)
  params.set('term', cart.term)
  if (cart.cadence !== 'monthly') params.set('cadence', cart.cadence)
  else params.delete('cadence')
  if (cart.items.length > 0) {
    const payload = JSON.stringify({ items: cart.items, fromBundle: cart.fromBundle })
    const encoded = safeBase64Encode(payload)
    if (encoded.length < 8000) {
      params.set('cart', encoded)
    } else {
      params.delete('cart')
    }
  } else {
    params.delete('cart')
  }
  const next = `${window.location.pathname}?${params.toString()}`
  window.history.replaceState(null, '', next)
}

function writeStorage(cart: Cart): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
  } catch {
    // session storage unavailable / quota — silently ignore
  }
}

export type UseCalculatorCartReturn = {
  cart: Cart
  hydrated: boolean
  setFlow: (flow: Cart['flow']) => void
  setRegion: (region: string) => void
  setTerm: (term: Cart['term']) => void
  setCadence: (cadence: Cart['cadence']) => void
  addItem: (item: Omit<CartItem, 'lineKey'> & { lineKey?: string }) => void
  updateItem: (lineKey: string, patch: Partial<CartItem>) => void
  removeItem: (lineKey: string) => void
  replaceItems: (items: CartItem[], fromBundle: string | null) => void
  resetCart: () => void
  permalink: () => string
}

export function useCalculatorCart(defaultRegion: string): UseCalculatorCartReturn {
  // Initial state must match between SSR and the first client render — both
  // see the bare default. The URL/sessionStorage hydrate runs in an effect.
  const [cart, dispatch] = React.useReducer(
    reducer,
    { ...DEFAULT_CART, region: defaultRegion },
  )
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    const fromBrowser = readFromBrowser(defaultRegion)
    if (fromBrowser) dispatch({ type: 'set', cart: fromBrowser })
    setHydrated(true)
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!hydrated) return
    writeUrl(cart)
    writeStorage(cart)
  }, [cart, hydrated])

  return React.useMemo(
    () => ({
      cart,
      hydrated,
      setFlow: (flow) => dispatch({ type: 'setFlow', flow }),
      setRegion: (region) => dispatch({ type: 'setRegion', region }),
      setTerm: (term) => dispatch({ type: 'setTerm', term }),
      setCadence: (cadence) => dispatch({ type: 'setCadence', cadence }),
      addItem: (item) => dispatch({ type: 'addItem', item }),
      updateItem: (lineKey, patch) => dispatch({ type: 'updateItem', lineKey, patch }),
      removeItem: (lineKey) => dispatch({ type: 'removeItem', lineKey }),
      replaceItems: (items, fromBundle) => dispatch({ type: 'replaceItems', items, fromBundle }),
      resetCart: () => dispatch({ type: 'reset' }),
      permalink: () => (typeof window !== 'undefined' ? window.location.href : ''),
    }),
    [cart, hydrated],
  )
}
