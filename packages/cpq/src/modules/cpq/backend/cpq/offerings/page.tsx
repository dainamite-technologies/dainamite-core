"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { type BulkAction } from '@open-mercato/ui/backend/DataTable'
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
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'
import { NumberInput } from '../../../components/NumberInput'
import {
  chargeTypeMap,
  formatStatusLabel,
  lifecycleStatusMap,
  type ChargeType,
  type LifecycleStatus,
} from '../../../components/statusMaps'

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

type PricingTableRef = {
  id: string
  code: string
  name: string
  priceColumns: Array<{ key: string; label: string }>
}

const PAGE_SIZE = 50

function ChargePopover({ charge }: { charge: Charge }) {
  const [open, setOpen] = React.useState(false)
  const variant = chargeTypeMap[charge.chargeType as ChargeType] ?? 'neutral'
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Tag variant={variant} className="cursor-default px-2 text-[10px]">
        {charge.chargeType.toUpperCase()}
      </Tag>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-lg border bg-popover p-3 shadow-md text-popover-foreground text-xs space-y-1.5">
          <div className="font-medium text-sm">{charge.name}</div>
          <div className="text-muted-foreground font-mono">{charge.code}</div>
          {charge.description && <div className="text-muted-foreground">{charge.description}</div>}
          <div className="flex items-center justify-between pt-1 border-t">
            <span>Pricing: {charge.pricingMethod}</span>
            {charge.fixedPrice != null && (
              <span className="font-medium">
                {charge.currencyCode ?? 'USD'} {charge.fixedPrice}
              </span>
            )}
          </div>
          {!charge.isActive && <Tag variant="warning" dot>Inactive</Tag>}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-popover border-b border-r rotate-45 -mt-1" />
        </div>
      )}
    </span>
  )
}

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.lifecycleStatus === 'string' && values.lifecycleStatus) {
    params.set('lifecycleStatus', values.lifecycleStatus)
  }
  if (typeof values.offeringType === 'string' && values.offeringType) {
    params.set('offeringType', values.offeringType)
  }
  if (values.isActive === true) params.set('isActive', 'true')
  if (values.isActive === false) params.set('isActive', 'false')
}

export default function OfferingsListPage() {
  const t = useT()
  const router = useRouter()

  const data = useCpqListData<Offering>({
    endpoint: '/api/cpq/product-offerings',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.offerings.list.error.load', 'Failed to load offerings'),
  })

  // Bulk charge creation state
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

  const loadPricingTables = React.useCallback(async () => {
    if (pricingTables.length > 0) return
    try {
      const res = await fetch('/api/cpq/pricing-tables?pageSize=200')
      if (res.ok) {
        const json = await res.json()
        setPricingTables(json.items ?? [])
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
          const body = await res.json().catch(() => ({} as { error?: string }))
          setError(body.error ?? `Failed to save charge for ${offering.name}`)
          setSaving(false)
          return
        }
      }
      flash(t('cpq.offerings.flash.chargesCreated', 'Charges created'), 'success')
      setBulkChargeOpen(false)
      setBulkChargeTargets([])
      data.reload()
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
    data,
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
              <Tag variant="brand" className="ml-2 px-2 text-[10px]">
                bundle
              </Tag>
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
          <Tag variant={lifecycleStatusMap[row.original.lifecycleStatus as LifecycleStatus] ?? 'neutral'} dot>
            {formatStatusLabel(row.original.lifecycleStatus)}
          </Tag>
        ),
      },
      {
        id: 'charges',
        header: t('cpq.offerings.charges', 'Charges'),
        cell: ({ row }) => {
          const charges = row.original.charges ?? []
          if (charges.length === 0) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
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

  // Module-specific bulk actions; "Delete selected" is appended automatically
  // by CpqListView when `crud` is provided.
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
    ],
    [openBulkChargeForm, t],
  )

  const bulkChargeForm = bulkChargeOpen && bulkChargeTargets.length > 0 && (
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
                      <NumberInput
                        value={chargePrices[o.id] === undefined || chargePrices[o.id] === '' ? null : Number(chargePrices[o.id])}
                        onChange={(n) =>
                          setChargePrices({ ...chargePrices, [o.id]: n == null ? '' : String(n) })
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
  )

  const toolbarContent = (
    <>
      {error && <Alert variant="destructive">{error}</Alert>}
      {bulkChargeForm}
    </>
  )

  return (
    <CpqListView<Offering>
      title={t('cpq.offerings.list.title', 'Product Offerings')}
      tableId="cpq.offerings.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.offerings.search.placeholder', 'Search offerings...')}
      actions={
        <Button asChild>
          <a href="/backend/cpq/offerings/new">{t('cpq.offerings.add', 'New Offering')}</a>
        </Button>
      }
      bulkActions={bulkActions}
      crud={{
        endpoint: '/api/cpq/product-offerings',
        entityName: t('cpq.offerings.entityName', 'offering'),
        editHref: (row) => `/backend/cpq/offerings/${row.id}`,
      }}
      onRowClick={(row) => router.push(`/backend/cpq/offerings/${row.id}`)}
      toolbarContent={toolbarContent}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(
            'cpq.offerings.empty',
            'No product offerings found. Create one to define a sellable variant of a product specification.',
          )}
        </div>
      }
    />
  )
}
