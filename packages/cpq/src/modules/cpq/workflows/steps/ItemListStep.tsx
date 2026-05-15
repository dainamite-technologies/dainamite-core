'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { WizardStepProps } from '../types'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'

type QuoteLine = {
  lineId: string
  offeringId: string | null
  offeringName: string
  quantity: number
  nrcTotal: number
  mrcTotal: number
  isConfigured: boolean
  parentLineId: string | null
}

function fmt(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

export function ItemListStep({ config, onComplete, onBack, stepData, completedSteps, quoteId }: WizardStepProps) {
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [loading, setLoading] = useState(true)

  const parentLineSource = config.parentLineSource as string | undefined
  const minItems = (config.minItems as number) ?? 0
  const maxItems = (config.maxItems as number) ?? Infinity
  const showPricing = config.showPricing !== false

  const parentLineId = parentLineSource
    ? (stepData[parentLineSource]?.lineId as string | undefined)
    : undefined

  const loadLines = useCallback(async () => {
    if (!quoteId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/cpq/quotes/${quoteId}`)
      if (res.ok) {
        const data = await res.json()
        const allLines = (data.lines ?? []) as QuoteLine[]
        // Filter to children of the parent line (if parentLineId set), otherwise show all
        const filtered = parentLineId
          ? allLines.filter((l) => l.parentLineId === parentLineId)
          : allLines
        setLines(filtered)
      }
    } finally {
      setLoading(false)
    }
  }, [quoteId, parentLineId])

  useEffect(() => { loadLines() }, [loadLines])

  const handleRemove = useCallback(async (lineId: string) => {
    if (!quoteId) return
    await fetch(`/api/cpq/quotes/${quoteId}/items/${lineId}`, { method: 'DELETE' })
    await loadLines()
  }, [quoteId, loadLines])

  const canProceed = lines.length >= minItems
  const canAddMore = lines.length < maxItems

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {lines.length} item{lines.length !== 1 ? 's' : ''}
          {minItems > 0 && ` (min: ${minItems})`}
          {maxItems < Infinity && ` (max: ${maxItems})`}
        </span>
        {canAddMore && (
          <span className="text-xs text-muted-foreground">
            Use the offering browser to add items to the quote, then return here.
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading items...</div>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => (
            <div
              key={line.lineId}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <span className="text-sm font-medium">{line.offeringName}</span>
                {line.quantity > 1 && <span className="ml-2 text-xs text-muted-foreground">x{line.quantity}</span>}
                {!line.isConfigured && (
                  <Tag variant="warning" className="ml-2">
                    Needs configuration
                  </Tag>
                )}
              </div>
              <div className="flex items-center gap-3">
                {showPricing && (
                  <span className="text-xs">
                    {fmt(line.nrcTotal)} NRC / {fmt(line.mrcTotal)} MRC
                  </span>
                )}
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="sm"
                  onClick={() => handleRemove(line.lineId)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No items added yet.
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Back
          </button>
        )}
        <button type="button" onClick={loadLines} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
          Refresh
        </button>
        <button
          type="button"
          onClick={() => {
            onComplete({ lineCount: lines.length, lineIds: lines.map((l) => l.lineId) })
          }}
          disabled={!canProceed}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}
