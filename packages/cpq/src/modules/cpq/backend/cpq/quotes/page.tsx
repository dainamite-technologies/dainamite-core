"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Plus, Search as SearchIcon } from 'lucide-react'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'
import {
  formatStatusLabel,
  quoteCpqStatusMap,
  type QuoteCpqStatus,
} from '../../../components/statusMaps'

type QuoteConfig = {
  id: string
  quoteId: string
  customerId: string
  cpqStatus: string
  version: number
  currencyCode: string
  pricingSummary: {
    nrcTotal?: number
    mrcTotal?: number
  } | null
  createdAt: string
  updatedAt: string
}

type Customer = {
  id: string
  display_name?: string
  displayName?: string
  name?: string
  companyName?: string
  primary_email?: string
  primaryEmail?: string
}

const PAGE_SIZE = 50

function fmt(amount: number | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.cpqStatus === 'string' && values.cpqStatus) {
    params.set('cpqStatus', values.cpqStatus)
  }
  if (typeof values.currencyCode === 'string' && values.currencyCode.trim()) {
    params.set('currencyCode', values.currencyCode.trim().toUpperCase())
  }
}

// ─── Customer picker (extracted to keep main page focused) ────────

type CustomerPickerProps = {
  open: boolean
  onClose: () => void
  onSelect: (customer: Customer) => void | Promise<void>
  creating: boolean
  error: string | null
}

function getCustomerLabel(c: Customer) {
  return c.display_name || c.displayName || c.name || c.companyName || 'Unnamed'
}

function getCustomerEmail(c: Customer) {
  return c.primary_email || c.primaryEmail || ''
}

function CustomerPickerModal({ open, onClose, onSelect, creating, error }: CustomerPickerProps) {
  const [customers, setCustomers] = React.useState<Customer[]>([])
  const [customersLoading, setCustomersLoading] = React.useState(false)
  const [search, setSearch] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setSearch('')
    setCustomersLoading(true)
    fetch('/api/customers/companies?pageSize=100')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setCustomers(data.items ?? data ?? [])
      })
      .catch(() => {
        if (!cancelled) setCustomers([])
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const filtered = customers.filter((c) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      getCustomerLabel(c).toLowerCase().includes(q) ||
      getCustomerEmail(c).toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    )
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !creating && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">Select Customer for New Quote</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none cursor-pointer disabled:cursor-not-allowed"
          >
            &times;
          </button>
        </div>
        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="pl-10"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {customersLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading customers…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {search ? 'No customers match your search.' : 'No customers found.'}
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c)}
                  disabled={creating}
                  className="w-full rounded-md border px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <p className="text-sm font-medium">{getCustomerLabel(c)}</p>
                  {getCustomerEmail(c) && (
                    <p className="text-xs text-muted-foreground mt-0.5">{getCustomerEmail(c)}</p>
                  )}
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.id}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────

export default function CpqQuotesListPage() {
  const router = useRouter()
  const t = useT()

  const data = useCpqListData<QuoteConfig>({
    endpoint: '/api/cpq/quotes',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.quotes.list.error.load', 'Failed to load quotes'),
  })

  const [showCustomerPicker, setShowCustomerPicker] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const statusOptions = React.useMemo(
    () => [
      { value: 'new', label: 'New' },
      { value: 'incomplete', label: 'Incomplete' },
      { value: 'ready', label: 'Ready' },
      { value: 'in_approval', label: 'In Approval' },
      { value: 'approved', label: 'Approved' },
      { value: 'with_customer', label: 'With Customer' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'cpqStatus',
        label: t('cpq.quotes.filters.status', 'Status'),
        type: 'select',
        options: statusOptions,
      },
      {
        id: 'currencyCode',
        label: t('cpq.quotes.filters.currency', 'Currency'),
        type: 'text',
      },
    ],
    [statusOptions, t],
  )

  const selectCustomer = React.useCallback(
    async (customer: Customer) => {
      setCreating(true)
      setCreateError(null)
      try {
        const res = await fetch('/api/cpq/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: customer.id }),
        })
        const body = await res.json()
        if (res.ok) {
          setShowCustomerPicker(false)
          router.push(`/backend/cpq/quotes/${body.id}`)
        } else {
          setCreateError(body.error ?? `Failed to create quote (${res.status})`)
        }
      } catch (err) {
        setCreateError((err as Error).message)
      } finally {
        setCreating(false)
      }
    },
    [router],
  )

  const columns = React.useMemo<ColumnDef<QuoteConfig>[]>(
    () => [
      {
        accessorKey: 'quoteId',
        header: t('cpq.quotes.table.quoteId', 'Quote ID'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-primary">
            {(row.original.quoteId ?? row.original.id).slice(0, 8)}…
          </span>
        ),
      },
      {
        accessorKey: 'cpqStatus',
        header: t('cpq.quotes.table.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={quoteCpqStatusMap[row.original.cpqStatus as QuoteCpqStatus] ?? 'neutral'} dot>
            {formatStatusLabel(row.original.cpqStatus)}
          </Tag>
        ),
      },
      {
        accessorKey: 'version',
        header: t('cpq.quotes.table.version', 'Version'),
        cell: ({ row }) => <span className="text-muted-foreground">v{row.original.version}</span>,
      },
      {
        accessorKey: 'currencyCode',
        header: t('cpq.quotes.table.currency', 'Currency'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.currencyCode}</span>,
      },
      {
        id: 'nrcTotal',
        header: t('cpq.quotes.table.nrcTotal', 'NRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.nrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        id: 'mrcTotal',
        header: t('cpq.quotes.table.mrcTotal', 'MRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.mrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('cpq.quotes.table.createdAt', 'Created'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <CpqListView<QuoteConfig>
      title={t('cpq.quotes.list.title', 'CPQ Quotes')}
      tableId="cpq.quotes.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.quotes.search.placeholder', 'Search by quote / customer id...')}
      actions={
        <Button type="button" onClick={() => setShowCustomerPicker(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t('cpq.quotes.add', 'New Quote')}
        </Button>
      }
      onRowClick={(row) => router.push(`/backend/cpq/quotes/${row.id}`)}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('cpq.quotes.actions.open', 'Open'),
              href: `/backend/cpq/quotes/${row.id}`,
            },
          ]}
        />
      )}
      toolbarContent={
        <CustomerPickerModal
          open={showCustomerPicker}
          onClose={() => setShowCustomerPicker(false)}
          onSelect={selectCustomer}
          creating={creating}
          error={createError}
        />
      }
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(
            'cpq.quotes.empty',
            'No CPQ quotes found. Create one to start configuring offerings for a customer.',
          )}
        </div>
      }
    />
  )
}
