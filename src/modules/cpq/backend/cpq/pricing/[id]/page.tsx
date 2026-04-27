"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams, useRouter } from 'next/navigation'

type Dimension = { key: string; label: string }
type PriceColumn = { key: string; label: string }

type PricingTable = {
  id: string
  code: string
  name: string
  dimensions: Dimension[]
  priceColumns: PriceColumn[]
  currencyCodeList: string[]
  isActive: boolean
}

type Entry = {
  id: string
  dimensionValues: Record<string, string>
  tierNumber: number | null
  rangeFrom: string | null
  rangeTo: string | null
  currencyCode: string
  prices: Record<string, number>
}

export default function PricingTableDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const urlParams = useParams()
  const id = (props.params?.id ?? urlParams?.id) as string

  const [table, setTable] = React.useState<PricingTable | null>(null)
  const [entries, setEntries] = React.useState<Entry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!id) return
    if (id === 'undefined' || !/^[0-9a-f-]{36}$/i.test(id)) {
      setError('Invalid pricing table ID')
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`/api/cpq/pricing-tables?id=${encodeURIComponent(id)}`)

        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setTable(data)
            setEntries(data.entries ?? [])
          }
        } else if (!cancelled) {
          setError('Pricing table not found')
        }
      } catch (err) {
        console.error('Failed to load pricing table', err)
        if (!cancelled) setError('Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (error || !table) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/backend/cpq/pricing')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('common.back', 'Back')}
        </button>
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error ?? 'Not found'}
        </div>
      </div>
    )
  }

  const hasTieredEntries = entries.some((e) => e.tierNumber != null)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/backend/cpq/pricing')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('common.back', 'Back')}
        </button>
        <h1 className="text-2xl font-bold">{table.name}</h1>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            table.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {table.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
        </span>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs mb-1">Code</div>
            <div className="font-medium">{table.code}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Currencies</div>
            <div className="font-medium">{table.currencyCodeList?.join(', ') ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Dimensions</div>
            <div className="font-medium">
              {table.dimensions.map((d) => d.label).join(', ') || '—'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Price Columns</div>
            <div className="font-medium">
              {table.priceColumns.map((p) => p.label).join(', ') || '—'}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">
          {t('cpq.pricing.entries', 'Entries')} ({entries.length})
        </h2>

        {entries.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('cpq.pricing.noEntries', 'No entries in this pricing table.')}
          </div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {hasTieredEntries && (
                    <>
                      <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Tier #</th>
                      <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Range From</th>
                      <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Range To</th>
                    </>
                  )}
                  {table.dimensions.map((dim) => (
                    <th key={dim.key} className="px-3 py-3 text-left font-medium whitespace-nowrap">
                      {dim.label}
                    </th>
                  ))}
                  {table.priceColumns.map((col) => (
                    <th key={col.key} className="px-3 py-3 text-right font-medium whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left font-medium">Currency</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-muted/30">
                    {hasTieredEntries && (
                      <>
                        <td className="px-3 py-2">{entry.tierNumber ?? '—'}</td>
                        <td className="px-3 py-2">{entry.rangeFrom ?? '—'}</td>
                        <td className="px-3 py-2">{entry.rangeTo ?? '—'}</td>
                      </>
                    )}
                    {table.dimensions.map((dim) => (
                      <td key={dim.key} className="px-3 py-2">
                        {entry.dimensionValues?.[dim.key] ?? '—'}
                      </td>
                    ))}
                    {table.priceColumns.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-right font-mono">
                        {entry.prices?.[col.key] != null
                          ? Number(entry.prices[col.key]).toFixed(2)
                          : '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2">{entry.currencyCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
