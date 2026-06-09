"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Manual Billing Account Usage entry form.
 *
 * Usage is normally ingested by an external metering system via
 * `POST /api/billing/usage` + an `X-Api-Key` scoped to
 * `billing.usage.ingest`. This form gives operators the same path from
 * the admin UI — for corrections, demos, or customers without an
 * automated meter. It POSTs to the very same endpoint, so the
 * idempotency (`sourceRef`) and append-only guarantees are identical.
 *
 * Usage records are immutable once written — there is no edit/delete,
 * hence this is a create-only form (mirrors the `billing.usage.create`
 * command, which has no update sibling).
 */

// The accounts list API returns snake_case rows — mirror that here so
// the picker reads real values (camelCase would resolve to `undefined`).
export type UsageAccountOption = {
  id: string
  name: string
  customer_id: string
  currency_code: string
}

export type UsageFormValues = {
  billAccountId: string
  uomCode: string
  quantity: string
  periodStart: string
  periodEnd: string
  lineDescription: string
  sourceRef: string
}

export type AssembledUsagePayload = {
  billAccountId: string
  uomCode: string
  quantity: number
  periodStart: string
  periodEnd: string
  lineDescription?: string
  sourceRef?: string
}

export type UsageFormProps = {
  accountOptions: UsageAccountOption[]
  initial?: Partial<UsageFormValues>
  submitting?: boolean
  onSubmit: (assembled: AssembledUsagePayload) => Promise<void> | void
  onCancel: () => void
}

const EMPTY_VALUES: UsageFormValues = {
  billAccountId: '',
  uomCode: '',
  quantity: '',
  periodStart: '',
  periodEnd: '',
  lineDescription: '',
  sourceRef: '',
}

function firstOfMonthIso(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function mergeInitial(initial: Partial<UsageFormValues> | undefined): UsageFormValues {
  return {
    ...EMPTY_VALUES,
    periodStart: EMPTY_VALUES.periodStart || firstOfMonthIso(),
    periodEnd: EMPTY_VALUES.periodEnd || todayIso(),
    ...initial,
  }
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function UsageForm({
  accountOptions,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: UsageFormProps) {
  const t = useT()
  const [values, setValues] = React.useState<UsageFormValues>(() => mergeInitial(initial))
  const [error, setError] = React.useState<string | null>(null)

  const initialKey = React.useMemo(() => JSON.stringify(initial ?? null), [initial])
  React.useEffect(() => {
    // Depend on the serialized key only — `initial` is a fresh object ref on
    // every parent render, so including it would re-run this effect (and wipe
    // in-progress edits) whenever the parent re-renders for an unrelated reason.
    setValues(mergeInitial(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const set = React.useCallback(
    <K extends keyof UsageFormValues>(key: K, value: UsageFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const handleSubmit = React.useCallback(async () => {
    if (!values.billAccountId.trim()) {
      setError(t('billing.usage.form.error.account_required', 'Billing Account is required'))
      return
    }
    if (!values.uomCode.trim()) {
      setError(t('billing.usage.form.error.uom_required', 'UoM code is required'))
      return
    }
    const quantity = toNumber(values.quantity)
    if (quantity == null || quantity < 0) {
      setError(
        t('billing.usage.form.error.quantity_invalid', 'Quantity must be a non-negative number'),
      )
      return
    }
    if (!values.periodStart || !values.periodEnd) {
      setError(t('billing.usage.form.error.period_required', 'Period start and end are required'))
      return
    }
    if (values.periodEnd < values.periodStart) {
      setError(
        t('billing.usage.form.error.period_order', 'Period end must be on or after period start'),
      )
      return
    }
    setError(null)

    const payload: AssembledUsagePayload = {
      billAccountId: values.billAccountId,
      uomCode: values.uomCode.trim(),
      quantity,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
    }
    if (values.lineDescription.trim()) payload.lineDescription = values.lineDescription.trim()
    if (values.sourceRef.trim()) payload.sourceRef = values.sourceRef.trim()
    await onSubmit(payload)
  }, [onSubmit, t, values])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  return (
    <div className="rounded-lg border border-border bg-card p-6" onKeyDown={handleKeyDown}>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.usage.form.account', 'Billing Account')}
            <span className="text-destructive"> *</span>
          </span>
          <Select
            value={values.billAccountId}
            onValueChange={(next) => set('billAccountId', next)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t('billing.usage.form.account.placeholder', 'Select an account')}
              />
            </SelectTrigger>
            <SelectContent>
              {accountOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name} · {opt.customer_id} · {opt.currency_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.usage.form.uom_code', 'UoM code')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.uomCode}
            placeholder={t('billing.usage.form.uom_code.placeholder', 'api_request, gb, seat, …')}
            onChange={(event) => set('uomCode', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              'billing.usage.form.uom_code.help',
              'Must exactly match the UoM on a usage Billing Item for this account — no conversion.',
            )}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.usage.form.quantity', 'Quantity')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={values.quantity}
            onChange={(event) => set('quantity', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              'billing.usage.form.quantity.help',
              'Total units consumed in the period (pre-aggregated).',
            )}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.usage.form.period_start', 'Period start')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="date"
            value={values.periodStart}
            onChange={(event) => set('periodStart', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.usage.form.period_end', 'Period end')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="date"
            value={values.periodEnd}
            onChange={(event) => set('periodEnd', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.usage.form.description', 'Description (optional)')}
          </span>
          <Textarea
            value={values.lineDescription}
            rows={2}
            onChange={(event) => set('lineDescription', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              'billing.usage.form.description.help',
              'Shown on its own invoice line when set; otherwise matching records are aggregated into one line.',
            )}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.usage.form.source_ref', 'Source reference (optional)')}
          </span>
          <Input
            value={values.sourceRef}
            onChange={(event) => set('sourceRef', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              'billing.usage.form.source_ref.help',
              'Idempotency key — re-submitting the same reference for this account is deduplicated.',
            )}
          </span>
        </label>
      </div>

      {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
          {t('billing.usage.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
          {t('billing.usage.form.cancel_hint', 'to discard')}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('billing.common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting
              ? t('billing.usage.form.saving', 'Saving…')
              : t('billing.usage.form.create', 'Record usage')}
          </Button>
        </div>
      </div>
    </div>
  )
}
