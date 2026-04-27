"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────

type Subscription = {
  id: string
  code: string
  name: string
  status: string
  mrcAmount: number
  nrcAmount: number
  billingCycle: string
  currencyCode: string
  startDate: string
  currentTermEnd: string | null
}

type Asset = {
  id: string
  code: string
  name: string
  status: string
  assetType: string
  purchasePrice: number
  currencyCode: string
  createdAt: string
}

type TabKey = 'subscriptions' | 'assets'

// ─── Helpers ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-blue-100 text-blue-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  terminated: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  delivered: 'bg-teal-100 text-teal-800',
  returned: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  )
}

// ─── Page ────────────────────────────────────────────────────────

export default function InventoryPage() {
  const t = useT()
  const router = useRouter()

  const [activeTab, setActiveTab] = React.useState<TabKey>('subscriptions')
  const [subscriptions, setSubscriptions] = React.useState<Subscription[]>([])
  const [assets, setAssets] = React.useState<Asset[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [subsRes, assetsRes] = await Promise.all([
          fetch('/api/cpq/inventory/subscriptions?page=1&pageSize=50'),
          fetch('/api/cpq/inventory/assets?page=1&pageSize=50'),
        ])
        if (cancelled) return
        if (subsRes.ok) {
          const data = await subsRes.json()
          setSubscriptions(data.items ?? data ?? [])
        }
        if (assetsRes.ok) {
          const data = await assetsRes.json()
          setAssets(data.items ?? data ?? [])
        }
      } catch (err) {
        console.error('Failed to load inventory', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'subscriptions', label: t('cpq.inventory.subscriptions', 'Subscriptions') },
    { key: 'assets', label: t('cpq.inventory.assets', 'Assets') },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('cpq.inventory.title', 'Customer Inventory')}</h1>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : (
        <>
          {/* Tab Switcher */}
          <div className="flex gap-1 border-b">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'subscriptions' && (
            subscriptions.length === 0 ? (
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                {t('cpq.inventory.empty', 'No inventory records found.')}
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Code</th>
                      <th className="px-4 py-3 text-left font-medium">Name</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">MRC</th>
                      <th className="px-4 py-3 text-left font-medium">Billing</th>
                      <th className="px-4 py-3 text-left font-medium">Start Date</th>
                      <th className="px-4 py-3 text-left font-medium">Term End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => (
                      <tr key={s.id} onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${s.id}`)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{s.code}</td>
                        <td className="px-4 py-3 font-medium text-primary">{s.name}</td>
                        <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(s.mrcAmount, s.currencyCode || 'USD')}</td>
                        <td className="px-4 py-3">{s.billingCycle}</td>
                        <td className="px-4 py-3">{s.startDate ? new Date(s.startDate).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">{s.currentTermEnd ? new Date(s.currentTermEnd).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'assets' && (
            assets.length === 0 ? (
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                {t('cpq.inventory.empty', 'No inventory records found.')}
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Code</th>
                      <th className="px-4 py-3 text-left font-medium">Name</th>
                      <th className="px-4 py-3 text-left font-medium">Type</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Price</th>
                      <th className="px-4 py-3 text-left font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} onClick={() => router.push(`/backend/cpq/inventory/assets/${a.id}`)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{a.code}</td>
                        <td className="px-4 py-3 font-medium text-primary">{a.name}</td>
                        <td className="px-4 py-3">{a.assetType}</td>
                        <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(a.purchasePrice, a.currencyCode || 'USD')}</td>
                        <td className="px-4 py-3">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
