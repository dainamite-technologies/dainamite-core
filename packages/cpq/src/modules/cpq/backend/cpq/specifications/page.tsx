"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'

type Specification = {
  id: string
  productId: string
  code: string
  name: string
  description: string | null
  specType: string
  isAssetizable: boolean
  lifecycleStatus: string
  version: number
  isActive: boolean
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-700',
}

export default function SpecificationsListPage() {
  const t = useT()
  const router = useRouter()
  const [items, setItems] = React.useState<Specification[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/cpq/product-specifications?pageSize=100')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setItems(data.items ?? [])
        }
      } catch (err) {
        console.error('Failed to load specifications', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('cpq.specifications.list.title', 'Product Specifications')}</h1>
        <button
          onClick={() => router.push('/backend/cpq/specifications/new')}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('cpq.specifications.add', 'New Specification')}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.specifications.empty', 'No product specifications found. Create one to define your product catalogue.')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.code', 'Code')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.name', 'Name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.isActive', 'Is Active?')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.lifecycleStatus', 'Lifecycle Status')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.version', 'Version')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.specifications.description', 'Description')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((spec) => (
                <tr
                  key={spec.id}
                  onClick={() => router.push(`/backend/cpq/specifications/${spec.id}`)}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{spec.code}</td>
                  <td className="px-4 py-3 font-medium">
                    {spec.name}
                    {spec.specType === 'bundle' && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-medium">bundle</span>
                    )}
                    {spec.isAssetizable && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 text-orange-800 px-2 py-0.5 text-[10px] font-medium">asset</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><input type="checkbox" checked={spec.isActive} disabled className="rounded border" /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[spec.lifecycleStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                      {spec.lifecycleStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">v{spec.version}</td>
                  <td className="px-4 py-3 text-muted-foreground truncate max-w-xs">{spec.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
