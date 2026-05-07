'use client'

import * as React from 'react'
import Image from 'next/image'
import { Check, ChevronDown } from 'lucide-react'
import type { Cart, PublicCatalog } from '../../types'
import puffinLogo from '../../assets/puffin-cloud-logo.png'

type Props = {
  cart: Cart
  catalog: PublicCatalog
  onRegion: (region: string) => void
  onReset: () => void
}

// Flag emoji by region-code prefix. The catalog API only returns
// `{ code, label }` so we infer the country from the conventional code prefix
// (`fra*` = Frankfurt = DE). Falls back to a globe.
const FLAG_BY_PREFIX: Array<[RegExp, string]> = [
  [/^fra/i, '🇩🇪'],
  [/^ams/i, '🇳🇱'],
  [/^lon|^lhr/i, '🇬🇧'],
  [/^par|^cdg/i, '🇫🇷'],
  [/^nyc|^iad|^sfo|^sjc|^lax|^ord/i, '🇺🇸'],
  [/^tor|^yyz/i, '🇨🇦'],
  [/^syd/i, '🇦🇺'],
  [/^sin|^sgp/i, '🇸🇬'],
  [/^tok|^nrt|^hnd/i, '🇯🇵'],
]

function flagFor(code: string): string {
  for (const [re, flag] of FLAG_BY_PREFIX) if (re.test(code)) return flag
  return '🌐'
}

export function HeroBar({ cart, catalog, onRegion, onReset }: Props) {
  const hasState = cart.flow !== null || cart.items.length > 0
  return (
    <header className="pf-header">
      <div className="pf-header-inner">
        <div className="pf-brand">
          <Image src={puffinLogo} alt="" width={48} height={48} priority className="pf-brand-mark" />
          <span className="pf-brand-name">Puffin Cloud</span>
        </div>

        <div className="pf-controls">
          <div className="pf-ctl-group">
            <span className="pf-ctl-label">Region</span>
            <RegionSelect
              regions={catalog.regions}
              value={cart.region}
              onChange={onRegion}
            />
          </div>

          <CurrencySelect value={catalog.currencyCode} />

          <button
            type="button"
            onClick={onReset}
            disabled={!hasState}
            data-testid="reset-calculator"
            title="Clear cart and start fresh"
            className={`pf-reset${hasState ? ' is-active' : ''}`}
          >
            Reset
          </button>
        </div>
      </div>
    </header>
  )
}

function RegionSelect({
  regions,
  value,
  onChange,
}: {
  regions: Array<{ code: string; label: string }>
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const current = regions.find((r) => r.code === value) ?? regions[0]

  return (
    <div className="pf-select" ref={ref}>
      <button
        type="button"
        className="pf-select-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pf-flag" aria-hidden>
          {current ? flagFor(current.code) : '🌐'}
        </span>
        <span>{current?.label ?? 'Region'}</span>
        {current && <span className="pf-mono-dim"> · {current.code}</span>}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="pf-select-menu" role="listbox">
          {regions.map((r) => (
            <button
              key={r.code}
              type="button"
              role="option"
              aria-selected={r.code === value}
              className={`pf-select-opt${r.code === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(r.code)
                setOpen(false)
              }}
            >
              <span>
                <span className="pf-flag" aria-hidden>{flagFor(r.code)}</span> {r.label}{' '}
                <span className="pf-mono-dim">· {r.code}</span>
              </span>
              {r.code === value && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CurrencySelect({ value }: { value: string }) {
  // Display-only — the catalog is currency-locked. Rendered as a disabled
  // dropdown trigger so the visual rhythm of the controls bar still reads as
  // a row of selects.
  return (
    <div className="pf-select">
      <button type="button" className="pf-select-trigger" disabled>
        <span>{value}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
    </div>
  )
}
