'use client'

import * as React from 'react'
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

const SIZE_LABEL: Record<string, string> = {
  solo: 'Starter',
  standard: 'Standard',
  pro: 'Pro',
}

const SIZE_ORDER: Array<'solo' | 'standard' | 'pro'> = ['solo', 'standard', 'pro']

export function BundleGrid({ catalog, activeBundleId, onUseBundle }: Props) {
  const bundleSpecs = React.useMemo(
    () => catalog.specifications.filter((s) => s.specType === 'bundle'),
    [catalog],
  )

  // If a bundle is already in cart, auto-select the spec it belongs to so the
  // visitor lands directly on the size picker for that use-case.
  const initialSelected = React.useMemo(() => {
    if (!activeBundleId) return null
    for (const spec of bundleSpecs) {
      if (spec.offerings.some((o) => o.id === activeBundleId)) return spec.id
    }
    return null
  }, [bundleSpecs, activeBundleId])

  const [selectedSpecId, setSelectedSpecId] = React.useState<string | null>(initialSelected)

  // Re-sync selection when the active bundle changes (e.g. after Reset).
  React.useEffect(() => {
    setSelectedSpecId(initialSelected)
  }, [initialSelected])

  if (bundleSpecs.length === 0) {
    return <p className="text-sm text-muted-foreground">No bundles available right now.</p>
  }

  const selected = selectedSpecId ? bundleSpecs.find((s) => s.id === selectedSpecId) : null

  if (!selected) {
    return (
      <UseCasePicker
        specs={bundleSpecs}
        currencyCode={catalog.currencyCode}
        onPick={setSelectedSpecId}
      />
    )
  }

  return (
    <SizePicker
      spec={selected}
      currencyCode={catalog.currencyCode}
      activeBundleId={activeBundleId ?? null}
      onBack={() => setSelectedSpecId(null)}
      onUseBundle={onUseBundle}
    />
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
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Step 1 — What's the use-case?</h2>
        <p className="text-sm text-muted-foreground">
          Pick the scenario closest to yours. Next step lets you choose a size.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {specs.map((spec) => {
          const lowest = lowestPrice(spec)
          return (
            <button
              key={spec.id}
              type="button"
              data-testid={`use-case-${spec.code}`}
              onClick={() => onPick(spec.id)}
              className="group w-full text-left rounded-xl border bg-card p-5 hover:border-primary hover:shadow-sm transition-all flex items-center gap-5"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="font-semibold text-lg leading-tight">{displaySpecName(spec.name)}</h3>
                {spec.tagline && (
                  <p className="text-xs italic text-muted-foreground">{spec.tagline}</p>
                )}
                <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1">
                  <span>{spec.offerings.length} packages</span>
                  {lowest != null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        from{' '}
                        <span
                          className="font-medium text-foreground"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {fmtCurrency(lowest, currencyCode)}
                        </span>{' '}
                        / mo
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                Choose this use-case
                <span aria-hidden>→</span>
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
  onBack,
  onUseBundle,
}: {
  spec: PublicSpecification
  currencyCode: string
  activeBundleId: string | null
  onBack: () => void
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
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden>←</span> Back to use-cases
        </button>
        <span className="text-xs text-muted-foreground">Step 2 — Pick a size</span>
      </div>

      <header className="rounded-xl border bg-muted/30 px-5 py-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="font-semibold text-lg">{displaySpecName(spec.name)}</h2>
          {spec.tagline && (
            <span className="text-xs italic text-muted-foreground">{spec.tagline}</span>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {SIZE_ORDER.map((size) => (
          <SizeCard
            key={size}
            sizeLabel={SIZE_LABEL[size]}
            offering={bySize.get(size) ?? null}
            currencyCode={currencyCode}
            isActive={!!activeBundleId && bySize.get(size)?.id === activeBundleId}
            onUseBundle={onUseBundle}
          />
        ))}
      </div>
    </section>
  )
}

function SizeCard({
  sizeLabel,
  offering,
  currencyCode,
  isActive,
  onUseBundle,
}: {
  sizeLabel: string
  offering: PublicOffering | null
  currencyCode: string
  isActive: boolean
  onUseBundle: (id: string) => void
}) {
  if (!offering) {
    return (
      <div className="rounded-xl border-2 border-dashed p-5 text-center text-xs text-muted-foreground min-h-[200px] flex items-center justify-center">
        {sizeLabel} — Coming soon
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border bg-card p-5 flex flex-col gap-4 transition-shadow ${
        isActive ? 'border-primary shadow-sm ring-1 ring-primary/20' : 'hover:shadow-sm'
      }`}
    >
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {sizeLabel}
        </div>
        <div className="font-semibold text-lg leading-tight">{offering.marketingName}</div>
        {offering.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">{offering.description}</p>
        )}
      </div>

      <div className="tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {offering.fromPriceMonthly != null && (
          <span className="text-xs font-normal text-muted-foreground mr-1">from</span>
        )}
        <span className="text-3xl font-bold">{fmtCurrency(offering.fromPriceMonthly, currencyCode)}</span>
        <span className="text-xs font-normal text-muted-foreground"> / mo</span>
      </div>

      <button
        type="button"
        data-testid={`use-bundle-${offering.code}`}
        onClick={() => onUseBundle(offering.id)}
        className={`mt-auto w-full inline-flex items-center justify-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        }`}
      >
        {isActive ? 'Currently selected' : 'Use this bundle'}
      </button>
    </div>
  )
}
