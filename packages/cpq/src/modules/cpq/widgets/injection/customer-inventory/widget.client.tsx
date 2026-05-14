"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useRouter } from 'next/navigation'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  assetStatusMap,
  formatStatusLabel,
  subscriptionStatusMap,
  type AssetStatus,
  type SubscriptionStatus,
} from '../../../components/statusMaps'

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
  autoRenew: boolean
  createdAt: string
}

type SubscriptionItem = {
  id: string
  subscriptionId: string
  parentItemId: string | null
  productId: string | null
  name: string
  status: string
  mrcAmount: number
  nrcAmount: number
  currencyCode: string
  quantity: number
}

type Asset = {
  id: string
  code: string
  name: string
  status: string
  assetType: string
  purchasePrice: number
  currencyCode: string
  subscriptionId: string | null
  subscriptionItemId: string | null
  createdAt: string
}

type InventorySummary = {
  activeSubscriptions: number
  totalMrc: number
  activeAssets: number
  pendingItems: number
  currencyCode: string
}

type InventoryResponse = {
  customerId: string
  subscriptions: Subscription[]
  subscriptionItems: SubscriptionItem[]
  assets: Asset[]
  summary: InventorySummary
}

type TabKey = 'subscriptions' | 'items' | 'assets'

// ─── Helpers ─────────────────────────────────────────────────────

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    subscriptionStatusMap[status as SubscriptionStatus] ??
    assetStatusMap[status as AssetStatus] ??
    'neutral'
  return (
    <Tag variant={variant} dot>
      {formatStatusLabel(status)}
    </Tag>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────

export default function CustomerInventoryWidget({ data, context }: InjectionWidgetComponentProps & { context?: Record<string, unknown> }) {
  const router = useRouter()
  const record = data as Record<string, unknown> | null
  const companyRecord = record?.company as Record<string, unknown> | undefined
  const customerId =
    (context?.companyId as string) ??
    (context?.resourceId as string) ??
    (companyRecord?.id as string) ??
    (record?.id as string) ??
    null

  const [inventory, setInventory] = React.useState<InventoryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [activeTab, setActiveTab] = React.useState<TabKey>('subscriptions')

  React.useEffect(() => {
    if (!customerId) { setLoading(false); return }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/cpq/inventory/customer/${customerId}`)
        if (res.ok && !cancelled) setInventory(await res.json())
      } catch { /* no inventory data */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [customerId])

  if (!customerId) return <div className="p-4 text-sm text-muted-foreground">No customer context available.</div>

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading inventory…
      </div>
    )
  }

  if (!inventory || (inventory.subscriptions.length === 0 && inventory.assets.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="rounded-full bg-primary/10 p-3 mb-3">
          <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">No inventory records found.</p>
      </div>
    )
  }

  const { summary } = inventory
  const currency = summary.currencyCode || 'USD'

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'subscriptions', label: 'Subscriptions', count: inventory.subscriptions.length },
    { key: 'items', label: 'Subscription Items', count: inventory.subscriptionItems.length },
    { key: 'assets', label: 'Assets', count: inventory.assets.length },
  ]

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Active Subscriptions" value={String(summary.activeSubscriptions)} />
        <SummaryCard label="Total MRC" value={fmt(summary.totalMrc, currency)} mono />
        <SummaryCard label="Active Assets" value={String(summary.activeAssets)} />
        <SummaryCard label="Pending Items" value={String(summary.pendingItems)} />
      </div>

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
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'subscriptions' && <SubscriptionsTable items={inventory.subscriptions} currency={currency} onOpen={(id) => router.push(`/backend/cpq/inventory/subscriptions/${id}`)} />}
      {activeTab === 'items' && <SubscriptionItemsTable items={inventory.subscriptionItems} currency={currency} onOpen={(id) => router.push(`/backend/cpq/inventory/subscriptions/${id}`)} />}
      {activeTab === 'assets' && <AssetsTable items={inventory.assets} currency={currency} onOpen={(id) => router.push(`/backend/cpq/inventory/assets/${id}`)} />}

      {/* Link to full page */}
      <div className="pt-2 text-right">
        <a href="/backend/cpq/inventory" className="text-sm text-primary hover:underline">
          View full inventory →
        </a>
      </div>
    </div>
  )
}

// ─── Summary Card ────────────────────────────────────────────────

function SummaryCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

// ─── Subscriptions Table ─────────────────────────────────────────

function SubscriptionsTable({ items, currency, onOpen }: { items: Subscription[]; currency: string; onOpen: (id: string) => void }) {
  if (items.length === 0) return <EmptyTab />
  return (
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
          {items.map((s) => (
            <tr key={s.id} onClick={() => onOpen(s.id)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 text-muted-foreground">{s.code}</td>
              <td className="px-4 py-3 font-medium text-primary">{s.name}</td>
              <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
              <td className="px-4 py-3 text-right font-mono">{fmt(s.mrcAmount, s.currencyCode || currency)}</td>
              <td className="px-4 py-3">{s.billingCycle}</td>
              <td className="px-4 py-3">{s.startDate ? new Date(s.startDate).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-3">{s.currentTermEnd ? new Date(s.currentTermEnd).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Subscription Items Table ────────────────────────────────────

function SubscriptionItemsTable({ items, currency, onOpen }: { items: SubscriptionItem[]; currency: string; onOpen: (subscriptionId: string) => void }) {
  if (items.length === 0) return <EmptyTab />
  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Product</th>
            <th className="px-4 py-3 text-right font-medium">MRC</th>
            <th className="px-4 py-3 text-right font-medium">NRC</th>
            <th className="px-4 py-3 text-right font-medium">Qty</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} onClick={() => onOpen(item.subscriptionId)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium text-primary">{item.name}</td>
              <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
              <td className="px-4 py-3 text-muted-foreground">{item.productId ? item.productId.slice(0, 8) + '…' : '—'}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(item.mrcAmount, item.currencyCode || currency)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(item.nrcAmount, item.currencyCode || currency)}</td>
              <td className="px-4 py-3 text-right font-mono">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Assets Table ────────────────────────────────────────────────

function AssetsTable({ items, currency, onOpen }: { items: Asset[]; currency: string; onOpen: (id: string) => void }) {
  if (items.length === 0) return <EmptyTab />
  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Code</th>
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Price</th>
            <th className="px-4 py-3 text-left font-medium">Linked To</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} onClick={() => onOpen(a.id)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 text-muted-foreground">{a.code}</td>
              <td className="px-4 py-3 font-medium text-primary">{a.name}</td>
              <td className="px-4 py-3">{a.assetType}</td>
              <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-4 py-3 text-right font-mono">{fmt(a.purchasePrice, a.currencyCode || currency)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {a.subscriptionId ? `Sub ${a.subscriptionId.slice(0, 8)}…` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Shared ──────────────────────────────────────────────────────

function EmptyTab() {
  return (
    <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
      No records in this category.
    </div>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
