"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type Charge = {
  id: string
  code: string
  name: string
  description: string | null
  chargeType: string
  pricingMethod: string
  fixedPrice: string | null
  currencyCode: string | null
  isActive: boolean
}

type Offering = {
  id: string
  specId: string
  code: string
  name: string
  description: string | null
  offeringType: string
  designTimeValues: Record<string, unknown>
  lifecycleStatus: string
  isActive: boolean
  createdAt: string
  charges?: Charge[]
}

type PricingTableRef = { id: string; code: string; name: string; priceColumns: Array<{ key: string; label: string }> }

type OfferingsResponse = {
  items?: Offering[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

const CHARGE_TYPE_COLORS: Record<string, string> = {
  mrc: 'bg-blue-100 text-blue-800',
  nrc: 'bg-green-100 text-green-800',
  usage: 'bg-purple-100 text-purple-800',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-700',
}

function ChargePopover({ charge }: { charge: Charge }) {
  const [open, setOpen] = React.useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-default ${CHARGE_TYPE_COLORS[charge.chargeType] ?? 'bg-gray-100 text-gray-700'}`}>
        {charge.chargeType.toUpperCase()}
      </span>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-lg border bg-popover p-3 shadow-md text-popover-foreground text-xs space-y-1.5">
          <div className="font-medium text-sm">{charge.name}</div>
          <div className="text-muted-foreground font-mono">{charge.code}</div>
          {charge.description && <div className="text-muted-foreground">{charge.description}</div>}
          <div className="flex items-center justify-between pt-1 border-t">
            <span>Pricing: {charge.pricingMethod}</span>
            {charge.fixedPrice != null && (
              <span className="font-medium">{charge.currencyCode ?? 'USD'} {charge.fixedPrice}</span>
            )}
          </div>
          {!charge.isActive && <div className="text-yellow-600 font-medium">Inactive</div>}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-popover border-b border-r rotate-45 -mt-1" />
        </div>
      )}
    </span>
  )
}

export default function OfferingsListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<Offering[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  // Search + sort + filters (OM standard)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  // Bulk charge creation
  const [bulkChargeOpen, setBulkChargeOpen] = React.useState(false)
  const [bulkChargeTargets, setBulkChargeTargets] = React.useState<Offering[]>([])
  const [chargeForm, setChargeForm] = React.useState({
    code: '',
    name: '',
    description: '',
    chargeType: 'mrc',
    pricingMethod: 'flat',
  })
  const [chargePrices, setChargePrices] = React.useState<Record<string, string>>({})
  const [chargePricingTableId, setChargePricingTableId] = React.useState<string | null>(null)
  const [chargePriceColumnKey, setChargePriceColumnKey] = React.useState<string | null>(null)
  const [chargeCurrency, setChargeCurrency] = React.useState('USD')
  const [pricingTables, setPricingTables] = React.useState<PricingTableRef[]>([])
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const lifecycleOptions = React.useMemo(
    () => [
      { value: 'draft', label: t('cpq.offerings.lifecycle.draft', 'Draft') },
      { value: 'active', label: t('cpq.offerings.lifecycle.active', 'Active') },
      { value: 'deprecated', label: t('cpq.offerings.lifecycle.deprecated', 'Deprecated') },
      { value: 'retired', label: t('cpq.offerings.lifecycle.retired', 'Retired') },
    ],
    [t],
  )

  const offeringTypeOptions = React.useMemo(
    () => [
      { value: 'simple', label: t('cpq.offerings.type.simple', 'Simple') },
      { value: 'bundle', label: t('cpq.offerings.type.bundle', 'Bundle') },
    ],
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'lifecycleStatus',
        label: t('cpq.offerings.filters.lifecycleStatus', 'Lifecycle Status'),
        type: 'select',
        options: lifecycleOptions,
      },
      {
        id: 'offeringType',
        label: t('cpq.offerings.filters.offeringType', 'Type'),
        type: 'select',
        options: offeringTypeOptions,
      },
      {
        id: 'isActive',
        label: t('cpq.offerings.filters.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [lifecycleOptions, offeringTypeOptions, t],
  )

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    if (typeof filterValues.lifecycleStatus === 'string' && filterValues.lifecycleStatus) {
      params.set('lifecycleStatus', filterValues.lifecycleStatus)
    }
    if (typeof filterValues.offeringType === 'string' && filterValues.offeringType) {
      params.set('offeringType', filterValues.offeringType)
    }
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: OfferingsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<OfferingsResponse>(
          `/api/cpq/product-offerings?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.offerings.list.error.load', 'Failed to load offerings'), 'error')
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [queryString, reloadToken, t])

  const loadPricingTables = React.useCallback(async () => {
    if (pricingTables.length > 0) return
    try {
      const res = await fetch('/api/cpq/pricing-tables?pageSize=200')
      if (res.ok) {
        const data = await res.json()
        setPricingTables(data.items ?? [])
      }
    } catch {
      // ignore — pricing tables are optional
    }
  }, [pricingTables.length])

  const openBulkChargeForm = React.useCallback(
    (targets: Offering[]) => {
      setBulkChargeTargets(targets)
      setChargeForm({ code: '', name: '', description: '', chargeType: 'mrc', pricingMethod: 'flat' })
      setChargePrices({})
      setChargePricingTableId(null)
      setChargePriceColumnKey(null)
      setChargeCurrency('USD')
      setError(null)
      setBulkChargeOpen(true)
      void loadPricingTables()
    },
    [loadPricingTables],
  )

  const saveChargesForSelected = React.useCallback(async () => {
    const targets = bulkChargeTargets
    if (!targets.length || !chargeForm.code || !chargeForm.name) return
    setSaving(true)
    setError(null)
    try {
      for (const offering of targets) {
        const chargeCode = targets.length > 1 ? `${offering.code}--${chargeForm.code}` : chargeForm.code
        const payload: Record<string, unknown> = {
          offeringId: offering.id,
          code: chargeCode,
          name: chargeForm.name,
          description: chargeForm.description || null,
          chargeType: chargeForm.chargeType,
          pricingMethod: chargeForm.pricingMethod,
          isActive: true,
          sortOrder: 0,
        }
        if (chargeForm.pricingMethod === 'flat') {
          payload.fixedPrice = chargePrices[offering.id] || null
          payload.currencyCode = chargeCurrency
        } else {
          payload.pricingTableId = chargePricingTableId
          payload.priceColumnKey = chargePriceColumnKey
        }
        const res = await fetch('/api/cpq/product-charges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({} as { error?: string }))
          setError(d.error ?? `Failed to save charge for ${offering.name}`)
          setSaving(false)
          return
        }
      }
      flash(t('cpq.offerings.flash.chargesCreated', 'Charges created'), 'success')
      setBulkChargeOpen(false)
      setBulkChargeTargets([])
      setReloadToken((token) => token + 1)
    } catch {
      setError('Failed to save charges')
    } finally {
      setSaving(false)
    }
  }, [
    bulkChargeTargets,
    chargeCurrency,
    chargeForm,
    chargePriceColumnKey,
    chargePrices,
    chargePricingTableId,
    t,
  ])

  const selectedPricingTable = chargePricingTableId
    ? pricingTables.find((pt) => pt.id === chargePricingTableId)
    : null

  const columns = React.useMemo<ColumnDef<Offering>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('cpq.offerings.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.offerings.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.name}
            {row.original.offeringType === 'bundle' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-medium">
                bundle
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.offerings.isActive', 'Is Active?'),
        cell: ({ row }) => <Checkbox checked={row.original.isActive} disabled />,
      },
      {
        accessorKey: 'lifecycleStatus',
        header: t('cpq.offerings.lifecycleStatus', 'Lifecycle Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_COLORS[row.original.lifecycleStatus] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {row.original.lifecycleStatus}
          </span>
        ),
      },
      {
        id: 'charges',
        header: t('cpq.offerings.charges', 'Charges'),
        cell: ({ row }) => {
          const charges = row.original.charges ?? []
          if (charges.length === 0) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div
              className="flex flex-wrap gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {charges.map((ch) => (
                <ChargePopover key={ch.id} charge={ch} />
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: 'description',
        header: t('cpq.offerings.description', 'Description'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.description ?? '—'}</span>
        ),
        meta: { truncate: true, maxWidth: 320 },
      },
    ],
    [t],
  )

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const deleteSelected = React.useCallback(
    async (selectedRows: Offering[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.offerings.bulk.deleteConfirm',
          `Delete ${selectedRows.length} offering${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/product-offerings', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.offerings.flash.deleteFailed', `Failed to delete ${failed} offering(s)`),
          'error',
        )
      } else {
        flash(t('cpq.offerings.flash.deleted', 'Offerings deleted'), 'success')
      }
      setReloadToken((token) => token + 1)
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, t],
  )

  const bulkActions = React.useMemo<BulkAction<Offering>[]>(
    () => [
      {
        id: 'add-charge',
        label: t('cpq.offerings.bulk.addCharge', 'Add Charge'),
        onExecute: (selectedRows) => {
          if (!selectedRows.length) return { ok: false }
          openBulkChargeForm(selectedRows)
          return { ok: true }
        },
      },
      {
        id: 'delete',
        label: t('cpq.offerings.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, openBulkChargeForm, t],
  )

  return (
    <Page>
      <PageBody className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {bulkChargeOpen && bulkChargeTargets.length > 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <h4 className="font-medium text-sm">
            {t('cpq.offerings.bulk.formTitle', 'New Charge for')} {bulkChargeTargets.length}{' '}
            {bulkChargeTargets.length > 1
              ? t('cpq.offerings.bulk.offeringsPlural', 'offerings')
              : t('cpq.offerings.bulk.offeringsSingular', 'offering')}
          </h4>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Code</label>
              <Input
                value={chargeForm.code}
                onChange={(e) => setChargeForm({ ...chargeForm, code: e.target.value })}
                placeholder="e.g. mrc-monthly"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <Input
                value={chargeForm.name}
                onChange={(e) => setChargeForm({ ...chargeForm, name: e.target.value })}
                placeholder="e.g. Monthly Recurring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <Select
                value={chargeForm.chargeType}
                onValueChange={(value) => setChargeForm({ ...chargeForm, chargeType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nrc">NRC (Non-Recurring)</SelectItem>
                  <SelectItem value="mrc">MRC (Monthly Recurring)</SelectItem>
                  <SelectItem value="usage">Usage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pricing</label>
              <Select
                value={chargeForm.pricingMethod}
                onValueChange={(value) => setChargeForm({ ...chargeForm, pricingMethod: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Fixed Price (per offering)</SelectItem>
                  <SelectItem value="per_unit">Per Unit (table lookup)</SelectItem>
                  <SelectItem value="tiered">Tiered (table lookup)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <Input
              value={chargeForm.description}
              onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
              placeholder="User-facing charge description"
            />
          </div>

          {chargeForm.pricingMethod === 'flat' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium">Currency</label>
                <Input
                  value={chargeCurrency}
                  onChange={(e) => setChargeCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  className="w-20"
                />
              </div>
              <div className="rounded border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-xs">Offering</th>
                      <th className="px-3 py-2 text-left font-medium text-xs">Price ({chargeCurrency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkChargeTargets.map((o) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium text-xs">
                          {o.name} <span className="text-muted-foreground font-mono">({o.code})</span>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={chargePrices[o.id] ?? ''}
                            onChange={(e) =>
                              setChargePrices({ ...chargePrices, [o.id]: e.target.value })
                            }
                            placeholder="0.00"
                            className="w-32"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {chargeForm.pricingMethod !== 'flat' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Pricing Table</label>
                <Select
                  value={chargePricingTableId ?? ''}
                  onValueChange={(value) => {
                    setChargePricingTableId(value || null)
                    setChargePriceColumnKey(null)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select table..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pricingTables.map((pt) => (
                      <SelectItem key={pt.id} value={pt.id}>
                        {pt.name} ({pt.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Price Column</label>
                <Select
                  value={chargePriceColumnKey ?? ''}
                  onValueChange={(value) => setChargePriceColumnKey(value || null)}
                  disabled={!selectedPricingTable}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedPricingTable?.priceColumns.map((col) => (
                      <SelectItem key={col.key} value={col.key}>
                        {col.label} ({col.key})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              onClick={saveChargesForSelected}
              disabled={saving || !chargeForm.code || !chargeForm.name}
            >
              {saving
                ? 'Saving...'
                : `Create Charge for ${bulkChargeTargets.length} Offering${bulkChargeTargets.length > 1 ? 's' : ''}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setBulkChargeOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <DataTable<Offering>
        title={t('cpq.offerings.list.title', 'Product Offerings')}
        actions={
          <Button asChild>
            <a href="/backend/cpq/offerings/new">
              {t('cpq.offerings.add', 'New Offering')}
            </a>
          </Button>
        }
        refreshButton={{
          label: t('cpq.offerings.actions.refresh', 'Refresh'),
          onRefresh: handleRefresh,
          isRefreshing: isLoading,
        }}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('cpq.offerings.search.placeholder', 'Search offerings...')}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={handleFiltersApply}
        onFiltersClear={handleFiltersClear}
        sorting={sorting}
        onSortingChange={setSorting}
        bulkActions={bulkActions}
        selectionScopeKey="cpq.offerings"
        onRowClick={(row) => router.push(`/backend/cpq/offerings/${row.id}`)}
        perspective={{ tableId: 'cpq.offerings.list' }}
        columnChooser={{ auto: true }}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        emptyState={
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t(
              'cpq.offerings.empty',
              'No product offerings found. Create one to define a sellable variant of a product specification.',
            )}
          </div>
        }
      />
      {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
