'use client'

import * as React from 'react'
import {
  Activity,
  BadgeCheck,
  Box,
  Check,
  ChevronDown,
  Cpu,
  Database,
  Globe,
  HardDrive,
  LifeBuoy,
  Network,
  Plus,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

  React.useEffect(() => {
    if (inCartCount > 0) setOpen(true)
  }, [inCartCount])

  const Icon = SPEC_ICON[spec.code] ?? Server
  const lowest = lowestFromPrice(spec)
  const hasLine = inCartCount > 0
  const summaryPrice = lowest != null ? formatPrice(lowest, currencyCode) : null

  return (
    <section
      data-testid={`spec-row-${spec.code}`}
      className={`pf-product${open ? ' is-expanded' : ''}${hasLine ? ' has-line' : ''}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="pf-product-head"
      >
        <span className="pf-product-icon">
          <Icon size={18} aria-hidden />
        </span>
        <div>
          <h3 className="pf-product-name">
            {displaySpecName(spec.name)}
            {inCartCount > 0 && <span className="pf-chip">{inCartCount} in cart</span>}
          </h3>
          {spec.tagline && <p className="pf-product-spec">{spec.tagline}</p>}
        </div>
        <div className="pf-product-meta">
          {summaryPrice ? (
            <span className="pf-product-from">
              from <span className="pf-mono">{summaryPrice}</span>
            </span>
          ) : (
            <span className="pf-price-conf">Configure to price</span>
          )}
          <ChevronDown className="pf-chevron" size={16} aria-hidden />
        </div>
      </button>

      {open && (
        <div className="pf-product-body">
          <div className="pf-options">
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
    <div className={`pf-option${inCart ? ' is-active' : ''}`}>
      <div className="pf-option-head">
        <div>
          <div className="pf-option-name">{offering.marketingName}</div>
          {offering.description && (
            <div className="pf-option-detail">{offering.description}</div>
          )}
        </div>
        <div className="pf-option-price">
          {offering.fromPriceMonthly != null ? (
            <>
              <span className="pf-price-num">{formatPrice(offering.fromPriceMonthly, currencyCode)}</span>
              <span className="pf-price-suffix">/ mo</span>
            </>
          ) : (
            <span className="pf-price-conf">Configure to price</span>
          )}
        </div>
      </div>

      {expanded && editingLine && (
        <div
          style={{
            paddingTop: 10,
            borderTop: '1px dashed var(--line)',
          }}
        >
          <GenericConfigurator
            offering={offering}
            specification={spec}
            configuration={editingLine.configuration}
            onChange={(patch) => {
              onUpdateItem(editingLine.lineKey, {
                configuration: { ...editingLine.configuration, ...patch },
              })
            }}
          />
        </div>
      )}

      <div className="pf-option-actions">
        {inCart ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="pf-btn pf-btn--ghost pf-btn--sm"
            >
              {expanded ? 'Hide options' : 'Configure'}
            </button>
            <span className="pf-pill">
              <Check size={12} aria-hidden /> in cart
            </span>
            <button
              type="button"
              onClick={() => editingLine && onRemoveItem(editingLine.lineKey)}
              className="pf-btn pf-btn--ghost pf-btn--sm"
              style={{ marginLeft: 'auto' }}
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
            className="pf-btn pf-btn--primary pf-btn--sm"
            style={{ width: 'auto' }}
          >
            <Plus size={12} aria-hidden /> Add to cart
          </button>
        )}
      </div>
    </div>
  )
}
