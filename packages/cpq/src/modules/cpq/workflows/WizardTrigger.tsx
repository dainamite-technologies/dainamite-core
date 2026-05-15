'use client'

import React, { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WizardDefinitionResult } from './types'

// ─── API helper ─────────────────────────────────────────────────

async function apiJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Props ──────────────────────────────────────────────────────

export interface WizardTriggerProps {
  /** Explicit wizard definition code. If set, uses this wizard directly. */
  wizardCode?: string
  /** Offering code for wizard resolution (when no explicit wizard). */
  offeringCode?: string
  /** Launch params passed to the wizard engine. */
  params?: Record<string, unknown>
  /** Surface context. */
  surface?: 'backend' | 'portal'
  /** Button label. */
  label?: string
  /** Render variant. */
  variant?: 'button' | 'link' | 'card'
  /** Additional CSS class. */
  className?: string
  /** Override the navigation target base path. */
  basePath?: string
  /** Called after wizard is resolved (instead of navigating). */
  onStart?: (definition: WizardDefinitionResult, params: Record<string, unknown>) => void
}

export function WizardTrigger({
  wizardCode,
  offeringCode,
  params: wizardParams = {},
  surface = 'backend',
  label = 'Start Wizard',
  variant = 'button',
  className,
  basePath,
  onStart,
}: WizardTriggerProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Resolve definition
      let definition: WizardDefinitionResult | null = null

      if (wizardCode) {
        definition = await apiJson<WizardDefinitionResult>(
          `/api/cpq/wizards?code=${encodeURIComponent(wizardCode)}`,
        )
      } else {
        const resolveParams = new URLSearchParams({ surface })
        if (offeringCode) resolveParams.set('offeringCode', offeringCode)
        definition = await apiJson<WizardDefinitionResult>(
          `/api/cpq/wizards/resolve?${resolveParams}`,
        )
      }

      if (!definition) {
        setError('No matching wizard found')
        return
      }

      if (onStart) {
        onStart(definition, wizardParams)
      } else {
        const path = basePath ?? (surface === 'portal' ? '/wizards' : '/backend/cpq/wizards')
        const queryParams = new URLSearchParams()
        if (Object.keys(wizardParams).length > 0) {
          queryParams.set('params', JSON.stringify(wizardParams))
        }
        const qs = queryParams.toString()
        router.push(`${path}/${definition.code}${qs ? `?${qs}` : ''}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start wizard')
    } finally {
      setLoading(false)
    }
  }, [wizardCode, offeringCode, wizardParams, surface, basePath, onStart, router])

  if (variant === 'link') {
    return (
      <a
        href="#"
        className={className ?? 'text-sm text-primary hover:underline'}
        onClick={(e) => {
          e.preventDefault()
          handleClick()
        }}
      >
        {loading ? 'Starting...' : label}
        {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      </a>
    )
  }

  if (variant === 'card') {
    return (
      <div
        className={className ?? 'rounded-lg border p-4 cursor-pointer hover:shadow-sm transition-shadow'}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
      >
        <p className="font-semibold text-sm">{label}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  // Default: button
  return (
    <button
      type="button"
      className={className ?? 'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? 'Starting...' : label}
      {error && <span className="ml-2 text-xs text-destructive/70">{error}</span>}
    </button>
  )
}
