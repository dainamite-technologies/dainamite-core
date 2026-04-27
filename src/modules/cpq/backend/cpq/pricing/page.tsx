"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'

type PricingTable = {
  id: string
  code: string
  name: string
  priceColumns: Array<{ key: string; label: string }>
  currencyCodeList: string[]
  isActive: boolean
}

export default function PricingTablesPage() {
  const t = useT()
  const router = useRouter()
  const [items, setItems] = React.useState<PricingTable[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch('/api/cpq/pricing-tables')
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? data ?? []))
      .catch((err) => console.error('Failed to load pricing tables', err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('cpq.pricing.list.title', 'Pricing Tables')}</h1>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.pricing.empty', 'No pricing tables found.')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t('cpq.pricing.name', 'Name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.pricing.code', 'Code')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.pricing.priceColumns', 'Price Columns')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.pricing.currencies', 'Currencies')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.pricing.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((pt) => (
                <tr
                  key={pt.id}
                  onClick={() => router.push(`/backend/cpq/pricing/${pt.id}`)}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{pt.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{pt.code}</td>
                  <td className="px-4 py-3">{pt.priceColumns?.length ?? 0}</td>
                  <td className="px-4 py-3">{pt.currencyCodeList?.join(', ') ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        pt.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {pt.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
