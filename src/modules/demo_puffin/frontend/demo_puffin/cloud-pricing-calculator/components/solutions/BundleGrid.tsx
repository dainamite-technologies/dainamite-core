'use client'

import * as React from 'react'
import { ArrowRight, Box, Check, Cpu, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PublicCatalog, PublicOffering, PublicSpecification } from '../../types'
import { displaySpecName } from '../../types'

type Props = {
  catalog: PublicCatalog
  activeBundleId?: string | null
  onUseBundle: (bundleOfferingId: string) => void
}

const BUNDLE_GROUP_BY_SIZE: Record<string, 'solo' | 'standard' | 'pro'> = {
  dev_app_solo: 'solo',
  dev_app_standard: 'standard',
  dev_app_pro: 'pro',
  ecom_small_shop: 'solo',
  ecom_growing_shop: 'standard',
  ecom_high_volume: 'pro',
  biz_small_team: 'solo',
  biz_growing: 'standard',
  biz_established: 'pro',
}

const SIZE_LABEL: Record<'solo' | 'standard' | 'pro', string> = {
  solo: 'STARTER',
  standard: 'STANDARD',
  pro: 'PRO',
}

const SIZE_ORDER: Array<'solo' | 'standard' | 'pro'> = ['solo', 'standard', 'pro']

const SPEC_ICON: Record<string, LucideIcon> = {
  // Best-effort mapping by spec code; fallback Cpu.
  'SPEC-PUFFIN-DEV-APP-BUNDLE': Cpu,
  'SPEC-PUFFIN-ECOMMERCE-BUNDLE': Box,
  'SPEC-PUFFIN-BUSINESS-OFFICE-BUNDLE': Users,
}

export function BundleGrid({ catalog, activeBundleId, onUseBundle }: Props) {
  const bundleSpecs = React.useMemo(
    () => catalog.specifications.filter((s) => s.specType === 'bundle'),
    [catalog],
  )

  const initialSelected = React.useMemo(() => {
    if (!activeBundleId) return null
    for (const spec of bundleSpecs) {
      if (spec.offerings.some((o) => o.id === activeBundleId)) return spec.id
    }
    return null
  }, [bundleSpecs, activeBundleId])

  const [selectedSpecId, setSelectedSpecId] = React.useState<string | null>(initialSelected)

  React.useEffect(() => {
    setSelectedSpecId(initialSelected)
  }, [initialSelected])

  if (bundleSpecs.length === 0) {
    return <p className="pf-section-desc">No bundles available right now.</p>
  }

  const selected = selectedSpecId ? bundleSpecs.find((s) => s.id === selectedSpecId) : null

  return (
    <>
      <Stepper2
        step={selected ? 2 : 1}
        pickedSpec={selected ?? null}
        onBack={() => setSelectedSpecId(null)}
      />
      {!selected ? (
        <UseCasePicker
          specs={bundleSpecs}
          currencyCode={catalog.currencyCode}
          onPick={setSelectedSpecId}
        />
      ) : (
        <SizePicker
          spec={selected}
          currencyCode={catalog.currencyCode}
          activeBundleId={activeBundleId ?? null}
          onUseBundle={onUseBundle}
        />
      )}
    </>
  )
}

function Stepper2({
  step,
  pickedSpec,
  onBack,
}: {
  step: 1 | 2
  pickedSpec: PublicSpecification | null
  onBack: () => void
}) {
  return (
    <div className="pf-steps">
      <div className={`pf-step is-done${step === 1 ? ' is-current' : ''}`}>
        <span className="pf-step-num">01</span>
        <span className="pf-step-label">Use case</span>
        {step === 2 && pickedSpec && (
          <button type="button" className="pf-step-value" onClick={onBack}>
            {displaySpecName(pickedSpec.name)} <X size={11} aria-hidden />
          </button>
        )}
      </div>
      <div className="pf-step-line" />
      <div className={`pf-step${step >= 2 ? ' is-current' : ''}`}>
        <span className="pf-step-num">02</span>
        <span className="pf-step-label">Size</span>
      </div>
    </div>
  )
}

function fmtCurrency(val: number | null, currencyCode: string): string {
  if (val == null) return 'Custom'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(val)
  } catch {
    return `${currencyCode} ${val}`
  }
}

function lowestPrice(spec: PublicSpecification): number | null {
  let min: number | null = null
  for (const o of spec.offerings) {
    if (o.fromPriceMonthly == null) continue
    if (min == null || o.fromPriceMonthly < min) min = o.fromPriceMonthly
  }
  return min
}

function UseCasePicker({
  specs,
  currencyCode,
  onPick,
}: {
  specs: PublicSpecification[]
  currencyCode: string
  onPick: (specId: string) => void
}) {
  return (
    <section className="pf-section">
      <header className="pf-section-head">
        <h2 className="pf-section-title">Step 1 — what are you building?</h2>
        <p className="pf-section-desc">
          Pick a use case. We&apos;ll show you three sized bundles tuned for it.
        </p>
      </header>
      <div className="pf-usecase-grid">
        {specs.map((spec) => {
          const lowest = lowestPrice(spec)
          const Icon = SPEC_ICON[spec.code] ?? Cpu
          return (
            <button
              key={spec.id}
              type="button"
              data-testid={`use-case-${spec.code}`}
              className="pf-usecase-card"
              onClick={() => onPick(spec.id)}
            >
              <div className="pf-usecase-head">
                <div className="pf-usecase-icon">
                  <Icon size={20} aria-hidden />
                </div>
                <span className="pf-usecase-aud">{spec.offerings.length} packages</span>
              </div>
              <h3 className="pf-usecase-name">{displaySpecName(spec.name)}</h3>
              <p className="pf-usecase-desc">
                {spec.tagline || 'A curated stack tuned for this scenario.'}
              </p>
              <div className="pf-usecase-foot">
                <span className="pf-usecase-from">
                  from{' '}
                  <span className="pf-mono">{fmtCurrency(lowest, currencyCode)}</span> / mo
                </span>
                <span className="pf-usecase-cta">
                  Choose <ArrowRight size={13} aria-hidden />
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function SizePicker({
  spec,
  currencyCode,
  activeBundleId,
  onUseBundle,
}: {
  spec: PublicSpecification
  currencyCode: string
  activeBundleId: string | null
  onUseBundle: (id: string) => void
}) {
  const bySize = React.useMemo(() => {
    const map = new Map<'solo' | 'standard' | 'pro', PublicOffering>()
    for (const o of spec.offerings) {
      const size = BUNDLE_GROUP_BY_SIZE[o.code] ?? 'standard'
      map.set(size, o)
    }
    return map
  }, [spec])

  return (
    <section className="pf-section">
      <header className="pf-section-head">
        <h2 className="pf-section-title">
          Step 2 — pick a size for{' '}
          <em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>{displaySpecName(spec.name)}</em>
        </h2>
        {spec.tagline && <p className="pf-section-desc">{spec.tagline}</p>}
      </header>
      <div className="pf-bundle-grid">
        {SIZE_ORDER.map((size) => (
          <SizeCard
            key={size}
            tier={SIZE_LABEL[size]}
            offering={bySize.get(size) ?? null}
            currencyCode={currencyCode}
            isInCart={!!activeBundleId && bySize.get(size)?.id === activeBundleId}
            onUseBundle={onUseBundle}
          />
        ))}
      </div>
    </section>
  )
}

function SizeCard({
  tier,
  offering,
  currencyCode,
  isInCart,
  onUseBundle,
}: {
  tier: string
  offering: PublicOffering | null
  currencyCode: string
  isInCart: boolean
  onUseBundle: (id: string) => void
}) {
  if (!offering) {
    return (
      <div
        className="pf-bundle-card"
        style={{
          borderStyle: 'dashed',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 220,
          color: 'var(--ink-4)',
          fontSize: 12,
        }}
      >
        {tier} — Coming soon
      </div>
    )
  }

  return (
    <div className={`pf-bundle-card${isInCart ? ' is-in-cart' : ''}`}>
      <div className="pf-bundle-tier">{tier}</div>
      <div className="pf-bundle-name">{offering.marketingName}</div>
      <p className="pf-bundle-blurb">{offering.description ?? ''}</p>
      <div className="pf-bundle-price">
        <span className="pf-price-num">{fmtCurrency(offering.fromPriceMonthly, currencyCode)}</span>
        <span className="pf-price-suffix">/ mo</span>
      </div>
      <button
        type="button"
        data-testid={`use-bundle-${offering.code}`}
        onClick={() => onUseBundle(offering.id)}
        className={`pf-btn pf-btn--primary${isInCart ? ' is-in-cart' : ''}`}
      >
        {isInCart ? (
          <>
            <Check size={14} aria-hidden /> Added to cart
          </>
        ) : (
          'Use this bundle'
        )}
      </button>
    </div>
  )
}
