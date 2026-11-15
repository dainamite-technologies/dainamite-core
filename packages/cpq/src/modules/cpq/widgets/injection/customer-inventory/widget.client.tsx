"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  assetStatusMap,
  subscriptionStatusMap,
  type AssetStatus,
  type SubscriptionStatus,
} from '../../../components/statusMaps'
import { inventoryStatusLabel } from '../../../backend/cpq/inventory/shared'

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
  const t = useT()
  const variant =
    subscriptionStatusMap[status as SubscriptionStatus] ??
    assetStatusMap[status as AssetStatus] ??
    'neutral'
  return (
    <Tag variant={variant} dot>
      {inventoryStatusLabel(t, status)}
    </Tag>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────

export default function CustomerInventoryWidget({ data, context }: InjectionWidgetComponentProps & { context?: Record<string, unknown> }) {
  const t = useT()
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

  if (!customerId) return <div className="p-4 text-sm text-muted-foreground">{t('cpq.widgets.customerInventory.noContext', 'No customer context available.')}</div>

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> {t('cpq.widgets.customerInventory.loading', 'Loading inventory…')}
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
        <p className="text-sm text-muted-foreground">{t('cpq.widgets.customerInventory.empty', 'No inventory records found.')}</p>
      </div>
    )
  }

  const { summary } = inventory
  const currency = summary.currencyCode || 'USD'

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'subscriptions', label: t('cpq.widgets.customerInventory.tabs.subscriptions', 'Subscriptions'), count: inventory.subscriptions.length },
    { key: 'items', label: t('cpq.widgets.customerInventory.tabs.items', 'Subscription Items'), count: inventory.subscriptionItems.length },
    { key: 'assets', label: t('cpq.widgets.customerInventory.tabs.assets', 'Assets'), count: inventory.assets.length },
  ]

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label={t('cpq.widgets.customerInventory.summary.activeSubscriptions', 'Active Subscriptions')} value={String(summary.activeSubscriptions)} />
        <SummaryCard label={t('cpq.widgets.customerInventory.summary.totalMrc', 'Total MRC')} value={fmt(summary.totalMrc, currency)} mono />
        <SummaryCard label={t('cpq.widgets.customerInventory.summary.activeAssets', 'Active Assets')} value={String(summary.activeAssets)} />
        <SummaryCard label={t('cpq.widgets.customerInventory.summary.pendingItems', 'Pending Items')} value={String(summary.pendingItems)} />
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
          {t('cpq.widgets.customerInventory.viewFull', 'View full inventory →')}
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
  const t = useT()
  if (items.length === 0) return <EmptyTab />
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.name', 'Name')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.status', 'Status')}</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.mrc', 'MRC')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.billing', 'Billing')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.startDate', 'Start Date')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.termEnd', 'Term End')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr
              key={s.id}
              onClick={() => onOpen(s.id)}
              className="border-b border-border last:border-0 cursor-pointer hover:bg-accent/40 transition-colors"
            >
              <td className="px-4 py-3 font-medium">{s.name}</td>
              <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
              <td className="px-4 py-3 text-right font-mono">{fmt(s.mrcAmount, s.currencyCode || currency)}</td>
              <td className="px-4 py-3 capitalize">{s.billingCycle}</td>
              <td className="px-4 py-3 text-muted-foreground">{s.startDate ? new Date(s.startDate).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">{s.currentTermEnd ? new Date(s.currentTermEnd).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Subscription Items Table ────────────────────────────────────

function SubscriptionItemsTable({ items, currency, onOpen }: { items: SubscriptionItem[]; currency: string; onOpen: (subscriptionId: string) => void }) {
  const t = useT()
  if (items.length === 0) return <EmptyTab />
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.name', 'Name')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.status', 'Status')}</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.mrc', 'MRC')}</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.nrc', 'NRC')}</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.qty', 'Qty')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpen(item.subscriptionId)}
              className="border-b border-border last:border-0 cursor-pointer hover:bg-accent/40 transition-colors"
            >
              <td className="px-4 py-3 font-medium">{item.name}</td>
              <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
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
  const t = useT()
  if (items.length === 0) return <EmptyTab />
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.name', 'Name')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.type', 'Type')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.status', 'Status')}</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.price', 'Price')}</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">{t('cpq.widgets.customerInventory.table.linkedTo', 'Linked To')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr
              key={a.id}
              onClick={() => onOpen(a.id)}
              className="border-b border-border last:border-0 cursor-pointer hover:bg-accent/40 transition-colors"
            >
              <td className="px-4 py-3 font-medium">{a.name}</td>
              <td className="px-4 py-3 capitalize">{a.assetType.replace(/_/g, ' ')}</td>
              <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-4 py-3 text-right font-mono">{fmt(a.purchasePrice, a.currencyCode || currency)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {a.subscriptionId ? t('cpq.widgets.customerInventory.table.linkedSubscription', 'Sub {id}…', { id: a.subscriptionId.slice(0, 8) }) : '—'}
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
  const t = useT()
  return (
    <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
      {t('cpq.widgets.customerInventory.emptyTab', 'No records in this category.')}
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
