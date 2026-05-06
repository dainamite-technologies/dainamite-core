'use client'

import * as React from 'react'
import {
  Activity,
  BadgeCheck,
  Box,
  ChevronDown,
  Cpu,
  Database,
  Globe,
  HardDrive,
  LifeBuoy,
  Network,
  Server,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Cart, PublicCatalog, PublicSpecification, PublicOffering } from '../../types'
import { displaySpecName } from '../../types'
import { GenericConfigurator } from '../configurator/GenericConfigurator'

type Props = {
  catalog: PublicCatalog
  cart: Cart
  onAddItem: (offeringId: string, configuration: Record<string, unknown>) => void
  onUpdateItem: (lineKey: string, patch: { configuration?: Record<string, unknown>; quantity?: number }) => void
  onRemoveItem: (lineKey: string) => void
}

// Display order from specs/sample-use-cases/cloud-services-provider-requirements.md
// section "# Products". Specs not listed here are pushed to the bottom in
// catalog order, which keeps the page deterministic if a new product gets
// seeded before the constant is updated.
const SPEC_DISPLAY_ORDER: Record<string, number> = {
  'SPEC-PUFFIN-VPS': 1,
  'SPEC-PUFFIN-COMPUTE': 2,
  'SPEC-PUFFIN-BLOCK-STORAGE': 3,
  'SPEC-PUFFIN-OBJECT-STORAGE': 4,
  'SPEC-PUFFIN-CDN': 5,
  'SPEC-PUFFIN-API-GATEWAY': 6,
  'SPEC-PUFFIN-DDOS': 7,
  'SPEC-PUFFIN-MANAGED-DB': 8,
  'SPEC-PUFFIN-WORKSPACE': 9,
  'SPEC-PUFFIN-BANDWIDTH': 10,
  'SPEC-PUFFIN-SUPPORT': 11,
  'SPEC-PUFFIN-PREMIUM-SUPPORT': 12,
}

const SPEC_ICON: Record<string, LucideIcon> = {
  'SPEC-PUFFIN-VPS': Server,
  'SPEC-PUFFIN-COMPUTE': Cpu,
  'SPEC-PUFFIN-BLOCK-STORAGE': HardDrive,
  'SPEC-PUFFIN-OBJECT-STORAGE': Box,
  'SPEC-PUFFIN-CDN': Globe,
  'SPEC-PUFFIN-API-GATEWAY': Network,
  'SPEC-PUFFIN-DDOS': Shield,
  'SPEC-PUFFIN-MANAGED-DB': Database,
  'SPEC-PUFFIN-WORKSPACE': Users,
  'SPEC-PUFFIN-BANDWIDTH': Activity,
  'SPEC-PUFFIN-SUPPORT': LifeBuoy,
  'SPEC-PUFFIN-PREMIUM-SUPPORT': BadgeCheck,
}

function specOrder(code: string, fallback: number): number {
  return SPEC_DISPLAY_ORDER[code] ?? 1000 + fallback
}

function formatPrice(value: number | null, currency: string): string | null {
  if (value == null) return null
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: value < 100 ? 2 : 0,
    }).format(value)
  } catch {
    return `${currency} ${value}`
  }
}

function lowestFromPrice(spec: PublicSpecification): number | null {
  let min: number | null = null
  for (const o of spec.offerings) {
    if (o.fromPriceMonthly == null) continue
    if (min == null || o.fromPriceMonthly < min) min = o.fromPriceMonthly
  }
  return min
}

export function ProductCatalogue({ catalog, cart, onAddItem, onUpdateItem, onRemoveItem }: Props) {
  // Surface only product specs in the custom flow — bundles live in the
  // Predefined Solutions screen and would otherwise clutter the catalogue.
  const productSpecs = React.useMemo(() => {
    const list = catalog.specifications.filter((s) => s.specType !== 'bundle')
    return [...list].sort((a, b) => specOrder(a.code, list.indexOf(a)) - specOrder(b.code, list.indexOf(b)))
  }, [catalog])

  const cartLinesByOffering = React.useMemo(() => {
    const map = new Map<string, Cart['items']>()
    for (const item of cart.items) {
      const list = map.get(item.offeringId) ?? []
      list.push(item)
      map.set(item.offeringId, list)
    }
    return map
  }, [cart])

  return (
    <div className="space-y-3">
      {productSpecs.map((spec) => {
        const inCartCount = spec.offerings.reduce(
          (acc, o) => acc + (cartLinesByOffering.get(o.id)?.length ?? 0),
          0,
        )
        return (
          <SpecRow
            key={spec.id}
            spec={spec}
            currencyCode={catalog.currencyCode}
            cartLinesByOffering={cartLinesByOffering}
            inCartCount={inCartCount}
            defaultOpen={inCartCount > 0}
            onAddItem={onAddItem}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
          />
        )
      })}
    </div>
  )
}

function SpecRow({
  spec,
  currencyCode,
  cartLinesByOffering,
  inCartCount,
  defaultOpen,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: {
  spec: PublicSpecification
  currencyCode: string
  cartLinesByOffering: Map<string, Cart['items']>
  inCartCount: number
  defaultOpen: boolean
  onAddItem: Props['onAddItem']
  onUpdateItem: Props['onUpdateItem']
  onRemoveItem: Props['onRemoveItem']
}) {
  const [open, setOpen] = React.useState(defaultOpen)

  // Re-open if the spec gains an in-cart offering from elsewhere (e.g.
  // bundle expansion) so visitors can see what's been added.
  React.useEffect(() => {
    if (inCartCount > 0) setOpen(true)
  }, [inCartCount])

  const Icon = SPEC_ICON[spec.code] ?? Server
  const lowest = lowestFromPrice(spec)
  const isHighlighted = inCartCount > 0
  const summaryPrice = lowest != null ? formatPrice(lowest, currencyCode) : null

  const isPlanGrid = spec.uiPattern === 'plan_grid' || spec.uiPattern === 'three_tier_compare'

  return (
    <section
      data-testid={`spec-row-${spec.code}`}
      className={`rounded-xl border bg-card overflow-hidden transition-colors ${
        isHighlighted ? 'border-primary' : 'hover:border-foreground/20'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left flex items-center gap-4 px-4 py-4"
      >
        <div
          className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
            isHighlighted ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground/70'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold">{displaySpecName(spec.name)}</span>
            {inCartCount > 0 && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
                {inCartCount} in cart
              </span>
            )}
          </div>
          {spec.tagline && (
            <p className="text-xs text-muted-foreground truncate">{spec.tagline}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {summaryPrice ? (
            <div className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="text-muted-foreground">from </span>
              <span className="font-semibold">{summaryPrice}</span>
              <span className="text-xs text-muted-foreground"> / mo</span>
            </div>
          ) : (
            <span className="text-xs italic text-muted-foreground">Configure to price</span>
          )}
        </div>

        <ChevronDown
          className={`shrink-0 h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t bg-muted/20">
          <div className={isPlanGrid ? 'grid sm:grid-cols-2 gap-3 p-4' : 'flex flex-col gap-3 p-4'}>
            {spec.offerings.map((offering) => (
              <OfferingCard
                key={offering.id}
                spec={spec}
                offering={offering}
                currencyCode={currencyCode}
                cartLines={cartLinesByOffering.get(offering.id) ?? []}
                onAddItem={onAddItem}
                onUpdateItem={onUpdateItem}
                onRemoveItem={onRemoveItem}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function OfferingCard({
  spec,
  offering,
  currencyCode,
  cartLines,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: {
  spec: PublicSpecification
  offering: PublicOffering
  currencyCode: string
  cartLines: Cart['items']
  onAddItem: Props['onAddItem']
  onUpdateItem: Props['onUpdateItem']
  onRemoveItem: Props['onRemoveItem']
}) {
  const inCart = cartLines.length > 0
  const [expanded, setExpanded] = React.useState(false)

  // For multi-instance offerings (compute, vps), each cart line is independent.
  // For single-instance offerings (workspace), we keep one line and edit in place.
  const editingLine = inCart ? cartLines[0] : null

  return (
    <div
      className={`rounded-lg border bg-card p-4 transition-all ${
        inCart ? 'border-primary ring-1 ring-primary/20' : 'hover:border-foreground/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{offering.marketingName}</span>
            {inCart && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                ✓ in cart
              </span>
            )}
          </div>
          {offering.description && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{offering.description}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          {offering.fromPriceMonthly != null ? (
            <>
              <div className="text-base font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(offering.fromPriceMonthly, currencyCode)}
              </div>
              <div className="text-[11px] text-muted-foreground">from / mo</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground italic">Configure to price</div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <GenericConfigurator
            offering={offering}
            specification={spec}
            configuration={editingLine?.configuration ?? {}}
            onChange={(patch) => {
              if (editingLine) {
                onUpdateItem(editingLine.lineKey, {
                  configuration: { ...editingLine.configuration, ...patch },
                })
              }
            }}
          />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {inCart ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs px-2.5 py-1.5 rounded-md border bg-background hover:bg-muted"
            >
              {expanded ? 'Hide options' : 'Configure'}
            </button>
            <button
              type="button"
              onClick={() => editingLine && onRemoveItem(editingLine.lineKey)}
              className="text-xs px-2.5 py-1.5 rounded-md border bg-background hover:bg-destructive/10 hover:text-destructive ml-auto"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid={`add-${offering.code}`}
            onClick={() => {
              onAddItem(offering.id, {})
              setExpanded(true)
            }}
            className="text-xs px-3 py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            + Add to cart
          </button>
        )}
      </div>
    </div>
  )
}
