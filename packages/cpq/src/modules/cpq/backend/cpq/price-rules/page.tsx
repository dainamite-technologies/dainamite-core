"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
import { RowActions } from '@open-mercato/ui/backend/RowActions'

const RULE_TYPE_LABELS: Record<string, string> = {
  discount_percent: 'Discount %',
  discount_absolute: 'Discount $',
  surcharge_percent: 'Surcharge %',
  surcharge_absolute: 'Surcharge $',
  price_override: 'Override',
}

type PriceRule = {
  id: string
  code: string
  name: string
  description: string | null
  productOfferingId: string | null
  productOfferingName: string | null
  ruleType: string
  value: number
  chargeCodeFilter: string | null
  chargeTypeFilter: string | null
  applicabilityCondition: Record<string, unknown> | null
  sortOrder: number
  isActive: boolean
}

type ProductOffering = { id: string; code: string; name: string }

type PriceRulesResponse = {
  items?: PriceRule[]
  total?: number
  totalPages?: number
}

type FormData = {
  code: string
  name: string
  description: string
  productOfferingId: string
  ruleType: string
  value: string
  chargeCodeFilter: string
  chargeTypeFilter: string
  conditionAttribute: string
  conditionOperator: string
  conditionValue: string
  sortOrder: string
  isActive: boolean
}

const emptyForm: FormData = {
  code: '',
  name: '',
  description: '',
  productOfferingId: '',
  ruleType: 'discount_percent',
  value: '',
  chargeCodeFilter: '',
  chargeTypeFilter: '',
  conditionAttribute: '',
  conditionOperator: 'eq',
  conditionValue: '',
  sortOrder: '0',
  isActive: true,
}

const PAGE_SIZE = 50

export default function PriceRulesPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<PriceRule[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'sortOrder', desc: false }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormData>(emptyForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [offerings, setOfferings] = React.useState<ProductOffering[]>([])

  React.useEffect(() => {
    fetch('/api/cpq/product-offerings?pageSize=100')
      .then((r) => r.json())
      .then((data) => setOfferings(data.items ?? []))
      .catch(() => {})
  }, [])

  const ruleTypeOptions = React.useMemo(
    () =>
      Object.entries(RULE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    [],
  )

  const chargeTypeOptions = React.useMemo(
    () => [
      { value: 'nrc', label: 'NRC' },
      { value: 'mrc', label: 'MRC' },
      { value: 'usage', label: 'Usage' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'ruleType',
        label: t('cpq.priceRules.filters.ruleType', 'Rule Type'),
        type: 'select',
        options: ruleTypeOptions,
      },
      {
        id: 'chargeTypeFilter',
        label: t('cpq.priceRules.filters.chargeType', 'Charge Type'),
        type: 'select',
        options: chargeTypeOptions,
      },
      {
        id: 'globalOnly',
        label: t('cpq.priceRules.filters.globalOnly', 'Global only'),
        type: 'checkbox',
      },
      {
        id: 'isActive',
        label: t('cpq.priceRules.filters.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [chargeTypeOptions, ruleTypeOptions, t],
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
    if (typeof filterValues.ruleType === 'string' && filterValues.ruleType) {
      params.set('ruleType', filterValues.ruleType)
    }
    if (typeof filterValues.chargeTypeFilter === 'string' && filterValues.chargeTypeFilter) {
      params.set('chargeTypeFilter', filterValues.chargeTypeFilter)
    }
    if (filterValues.globalOnly === true) params.set('globalOnly', 'true')
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: PriceRulesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PriceRulesResponse>(
          `/api/cpq/price-rules?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.priceRules.list.error.load', 'Failed to load price rules'), 'error')
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

  const openCreate = React.useCallback(() => {
    setEditingId(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }, [])

  const openEdit = React.useCallback((rule: PriceRule) => {
    setEditingId(rule.id)
    const cond = rule.applicabilityCondition as
      | { attribute?: string; operator?: string; value?: string }
      | null
    setForm({
      code: rule.code,
      name: rule.name,
      description: rule.description ?? '',
      productOfferingId: rule.productOfferingId ?? '',
      ruleType: rule.ruleType,
      value: String(rule.value),
      chargeCodeFilter: rule.chargeCodeFilter ?? '',
      chargeTypeFilter: rule.chargeTypeFilter ?? '',
      conditionAttribute: cond?.attribute ?? '',
      conditionOperator: cond?.operator ?? 'eq',
      conditionValue: cond?.value ?? '',
      sortOrder: String(rule.sortOrder),
      isActive: rule.isActive,
    })
    setError(null)
    setShowForm(true)
  }, [])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        ruleType: form.ruleType,
        value: Number(form.value),
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
        productOfferingId: form.productOfferingId || null,
      }
      if (form.description) payload.description = form.description
      if (form.chargeCodeFilter) payload.chargeCodeFilter = form.chargeCodeFilter
      if (form.chargeTypeFilter) payload.chargeTypeFilter = form.chargeTypeFilter
      if (form.conditionAttribute) {
        payload.applicabilityCondition = {
          attribute: form.conditionAttribute,
          operator: form.conditionOperator || 'eq',
          value: form.conditionValue,
        }
      } else {
        payload.applicabilityCondition = null
      }

      if (editingId) {
        payload.id = editingId
        const res = await fetch('/api/cpq/price-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? 'Failed to update')
        }
      } else {
        const res = await fetch('/api/cpq/price-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.details ? JSON.stringify(err.details) : err.error ?? 'Failed to create')
        }
      }
      setShowForm(false)
      setReloadToken((token) => token + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }, [editingId, form])

  const handleDeleteSingle = React.useCallback(
    async (rule: PriceRule) => {
      const confirmed = await confirm({
        title: t('cpq.priceRules.deleteConfirm', `Delete rule "${rule.name}"?`),
        variant: 'destructive',
      })
      if (!confirmed) return
      await fetch('/api/cpq/price-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id }),
      })
      setReloadToken((token) => token + 1)
    },
    [confirm, t],
  )

  function formatValue(rule: PriceRule) {
    if (rule.ruleType.includes('percent')) return `${rule.value}%`
    if (rule.ruleType === 'price_override') return `= ${rule.value}`
    return `${rule.value}`
  }

  const columns = React.useMemo<ColumnDef<PriceRule>[]>(
    () => [
      {
        accessorKey: 'sortOrder',
        header: t('cpq.priceRules.table.order', 'Order'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.sortOrder}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.priceRules.table.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'code',
        header: t('cpq.priceRules.table.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: 'ruleType',
        header: t('cpq.priceRules.table.type', 'Type'),
        cell: ({ row }) => (
          <span>{RULE_TYPE_LABELS[row.original.ruleType] ?? row.original.ruleType}</span>
        ),
      },
      {
        id: 'value',
        header: t('cpq.priceRules.table.value', 'Value'),
        cell: ({ row }) => <span className="font-mono">{formatValue(row.original)}</span>,
      },
      {
        id: 'scope',
        header: t('cpq.priceRules.table.scope', 'Scope'),
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.productOfferingId
              ? row.original.productOfferingName ?? 'Product-scoped'
              : 'Global'}
          </span>
        ),
      },
      {
        id: 'filter',
        header: t('cpq.priceRules.table.filter', 'Filter'),
        cell: ({ row }) => {
          const rule = row.original
          const parts: string[] = []
          if (rule.chargeTypeFilter) parts.push(rule.chargeTypeFilter)
          if (rule.chargeCodeFilter) parts.push(rule.chargeCodeFilter)
          const cond = rule.applicabilityCondition as
            | { attribute?: string; operator?: string; value?: string }
            | null
          if (cond?.attribute) {
            const op = cond.operator === 'neq' ? '≠' : '='
            parts.push(`${cond.attribute} ${op} ${cond.value ?? '""'}`)
          }
          return (
            <span className="text-xs text-muted-foreground">
              {parts.length > 0 ? parts.join(' / ') : '—'}
            </span>
          )
        },
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.priceRules.table.status', 'Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.original.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            {row.original.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
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
    async (selectedRows: PriceRule[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.priceRules.bulk.deleteConfirm',
          `Delete ${selectedRows.length} price rule${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/price-rules', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.priceRules.flash.deleteFailed', `Failed to delete ${failed} rule(s)`),
          'error',
        )
      } else {
        flash(t('cpq.priceRules.flash.deleted', 'Price rules deleted'), 'success')
      }
      setReloadToken((token) => token + 1)
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, t],
  )

  const bulkActions = React.useMemo<BulkAction<PriceRule>[]>(
    () => [
      {
        id: 'delete',
        label: t('cpq.priceRules.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, t],
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        {showForm && (
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold">{editingId ? 'Edit Rule' : 'New Rule'}</h2>
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-sm font-medium">Code</span>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={!!editingId}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Name</span>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Rule Type</span>
                <Select
                  value={form.ruleType}
                  onValueChange={(value) => setForm({ ...form, ruleType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Value</span>
                <Input
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Charge Type Filter</span>
                <Select
                  value={form.chargeTypeFilter || '__all__'}
                  onValueChange={(value) =>
                    setForm({ ...form, chargeTypeFilter: value === '__all__' ? '' : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All charge types</SelectItem>
                    <SelectItem value="nrc">NRC only</SelectItem>
                    <SelectItem value="mrc">MRC only</SelectItem>
                    <SelectItem value="usage">Usage only</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Charge Code Filter</span>
                <Input
                  placeholder="e.g. setup_fee (leave empty for all)"
                  value={form.chargeCodeFilter}
                  onChange={(e) => setForm({ ...form, chargeCodeFilter: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Sort Order</span>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Description</span>
                <Input
                  placeholder="Optional"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-sm font-medium">Product Offering</span>
                <Select
                  value={form.productOfferingId || '__global__'}
                  onValueChange={(value) =>
                    setForm({ ...form, productOfferingId: value === '__global__' ? '' : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__global__">Global (all products)</SelectItem>
                    {offerings.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} ({o.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  Leave as &quot;Global&quot; to apply to all products, or select a specific offering
                </span>
              </label>
              <div className="col-span-2 space-y-1">
                <span className="text-sm font-medium">Applicability Condition</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  (optional — only apply when a product attribute matches)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Attribute (e.g. port_size)"
                    value={form.conditionAttribute}
                    onChange={(e) => setForm({ ...form, conditionAttribute: e.target.value })}
                  />
                  <Select
                    value={form.conditionOperator}
                    onValueChange={(value) => setForm({ ...form, conditionOperator: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eq">equals (=)</SelectItem>
                      <SelectItem value="neq">not equals (≠)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Value (e.g. 100G)"
                    value={form.conditionValue}
                    onChange={(e) => setForm({ ...form, conditionValue: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked === true })}
              />
              Active
            </label>
            <div className="flex gap-2">
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <DataTable<PriceRule>
          title={t('cpq.priceRules.list.title', 'Price Rules')}
          actions={
            <Button type="button" onClick={openCreate}>
              {t('cpq.priceRules.create', 'Create Rule')}
            </Button>
          }
          refreshButton={{
            label: t('cpq.priceRules.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.priceRules.search.placeholder', 'Search price rules...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          bulkActions={bulkActions}
          selectionScopeKey="cpq.price-rules"
          onRowClick={(row) => router.push(`/backend/cpq/price-rules/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('cpq.priceRules.actions.edit', 'Edit'),
                  onSelect: () => openEdit(row),
                },
                {
                  id: 'delete',
                  label: t('cpq.priceRules.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDeleteSingle(row)
                  },
                },
              ]}
            />
          )}
          perspective={{ tableId: 'cpq.price-rules.list' }}
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
              No price rules found. Click &quot;Create Rule&quot; to add one.
            </div>
          }
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
