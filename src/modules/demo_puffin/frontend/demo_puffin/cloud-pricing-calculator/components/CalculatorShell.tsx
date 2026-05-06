'use client'

import * as React from 'react'
import type { Cart, CartItem, PublicCatalog, PublicConfig, PublicOffering } from '../types'
import { displaySpecName } from '../types'
import { useCalculatorCart } from '../hooks/useCalculatorCart'
import { usePublicPrice } from '../hooks/usePublicPrice'
import { HeroBar } from './layout/HeroBar'
import { ChooserScreen } from './chooser/ChooserScreen'
import { ProductCatalogue } from './custom/ProductCatalogue'
import { BundleGrid } from './solutions/BundleGrid'
import { CartDrawer } from './cart/CartDrawer'
import { LeadFormSlideOver, ConfirmationScreen } from './lead/LeadFormSlideOver'
import { GenericConfigurator } from './configurator/GenericConfigurator'
import { resolveBundleSlot } from '../lib/bundle-resolver'

type Props = {
  catalog: PublicCatalog
  config: PublicConfig
}

const LEADS_ENDPOINT = '/api/demo_puffin/cloud-pricing-calculator/leads'
const QUOTES_ENDPOINT = '/api/demo_puffin/cloud-pricing-calculator/quotes'

type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'lead-form'; loading: boolean; error: string | null }
  | { kind: 'submitted'; quoteNumber: string }

export function CalculatorShell({ catalog, config }: Props) {
  const cartCtx = useCalculatorCart(config.defaultRegion)
  const { cart } = cartCtx
  const pricing = usePublicPrice(cart, config.pricingDebounceMs)

  const [submission, setSubmission] = React.useState<SubmissionState>({ kind: 'idle' })
  const [sessionToken, setSessionToken] = React.useState<string | null>(null)

  const handleChoose = React.useCallback(
    (flow: 'solutions' | 'custom') => cartCtx.setFlow(flow),
    [cartCtx],
  )

  const handleAddItem = React.useCallback(
    (offeringId: string, configuration: Record<string, unknown>) => {
      cartCtx.addItem({ offeringId, configuration, quantity: 1, parentLineKey: null })
    },
    [cartCtx],
  )

  const handleUseBundle = React.useCallback(
    (bundleOfferingId: string) => {
      // CPQ's /price endpoint doesn't expand bundles (that happens at
      // quote-creation time only). Expand client-side using the bundle's
      // `components` already returned by /catalog: pick each slot's default
      // child offering and seed the cart with one line per slot.
      let bundleOffering: PublicOffering | undefined
      for (const spec of catalog.specifications) {
        const found = spec.offerings.find((o) => o.id === bundleOfferingId)
        if (found) {
          bundleOffering = found
          break
        }
      }

      const components = ((bundleOffering as unknown as { components?: Array<Record<string, unknown>> })?.components ?? []) as Array<{
        slot?: { componentGroup?: string; name?: string; cardinalityMin?: number } | null
        childOfferingId?: string
        isDefault?: boolean
        isActive?: boolean
      }>

      const seeded: CartItem[] = []
      const pickedBySlot = new Map<string, string>() // slotKey -> childOfferingId
      // First pass: defaults win.
      for (const comp of components) {
        if (comp.isActive === false) continue
        if (!comp.isDefault) continue
        // Use slot.name as the slot identity. componentGroup is shared across
// slots within a bundle (e.g. ecommerce has two `database` slots — one
// for the primary DB, one for redis cache; business has two `compute`
// slots — public website and apps host). Keying by componentGroup
// silently dropped the second of each pair.
const slotKey = comp.slot?.name ?? 'slot'
        if (!comp.childOfferingId) continue
        if (!pickedBySlot.has(slotKey)) pickedBySlot.set(slotKey, comp.childOfferingId)
      }
      // Second pass: required slots (cardinalityMin > 0) without a default
      // get the first available active component.
      for (const comp of components) {
        if (comp.isActive === false) continue
        // Use slot.name as the slot identity. componentGroup is shared across
// slots within a bundle (e.g. ecommerce has two `database` slots — one
// for the primary DB, one for redis cache; business has two `compute`
// slots — public website and apps host). Keying by componentGroup
// silently dropped the second of each pair.
const slotKey = comp.slot?.name ?? 'slot'
        if (pickedBySlot.has(slotKey)) continue
        if ((comp.slot?.cardinalityMin ?? 0) === 0) continue
        if (!comp.childOfferingId) continue
        pickedBySlot.set(slotKey, comp.childOfferingId)
      }

      // The bundle DTV uses logical keys (`db_plan`, `db_ha`, `ddos_tier`,
      // `vps_offering`, …) that differ from the per-product attribute codes
      // (`plan_size`, `ha_replicas`, …). The resolver translates per-slot.
      const bundleDtv = (bundleOffering?.designTimeValues ?? {}) as Record<string, unknown>

      // Apply per-slot bundle DTV overrides — some packages override the
      // default child offering (DDoS tier, VPS plan, Workspace plan, support
      // tier) and most slots seed initial attribute values. The resolver
      // also reports which optional slots should be skipped (e.g. CDN slot
      // when bundle says `cdn: false`).
      for (const slotKey of Array.from(pickedBySlot.keys())) {
        const resolution = resolveBundleSlot(slotKey, bundleDtv, catalog)
        if (resolution.skip) {
          pickedBySlot.delete(slotKey)
          continue
        }
        if (resolution.offeringIdOverride) {
          pickedBySlot.set(slotKey, resolution.offeringIdOverride)
        }
      }
      // Pull in optional slots the default-pass dropped but the bundle DTV
      // explicitly turns on (e.g. CDN in dev-app bundles when `cdn: true`,
      // workspace_archive when `workspace_archive: true`).
      for (const comp of components) {
        if (comp.isActive === false) continue
        // Use slot.name as the slot identity. componentGroup is shared across
// slots within a bundle (e.g. ecommerce has two `database` slots — one
// for the primary DB, one for redis cache; business has two `compute`
// slots — public website and apps host). Keying by componentGroup
// silently dropped the second of each pair.
const slotKey = comp.slot?.name ?? 'slot'
        if (pickedBySlot.has(slotKey)) continue
        const resolution = resolveBundleSlot(slotKey, bundleDtv, catalog)
        if (resolution.skip) continue
        const offeringId = resolution.offeringIdOverride ?? comp.childOfferingId
        if (!offeringId) continue
        // Only add if the resolver intentionally enabled this slot — a
        // plain "no override, no config" return means the slot wasn't on
        // the bundle's radar and we shouldn't conjure it from nothing.
        const hasIntent =
          resolution.offeringIdOverride != null ||
          Object.keys(resolution.configuration).length > 0
        if (!hasIntent) continue
        pickedBySlot.set(slotKey, offeringId)
      }

      for (const [slotKey, childOfferingId] of pickedBySlot) {
        const resolution = resolveBundleSlot(slotKey, bundleDtv, catalog)
        seeded.push({
          lineKey: `bundle-${slotKey}-${Math.random().toString(36).slice(2, 8)}`,
          offeringId: childOfferingId,
          configuration: {
            region: cart.region,
            ...resolution.configuration,
          },
          quantity: 1,
          parentLineKey: null,
          bundleSlotKey: slotKey,
        })
      }

      // Fallback: no expandable components — keep the bundle root as a single
      // line so the visitor at least sees something in the cart.
      if (seeded.length === 0) {
        seeded.push({
          lineKey: `bundle-root-${Math.random().toString(36).slice(2, 8)}`,
          offeringId: bundleOfferingId,
          configuration: { region: cart.region, ...bundleDtv },
          quantity: 1,
          parentLineKey: null,
          bundleSlotKey: 'root',
        })
      }

      // Stay on the Predefined Solutions flow so the visitor still sees their
      // chosen bundle as the active selection. The custom-flow switch is one
      // click away via the FlowSwitcher if they want full catalog control.
      cartCtx.replaceItems(seeded, bundleOfferingId)
    },
    [catalog, cart.region, cartCtx],
  )

  const openLeadForm = React.useCallback(() => {
    setSubmission({ kind: 'lead-form', loading: false, error: null })
  }, [])

  const closeLeadForm = React.useCallback(() => {
    setSubmission({ kind: 'idle' })
  }, [])

  const submitLead = React.useCallback(
    async (input: { name: string; email: string; company: string; captchaToken: string | null }) => {
      setSubmission({ kind: 'lead-form', loading: true, error: null })
      try {
        // Step 1: create / find the lead and obtain the short-lived session token.
        const leadRes = await fetch(LEADS_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, captchaToken: input.captchaToken ?? '' }),
        })
        if (!leadRes.ok) {
          const body = (await leadRes.json().catch(() => ({}))) as { error?: string }
          setSubmission({ kind: 'lead-form', loading: false, error: body.error ?? 'lead_failed' })
          return
        }
        const leadJson = (await leadRes.json()) as { quoteSessionToken: string }
        setSessionToken(leadJson.quoteSessionToken)

        // Step 2: submit the cart against the token.
        const quoteRes = await fetch(QUOTES_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${leadJson.quoteSessionToken}`,
          },
          body: JSON.stringify({
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
            notes: 'Submitted via public calculator',
          }),
        })
        if (!quoteRes.ok) {
          const body = (await quoteRes.json().catch(() => ({}))) as { error?: string }
          setSubmission({ kind: 'lead-form', loading: false, error: body.error ?? 'quote_failed' })
          return
        }
        const quoteJson = (await quoteRes.json()) as { quoteNumber?: string; quoteId?: string }
        setSubmission({ kind: 'submitted', quoteNumber: quoteJson.quoteNumber ?? quoteJson.quoteId ?? 'created' })
      } catch {
        setSubmission({ kind: 'lead-form', loading: false, error: 'network_error' })
      }
    },
    [cart],
  )

  const dismissConfirmation = React.useCallback(() => {
    setSubmission({ kind: 'idle' })
    setSessionToken(null)
    cartCtx.resetCart()
  }, [cartCtx])

  return (
    <div className="min-h-screen bg-background text-foreground" data-tenant="puffin">
      <HeroBar
        cart={cart}
        catalog={catalog}
        onRegion={cartCtx.setRegion}
        onTerm={cartCtx.setTerm}
        onCadence={cartCtx.setCadence}
        onReset={cartCtx.resetCart}
      />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {!cart.flow && <ChooserScreen onChoose={handleChoose} />}

        {cart.flow === 'solutions' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <FlowSwitcher cart={cart} onSwitch={cartCtx.setFlow} />
              {cart.fromBundle && (
                <ActiveBundlePanel
                  cart={cart}
                  catalog={catalog}
                  pricing={pricing}
                  onRemove={cartCtx.removeItem}
                  onUpdateItem={(lineKey, patch) => cartCtx.updateItem(lineKey, patch)}
                  onSwitchToCustom={() => cartCtx.setFlow('custom')}
                />
              )}
              <BundleGrid
                catalog={catalog}
                activeBundleId={cart.fromBundle}
                onUseBundle={handleUseBundle}
              />
            </div>
            <CartDrawer
              cart={cart}
              catalog={catalog}
              pricing={pricing}
              onRemove={cartCtx.removeItem}
              onCheckout={openLeadForm}
            />
          </div>
        )}

        {cart.flow === 'custom' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <FlowSwitcher cart={cart} onSwitch={cartCtx.setFlow} />
              <ProductCatalogue
                catalog={catalog}
                cart={cart}
                onAddItem={handleAddItem}
                onUpdateItem={(lineKey, patch) => cartCtx.updateItem(lineKey, patch)}
                onRemoveItem={cartCtx.removeItem}
              />
            </div>
            <CartDrawer
              cart={cart}
              catalog={catalog}
              pricing={pricing}
              onRemove={cartCtx.removeItem}
              onCheckout={openLeadForm}
            />
          </div>
        )}
      </main>

      {submission.kind === 'lead-form' && (
        <LeadFormSlideOver
          open
          loading={submission.loading}
          error={submission.error}
          captchaProvider={config.captcha.provider}
          captchaSiteKey={config.captcha.provider === 'recaptcha_v3' ? config.captcha.siteKey : null}
          onSubmit={submitLead}
          onClose={closeLeadForm}
        />
      )}
      {submission.kind === 'submitted' && (
        <ConfirmationScreen quoteNumber={submission.quoteNumber} onClose={dismissConfirmation} />
      )}

      {sessionToken && submission.kind === 'lead-form' && (
        <div className="hidden" aria-hidden data-testid="session-token-set" />
      )}
    </div>
  )
}

function FlowSwitcher({ cart, onSwitch }: { cart: Cart; onSwitch: (f: Cart['flow']) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => onSwitch('solutions')}
        className={`px-3 py-1.5 rounded-md border ${cart.flow === 'solutions' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
      >
        Predefined Solutions
      </button>
      <button
        type="button"
        onClick={() => onSwitch('custom')}
        className={`px-3 py-1.5 rounded-md border ${cart.flow === 'custom' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
      >
        Custom Solution
      </button>
    </div>
  )
}

function ActiveBundlePanel({
  cart,
  catalog,
  pricing,
  onRemove,
  onUpdateItem,
  onSwitchToCustom,
}: {
  cart: Cart
  catalog: PublicCatalog
  pricing: ReturnType<typeof usePublicPrice>
  onRemove: (lineKey: string) => void
  onUpdateItem: (lineKey: string, patch: { configuration?: Record<string, unknown>; quantity?: number }) => void
  onSwitchToCustom: () => void
}) {
  // Map offeringId → { offering, spec } for both label rendering and the
  // per-line configurator that needs both halves.
  const offeringIndex = React.useMemo(() => {
    const map = new Map<
      string,
      { offering: PublicOffering; spec: import('../types').PublicSpecification }
    >()
    for (const spec of catalog.specifications) {
      for (const offering of spec.offerings) {
        map.set(offering.id, { offering, spec })
      }
    }
    return map
  }, [catalog])

  const linesByKey = React.useMemo(() => {
    const map = new Map<string, (typeof pricing)['data'] extends infer D ? D extends { lines: infer L } ? L extends Array<infer LI> ? LI : never : never : never>()
    for (const line of pricing.data?.lines ?? []) map.set(line.lineKey, line as never)
    return map
  }, [pricing.data])

  const bundleMeta = cart.fromBundle ? offeringIndex.get(cart.fromBundle) : null
  const fmt = (val: number) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: catalog.currencyCode }).format(val)
    } catch {
      return `${catalog.currencyCode} ${val.toFixed(2)}`
    }
  }

  return (
    <section className="rounded-xl border border-primary bg-primary/5 overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-3 border-b border-primary/20">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-primary font-medium">Active bundle</div>
          <div className="font-semibold truncate">{bundleMeta?.offering.marketingName ?? 'Bundle'}</div>
          <p className="text-xs text-muted-foreground">
            Tweak individual lines below, or pick a different bundle. Switching to Custom keeps your cart.
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchToCustom}
          className="shrink-0 text-xs px-3 py-1.5 rounded-md border hover:bg-background"
        >
          Customise in catalog →
        </button>
      </header>
      <ul className="divide-y divide-primary/10">
        {cart.items.map((item) => {
          const entry = offeringIndex.get(item.offeringId)
          const line = linesByKey.get(item.lineKey)
          return (
            <BundleLineRow
              key={item.lineKey}
              item={item}
              offering={entry?.offering ?? null}
              specification={entry?.spec ?? null}
              priceLabel={line ? fmt(line.mrcTotal) : pricing.loading ? null : '—'}
              priceLoading={!line && pricing.loading}
              onRemove={() => onRemove(item.lineKey)}
              onUpdateConfiguration={(patch) =>
                onUpdateItem(item.lineKey, { configuration: { ...item.configuration, ...patch } })
              }
            />
          )
        })}
      </ul>
    </section>
  )
}

function BundleLineRow({
  item,
  offering,
  specification,
  priceLabel,
  priceLoading,
  onRemove,
  onUpdateConfiguration,
}: {
  item: CartItem
  offering: PublicOffering | null
  specification: import('../types').PublicSpecification | null
  priceLabel: string | null
  priceLoading: boolean
  onRemove: () => void
  onUpdateConfiguration: (patch: Record<string, unknown>) => void
}) {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <li className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{offering?.marketingName ?? 'Unknown'}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{displaySpecName(specification?.name)}</span>
            {item.bundleSlotKey && (
              <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase tracking-wider">
                {item.bundleSlotKey}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className="text-sm font-semibold flex items-center justify-end gap-1.5"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {priceLoading ? <Spinner /> : <span>{priceLabel ?? '—'}</span>}
          </div>
          <div className="text-[10px] text-muted-foreground">/ mo</div>
        </div>
        {offering && specification && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`bundle-line-toggle-${item.lineKey}`}
            className="text-xs px-2 py-1 rounded border bg-background hover:bg-muted shrink-0"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Configure'}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-muted-foreground hover:text-destructive shrink-0"
          aria-label="Remove"
        >
          ✕
        </button>
      </div>

      {expanded && offering && specification && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <GenericConfigurator
            offering={offering}
            specification={specification}
            configuration={item.configuration}
            onChange={onUpdateConfiguration}
          />
        </div>
      )}
    </li>
  )
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin ${className}`}
    />
  )
}
