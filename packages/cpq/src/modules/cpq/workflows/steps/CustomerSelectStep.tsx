'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { WizardStepProps } from '../types'

type Customer = {
  id: string
  name: string
  email?: string
  segment?: string
}

export function CustomerSelectStep({ config, onComplete, onBack, stepData, currentStepId, completedSteps }: WizardStepProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(false)

  // Restore previous selection if returning to this step
  const previousData = stepData[currentStepId] as { customerId?: string; customerName?: string } | undefined
  useEffect(() => {
    if (previousData?.customerId && previousData?.customerName) {
      setSelected({ id: previousData.customerId, name: previousData.customerName })
    }
  }, [previousData?.customerId, previousData?.customerName])

  const segmentFilter = (config.segmentFilter as string[]) ?? []

  const handleSearch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/customers/companies?${params}`)
      if (res.ok) {
        const data = await res.json()
        let items = ((data.items ?? data) as Array<Record<string, unknown>>).map((c) => ({
          id: c.id as string,
          name: (c.display_name ?? c.displayName ?? c.name ?? '') as string,
          email: (c.primary_email ?? c.email ?? '') as string,
          segment: (c.lifecycle_stage ?? c.segment ?? '') as string,
        })) as Customer[]
        if (segmentFilter.length > 0) {
          items = items.filter((c) => c.segment && segmentFilter.includes(c.segment))
        }
        setCustomers(items)
      }
    } finally {
      setLoading(false)
    }
  }, [search, segmentFilter])

  useEffect(() => {
    handleSearch()
  }, []) // Load initial list on mount

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {selected && (
        <div className="rounded-md border-2 border-primary bg-primary/5 p-3 flex items-center justify-between">
          <span className="text-sm">
            <strong>Selected:</strong> {selected.name}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
        {customers.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelected(c)}
            className={`rounded-md border p-3 cursor-pointer transition-colors ${
              selected?.id === c.id
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/30'
            }`}
          >
            <span className="font-medium text-sm">{c.name}</span>
            {c.email && <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>}
          </div>
        ))}
        {customers.length === 0 && !loading && (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No customers found.
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (selected) {
              onComplete({ customerId: selected.id, customerName: selected.name })
            }
          }}
          disabled={!selected}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}
