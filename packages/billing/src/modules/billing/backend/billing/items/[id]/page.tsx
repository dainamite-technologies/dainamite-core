"use client"
import * as React from 'react'
import Link from 'next/link'
import { Pencil, Repeat } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../../../../lib/displayDate'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import {
  ItemForm,
  type AssembledItemPayload,
  type ItemFormValues,
} from '../../../../components/ItemForm'
import { DetailCard, DetailField } from '../../../../components/DetailFields'
import { resolveItemReturnTarget } from '../../../../lib/navigation'
import { ChangeItemPriceDialog } from '../../../../components/ChangeItemPriceDialog'
import { ItemPhaseScheduleCard, ItemStatusPeriodsCard } from '../../../../components/ItemScheduleSections'
import { ItemPhaseTag, ItemStatusTag, ownPeriodText } from '../../../../components/ItemLineLabels'
import { serverErrorCode } from '../../../../components/ItemStatusDialog'
import { isStatusReadOnly, type PhaseRow, type StatusPeriodRow } from '../../../../lib/itemStatusLabel'
import { phaseRowsFromApi } from '../../../../lib/phaseEditorRows'
import { PHASE_EDIT_BILLED } from '../../../../lib/pricePhases'
import { localTodayIso } from '../../../../lib/dateOnly'
import type { BillCycle } from '../../../../lib/billCycle'

/**
 * `/backend/billing/items/[id]` — Billing Item detail.
 *
 * Opens read-only (field grid). The `Edit` button swaps the grid for
 * the `ItemForm`; Save / Cancel return to the read-only view. Loads
 * via the list endpoint (`?id=<id>`), edits through `PUT`, soft-delete
 * via `DELETE` with a `ConfirmDialog` gate.
 *
 * Two read-only badges at the top: `currencyMismatch` and
 * `billedToDate` (Bill Run engine-managed columns the operator
 * cannot edit but needs to see for troubleshooting).
 */

// API list rows are snake_case (see `api/items/route.ts` `fields`).
// `bill_account_name` is resolved by the route's `afterList` hook.
type BillingItemRow = {
  id: string
  bill_account_id: string
  bill_account_name: string | null
  bill_account_currency?: string | null
  bill_account_mode?: 'postpaid' | 'prepaid' | null
  type: 'one_time' | 'recurring' | 'usage'
  bill_start_date: string
  bill_end_date: string | null
  description: string
  rate_json: Record<string, unknown> | null
  uom_code: string | null
  subscription_id: string | null
  subscription_item_id: string | null
  source_ref: string | null
  currency_mismatch: boolean
  billed_to_date: string | null
  charge_timing: 'in_advance' | 'in_arrears'
  prorate: boolean
  tax_rate: string | number | null
  price_basis?: 'net' | 'gross'
  is_active: boolean
  /** L §4.2: own billing period; null = follow the account cycle. */
  billing_period_unit?: BillCycle | null
  billing_period_interval?: number | null
  /** P §4.1: price phases (computed dates) and the switch. */
  phases_enabled?: boolean
  phases?: PhaseRow[]
  /** L §4.3: dated line status periods. */
  statusPeriods?: StatusPeriodRow[]
  created_at: string
  updated_at: string
}

type ListResponse = { items: BillingItemRow[] }

function formatRate(row: BillingItemRow): string {
  const rate = (row.rate_json ?? {}) as Record<string, unknown>
  if (row.type === 'one_time' && typeof rate.amount === 'number') {
    return String(rate.amount)
  }
  if (row.type === 'recurring' && typeof rate.unit_price === 'number') {
    return String(rate.unit_price)
  }
  if (row.type === 'usage') {
    if ('model' in rate && 'tiers' in rate) {
      return `tiered (${String(rate.model)})`
    }
    if (typeof rate.unit_price === 'number') {
      return String(rate.unit_price)
    }
  }
  return '—'
}

function toFormValues(row: BillingItemRow): Partial<ItemFormValues> {
  const rate = (row.rate_json ?? {}) as Record<string, unknown>
  const out: Partial<ItemFormValues> = {
    billAccountId: row.bill_account_id,
    type: row.type,
    billStartDate: row.bill_start_date?.slice(0, 10) ?? '',
    billEndDate: row.bill_end_date?.slice(0, 10) ?? '',
    description: row.description,
    uomCode: row.uom_code ?? '',
    subscriptionId: row.subscription_id ?? '',
    subscriptionItemId: row.subscription_item_id ?? '',
    isActive: row.is_active,
    chargeTiming: row.charge_timing ?? 'in_advance',
    prorate: row.prorate ?? true,
    taxRate: row.tax_rate != null ? String(Number(row.tax_rate)) : '',
    priceBasis: row.price_basis === 'gross' ? 'gross' : 'net',
    periodMode: row.billing_period_unit ? 'own' : 'account',
    periodUnit: row.billing_period_unit ?? 'monthly',
    periodInterval: String(row.billing_period_interval ?? 1),
    phasesEnabled: Boolean(row.phases_enabled),
    phases: phaseRowsFromApi(row.phases),
  }
  if (row.type === 'one_time' && typeof rate.amount === 'number') {
    out.oneTimeAmount = String(rate.amount)
  } else if (row.type === 'recurring' && typeof rate.unit_price === 'number') {
    out.recurringUnitPrice = String(rate.unit_price)
  } else if (row.type === 'usage') {
    if ('model' in rate && 'tiers' in rate) {
      out.usageMode = 'tiered'
      out.usageTieredJson = JSON.stringify(rate, null, 2)
    } else if (typeof rate.unit_price === 'number') {
      out.usageMode = 'simple'
      out.usageUnitPrice = String(rate.unit_price)
    }
  }
  return out
}

// ─── Read-only view ──────────────────────────────────────────────

function ItemView({ row }: { row: BillingItemRow }) {
  const t = useT()
  const locale = useLocale()
  return (
    <DetailCard>
      <DetailField label={t('billing.items.detail.field.account', 'Account')}>
        <Link
          href={`/backend/billing/accounts/${row.bill_account_id}`}
          className="text-primary hover:underline"
        >
          {row.bill_account_name ?? row.bill_account_id}
        </Link>
      </DetailField>
      <DetailField label={t('billing.items.columns.type', 'Type')}>
        <Tag variant="info">{row.type}</Tag>
      </DetailField>
      <DetailField label={t('billing.items.columns.start', 'Start')}>
        {formatBillingDay(row.bill_start_date, locale)}
      </DetailField>
      <DetailField label={t('billing.items.columns.end', 'End')}>
        {formatBillingDay(row.bill_end_date, locale)}
      </DetailField>
      <DetailField label={t('billing.items.form.rate.title', 'Rate')}>
        <span className="inline-flex items-center gap-2">
          <span className="tabular-nums">
            {formatRate(row)}
            {row.bill_account_currency && formatRate(row) !== '—' ? ` ${row.bill_account_currency}` : ''}
          </span>
          <Tag variant="neutral">
            {row.price_basis === 'gross'
              ? t('billing.items.price_basis.gross', 'Gross')
              : t('billing.items.price_basis.net', 'Net')}
          </Tag>
        </span>
      </DetailField>
      <DetailField label={t('billing.items.columns.uom', 'UoM')}>
        {row.uom_code || '—'}
      </DetailField>
      <DetailField label={t('billing.items.form.subscription_id', 'Subscription ID')}>
        {row.subscription_id || '—'}
      </DetailField>
      <DetailField
        label={t('billing.items.form.subscription_item_id', 'Subscription item ID')}
      >
        {row.subscription_item_id || '—'}
      </DetailField>
      <DetailField label={t('billing.items.detail.field.source_ref', 'Source ref')}>
        {row.source_ref ? (
          <span className="font-mono text-xs">{row.source_ref}</span>
        ) : (
          '—'
        )}
      </DetailField>
      <DetailField label={t('billing.items.form.tax_rate', 'VAT rate (%)')}>
        {row.tax_rate != null ? `${Number(row.tax_rate)} %` : '—'}
      </DetailField>
      {row.type === 'recurring' ? (
        <>
          <DetailField label={t('billing.items.form.charge_timing', 'Charge timing')}>
            <Tag variant="neutral">
              {row.charge_timing === 'in_arrears'
                ? t('billing.items.charge_timing.in_arrears', 'In arrears')
                : t('billing.items.charge_timing.in_advance', 'In advance')}
            </Tag>
          </DetailField>
          <DetailField label={t('billing.items.form.prorate', 'Prorate partial periods')}>
            {row.prorate === false ? t('billing.common.no', 'No') : t('billing.common.yes', 'Yes')}
          </DetailField>
          <DetailField label={t('billing.items.period.title', 'Billing period')}>
            {ownPeriodText(t, row.billing_period_unit, row.billing_period_interval)}
          </DetailField>
        </>
      ) : null}
      <DetailField label={t('billing.items.detail.field.billed_to', 'Billed through')}>
        {formatBillingDay(row.billed_to_date, locale)}
      </DetailField>
      {row.currency_mismatch ? (
        <DetailField
          label={t('billing.items.detail.currency_mismatch', 'Currency mismatch')}
        >
          <Tag variant="warning">{t('billing.common.yes', 'Yes')}</Tag>
        </DetailField>
      ) : null}
      <DetailField label={t('billing.items.columns.status', 'Status')}>
        {row.is_active ? (
          <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
        ) : (
          <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
        )}
      </DetailField>
      <DetailField label={t('billing.common.id', 'ID')}>
        <span className="font-mono text-xs">{row.id}</span>
      </DetailField>
    </DetailCard>
  )
}

export default function BillingItemDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const [changePriceOpen, setChangePriceOpen] = React.useState(false)
  // OM serves backend pages through a catch-all route — the dynamic
  // `[id]` segment arrives as a page prop; `useParams()` is the fallback.
  const urlParams = useParams<{ id: string }>()
  const itemId = (props.params?.id ?? urlParams?.id ?? '') as string
  // Spec E (D23): back / after-delete return to the owning account, unless
  // the item was opened from the global Items list (`?from=items`).
  const searchParams = useSearchParams()
  const from = searchParams?.get('from') ?? null

  const [row, setRow] = React.useState<BillingItemRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const today = React.useMemo(() => localTodayIso(), [])
  // Memoised: the phase editor rows carry generated keys, a new object per
  // render would reset the form.
  const formInitial = React.useMemo(() => (row ? toFormValues(row) : undefined), [row])

  const load = React.useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setError(null)
    try {
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/items?id=${itemId}&pageSize=1`,
      )
      const found = result.items?.[0]
      if (!found) {
        setError(t('billing.items.detail.error.not_found', 'Item not found'))
        return
      }
      setRow(found)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      setError(message || t('billing.items.detail.error.load', 'Failed to load item'))
    } finally {
      setLoading(false)
    }
  }, [itemId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = React.useCallback(
    async (assembled: AssembledItemPayload) => {
      if (!row) return
      setSaving(true)
      try {
        const payload: Record<string, unknown> = {
          id: row.id,
          billStartDate: assembled.billStartDate,
          description: assembled.description,
          rateJson: assembled.rateJson,
          isActive: assembled.isActive ?? row.is_active,
        }
        // Optional fields — submit null when the operator cleared them
        // so the column actually resets (the schema validators accept
        // null for nullable columns).
        payload.billEndDate = assembled.billEndDate ?? null
        payload.uomCode = assembled.uomCode ?? null
        payload.subscriptionId = assembled.subscriptionId ?? null
        payload.subscriptionItemId = assembled.subscriptionItemId ?? null
        if (assembled.chargeTiming !== undefined) payload.chargeTiming = assembled.chargeTiming
        if (assembled.prorate !== undefined) payload.prorate = assembled.prorate
        if (assembled.taxRate !== undefined) payload.taxRate = assembled.taxRate
        if (assembled.priceBasis !== undefined) payload.priceBasis = assembled.priceBasis
        if (assembled.creditReason) payload.creditReason = assembled.creditReason
        if (assembled.billingPeriodUnit !== undefined) {
          payload.billingPeriodUnit = assembled.billingPeriodUnit
          payload.billingPeriodInterval = assembled.billingPeriodInterval ?? null
        }
        if (assembled.phasesEnabled !== undefined) payload.phasesEnabled = assembled.phasesEnabled
        if (assembled.phases !== undefined) payload.phases = assembled.phases

        await apiCallOrThrow('/api/billing/items', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        flash(t('billing.items.detail.save.success', 'Item updated'), 'success')
        setEditing(false)
        void load()
      } catch (err) {
        if (serverErrorCode(err) === PHASE_EDIT_BILLED) {
          flash(
            t(
              'billing.items.phases.error.edit_billed',
              'This change re-prices days that are already invoiced. Phases can change only unbilled periods — correct invoiced periods with a credit memo.',
            ),
            'error',
          )
          return
        }
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.items.detail.save.error', 'Save failed'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [load, row, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!row) return
    const ok = await confirm({
      title: t('billing.items.detail.delete.confirm.title', 'Delete item?'),
      text: t(
        'billing.items.detail.delete.confirm.text',
        'Soft-deletes the item. Its row stays in the database for audit; the Bill Run engine will stop including it immediately.',
      ),
      confirmText: t('billing.items.detail.delete.confirm.button', 'Soft delete'),
      variant: 'destructive',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await apiCallOrThrow('/api/billing/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      flash(t('billing.items.detail.delete.success', 'Item deleted'), 'success')
      router.push(resolveItemReturnTarget({ from, billAccountId: row.bill_account_id }))
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.items.detail.delete.error', 'Delete failed'), 'error')
      setDeleting(false)
    }
  }, [confirm, from, router, row, t])

  if (error) {
    return (
      <Page>
        <PageHeader title={t('billing.items.detail.title', 'Billing Item')} />
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (loading || !row) {
    return (
      <Page>
        <PageHeader title={t('billing.items.detail.title', 'Billing Item')} />
        <PageBody>
          <LoadingMessage label={t('billing.items.detail.loading', 'Loading item…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref={resolveItemReturnTarget({ from, billAccountId: row.bill_account_id })}
        entityTypeLabel={t('billing.items.detail.title', 'Billing Item')}
        title={row.description}
        statusBadge={
          <span className="inline-flex flex-wrap items-center gap-2">
            {row.is_active ? (
              <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
            ) : (
              <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
            )}
            <ItemStatusTag periods={row.statusPeriods} today={today} />
            <ItemPhaseTag phases={row.phases} phasesEnabled={row.phases_enabled} today={today} />
          </span>
        }
        actionsContent={
          <>
            {!editing && row.type === 'recurring' && row.is_active ? (
              <Button type="button" variant="outline" onClick={() => setChangePriceOpen(true)}>
                <Repeat size={16} />
                {t('billing.items.change_price.action', 'Change price')}
              </Button>
            ) : null}
            {!editing ? (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil size={16} />
                {t('billing.common.edit', 'Edit')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting
                ? t('billing.items.detail.delete.in_progress', 'Deleting…')
                : t('billing.items.detail.delete.action', 'Soft delete')}
            </Button>
          </>
        }
      />
      <PageBody>
        {editing ? (
          <ItemForm
            mode="edit"
            initial={formInitial}
            accountCurrency={row.bill_account_currency ?? undefined}
            accountBillingMode={row.bill_account_mode ?? undefined}
            billedToDate={row.billed_to_date}
            submitting={saving}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ItemView row={row} />
        )}
        {!editing && row.type === 'recurring' ? (
          <div className="mt-4 flex flex-col gap-4">
            {row.phases && row.phases.length > 0 ? (
              <ItemPhaseScheduleCard
                phases={row.phases}
                phasesEnabled={Boolean(row.phases_enabled)}
                regularPrice={typeof row.rate_json?.unit_price === 'number' ? row.rate_json.unit_price : null}
                currencyCode={row.bill_account_currency}
              />
            ) : null}
            <ItemStatusPeriodsCard
              itemId={row.id}
              periods={row.statusPeriods ?? []}
              readOnly={isStatusReadOnly(row)}
              canSetStatus={row.is_active}
              onChanged={() => void load()}
            />
          </div>
        ) : null}
        {row.type === 'recurring' ? (
          <ChangeItemPriceDialog
            open={changePriceOpen}
            onOpenChange={setChangePriceOpen}
            itemId={row.id}
            currentPrice={typeof row.rate_json?.unit_price === 'number' ? row.rate_json.unit_price : null}
            currencyCode={row.bill_account_currency}
            priceBasis={row.price_basis === 'gross' ? 'gross' : 'net'}
            billStartDate={row.bill_start_date}
            billEndDate={row.bill_end_date}
            billedToDate={row.billed_to_date}
            prorate={row.prorate !== false}
            onChanged={(newItemId) => router.push(`/backend/billing/items/${encodeURIComponent(newItemId)}`)}
          />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
