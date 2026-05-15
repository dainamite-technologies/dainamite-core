"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'
import {
  PriceRuleForm,
  RULE_TYPE_LABELS,
  emptyPriceRuleForm,
  priceRuleFormToPayload,
  type PriceRule,
  type PriceRuleFormData,
  type ProductOffering,
} from './PriceRuleForm'

const PAGE_SIZE = 50

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.ruleType === 'string' && values.ruleType) {
    params.set('ruleType', values.ruleType)
  }
  if (typeof values.chargeTypeFilter === 'string' && values.chargeTypeFilter) {
    params.set('chargeTypeFilter', values.chargeTypeFilter)
  }
  if (values.globalOnly === true) params.set('globalOnly', 'true')
  if (values.isActive === true) params.set('isActive', 'true')
  if (values.isActive === false) params.set('isActive', 'false')
}

function formatValue(rule: PriceRule) {
  if (rule.ruleType.includes('percent')) return `${rule.value}%`
  if (rule.ruleType === 'price_override') return `= ${rule.value}`
  return `${rule.value}`
}

export default function PriceRulesPage() {
  const t = useT()
  const router = useRouter()

  const data = useCpqListData<PriceRule>({
    endpoint: '/api/cpq/price-rules',
    pageSize: PAGE_SIZE,
    initialSorting: [{ id: 'sortOrder', desc: false }],
    buildFilterParams,
    loadErrorMessage: t('cpq.priceRules.list.error.load', 'Failed to load price rules'),
  })

  const [showForm, setShowForm] = React.useState(false)
  const [form, setForm] = React.useState<PriceRuleFormData>(emptyPriceRuleForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [offerings, setOfferings] = React.useState<ProductOffering[]>([])

  React.useEffect(() => {
    fetch('/api/cpq/product-offerings?pageSize=100')
      .then((r) => r.json())
      .then((d) => setOfferings(d.items ?? []))
      .catch(() => {})
  }, [])

  const ruleTypeOptions = React.useMemo(
    () => Object.entries(RULE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
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

  const openCreate = React.useCallback(() => {
    setForm(emptyPriceRuleForm)
    setError(null)
    setShowForm(true)
  }, [])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = priceRuleFormToPayload(form)
      const res = await fetch('/api/cpq/price-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.details ? JSON.stringify(err.details) : err.error ?? 'Failed to create')
      }
      setShowForm(false)
      data.reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }, [data, form])

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
          <Tag variant={row.original.isActive ? 'success' : 'neutral'} dot>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Tag>
        ),
      },
    ],
    [t],
  )

  return (
    <CpqListView<PriceRule>
      title={t('cpq.priceRules.list.title', 'Price Rules')}
      tableId="cpq.price-rules.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.priceRules.search.placeholder', 'Search price rules...')}
      actions={
        <Button type="button" onClick={openCreate}>
          {t('cpq.priceRules.create', 'Create Rule')}
        </Button>
      }
      crud={{
        endpoint: '/api/cpq/price-rules',
        entityName: t('cpq.priceRules.entityName', 'price rule'),
        editHref: (row) => `/backend/cpq/price-rules/${row.id}`,
      }}
      onRowClick={(row) => router.push(`/backend/cpq/price-rules/${row.id}`)}
      toolbarContent={
        showForm ? (
          <PriceRuleForm
            editingId={null}
            form={form}
            onFormChange={setForm}
            offerings={offerings}
            saving={saving}
            error={error}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
          />
        ) : null
      }
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No price rules found. Click &quot;Create Rule&quot; to add one.
        </div>
      }
    />
  )
}
