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
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Shared form for Billing Item create + edit.
 *
 * The `rate_json` field is type-discriminated per the spec's
 * "Rate Formats" section:
 *   - `one_time`: `{ amount }` — one number.
 *   - `recurring`: `{ unit_price }` — one number.
 *   - `usage` (simple): `{ unit_price }` + required `uomCode`.
 *   - `usage` (tiered, advanced): operator pastes raw JSON
 *     `{ model, tiers: [...] }` into the textarea — for occasional
 *     hand-built tiered rates. The integration flow uses CPQ →
 *     connector to land tiered rates without UI input.
 *
 * `type` is immutable on edit (per `billingItemUpdateSchema`); we
 * hide the `type` selector in `mode='edit'` so it can't even be
 * surfaced.
 */

type BillingItemType = 'one_time' | 'recurring' | 'usage'
type UsageRateMode = 'simple' | 'tiered'

export type ItemFormValues = {
  billAccountId: string
  type: BillingItemType
  billStartDate: string
  billEndDate: string
  description: string
  // Rate is type-dependent — we keep the inputs separate and assemble
  // `rate_json` on submit.
  oneTimeAmount: string
  recurringUnitPrice: string
  usageMode: UsageRateMode
  usageUnitPrice: string
  usageTieredJson: string
  uomCode: string
  subscriptionId: string
  subscriptionItemId: string
  isActive: boolean
}

export type AccountOption = {
  id: string
  name: string
  customerId: string
  currencyCode: string
}

export type ItemFormProps = {
  mode: 'create' | 'edit'
  /** For create mode: full list of accounts the operator can attach to. */
  accountOptions?: AccountOption[]
  initial?: Partial<ItemFormValues>
  submitting?: boolean
  /** Returns the assembled payload (with rate_json built). */
  onSubmit: (assembled: AssembledItemPayload) => Promise<void> | void
  onCancel: () => void
}

export type AssembledItemPayload = {
  billAccountId: string
  type: BillingItemType
  billStartDate: string
  billEndDate?: string
  description: string
  rateJson: Record<string, unknown>
  uomCode?: string
  subscriptionId?: string
  subscriptionItemId?: string
  isActive?: boolean
}

const EMPTY_VALUES: ItemFormValues = {
  billAccountId: '',
  type: 'recurring',
  billStartDate: '',
  billEndDate: '',
  description: '',
  oneTimeAmount: '',
  recurringUnitPrice: '',
  usageMode: 'simple',
  usageUnitPrice: '',
  usageTieredJson: '',
  uomCode: '',
  subscriptionId: '',
  subscriptionItemId: '',
  isActive: true,
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function mergeInitial(initial: Partial<ItemFormValues> | undefined): ItemFormValues {
  return {
    ...EMPTY_VALUES,
    billStartDate: EMPTY_VALUES.billStartDate || todayIso(),
    ...initial,
  }
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function ItemForm({
  mode,
  accountOptions,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  const t = useT()
  const [values, setValues] = React.useState<ItemFormValues>(() => mergeInitial(initial))
  const [error, setError] = React.useState<string | null>(null)
  const isEdit = mode === 'edit'

  const initialKey = React.useMemo(() => JSON.stringify(initial ?? null), [initial])
  React.useEffect(() => {
    setValues(mergeInitial(initial))
  }, [initialKey, initial])

  const set = React.useCallback(
    <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const buildRateJson = React.useCallback((): Record<string, unknown> | string => {
    switch (values.type) {
      case 'one_time': {
        const amount = toNumber(values.oneTimeAmount)
        if (amount == null) {
          return t('billing.items.form.error.amount_invalid', 'Amount must be a number')
        }
        return { amount }
      }
      case 'recurring': {
        const unit = toNumber(values.recurringUnitPrice)
        if (unit == null || unit < 0) {
          return t(
            'billing.items.form.error.unit_price_invalid',
            'Unit price must be a non-negative number',
          )
        }
        return { unit_price: unit }
      }
      case 'usage': {
        if (values.usageMode === 'simple') {
          const unit = toNumber(values.usageUnitPrice)
          if (unit == null || unit < 0) {
            return t(
              'billing.items.form.error.unit_price_invalid',
              'Unit price must be a non-negative number',
            )
          }
          return { unit_price: unit }
        }
        // Tiered: parse the textarea as JSON.
        const raw = values.usageTieredJson.trim()
        if (!raw) {
          return t(
            'billing.items.form.error.tiered_required',
            'Tiered rate JSON is required for tiered usage',
          )
        }
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            !('model' in parsed) ||
            !('tiers' in parsed)
          ) {
            return t(
              'billing.items.form.error.tiered_shape',
              'Tiered JSON must include `model` and `tiers`',
            )
          }
          return parsed
        } catch {
          return t(
            'billing.items.form.error.tiered_json',
            'Tiered rate JSON is not valid JSON',
          )
        }
      }
    }
  }, [
    t,
    values.oneTimeAmount,
    values.recurringUnitPrice,
    values.type,
    values.usageMode,
    values.usageTieredJson,
    values.usageUnitPrice,
  ])

  const handleSubmit = React.useCallback(async () => {
    if (!isEdit && !values.billAccountId.trim()) {
      setError(t('billing.items.form.error.account_required', 'Billing Account is required'))
      return
    }
    if (!values.description.trim()) {
      setError(t('billing.items.form.error.description_required', 'Description is required'))
      return
    }
    if (!values.billStartDate) {
      setError(t('billing.items.form.error.start_date_required', 'Bill start date is required'))
      return
    }
    if (values.type === 'usage' && !values.uomCode.trim()) {
      setError(t('billing.items.form.error.uom_required', 'UoM code is required for usage items'))
      return
    }
    const rateJsonResult = buildRateJson()
    if (typeof rateJsonResult === 'string') {
      // builder returned an error message
      setError(rateJsonResult)
      return
    }
    setError(null)

    const payload: AssembledItemPayload = {
      billAccountId: values.billAccountId,
      type: values.type,
      billStartDate: values.billStartDate,
      description: values.description.trim(),
      rateJson: rateJsonResult,
    }
    if (values.billEndDate) payload.billEndDate = values.billEndDate
    if (values.type === 'usage' && values.uomCode.trim()) {
      payload.uomCode = values.uomCode.trim()
    }
    if (values.subscriptionId.trim()) payload.subscriptionId = values.subscriptionId.trim()
    if (values.subscriptionItemId.trim()) {
      payload.subscriptionItemId = values.subscriptionItemId.trim()
    }
    if (isEdit) payload.isActive = values.isActive
    await onSubmit(payload)
  }, [buildRateJson, isEdit, onSubmit, t, values])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="rounded-lg border border-border bg-card p-6" onKeyDown={handleKeyDown}>
      <div className="grid grid-cols-2 gap-4">
        {!isEdit ? (
          <label className="flex flex-col gap-1 text-sm col-span-2">
            <span className="text-muted-foreground">
              {t('billing.items.form.account', 'Billing Account')}
              <span className="text-destructive"> *</span>
            </span>
            <Select
              value={values.billAccountId}
              onValueChange={(next) => set('billAccountId', next)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('billing.items.form.account.placeholder', 'Select an account')} />
              </SelectTrigger>
              <SelectContent>
                {(accountOptions ?? []).map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name} · {opt.customerId} · {opt.currencyCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        {!isEdit ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.items.form.type', 'Type')}
              <span className="text-destructive"> *</span>
            </span>
            <Select
              value={values.type}
              onValueChange={(next) => set('type', next as BillingItemType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">
                  {t('billing.items.type.one_time', 'One-time charge')}
                </SelectItem>
                <SelectItem value="recurring">
                  {t('billing.items.type.recurring', 'Recurring (per cycle)')}
                </SelectItem>
                <SelectItem value="usage">
                  {t('billing.items.type.usage', 'Usage (metered)')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.items.form.start_date', 'Bill start date')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="date"
            value={values.billStartDate}
            onChange={(event) => set('billStartDate', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.items.form.end_date', 'Bill end date (optional)')}
          </span>
          <Input
            type="date"
            value={values.billEndDate}
            onChange={(event) => set('billEndDate', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.items.form.description', 'Description')}
            <span className="text-destructive"> *</span>
          </span>
          <Textarea
            value={values.description}
            rows={2}
            onChange={(event) => set('description', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              'billing.items.form.description.help',
              'Shown verbatim on the invoice line.',
            )}
          </span>
        </label>
      </div>

      <h3 className="text-sm font-semibold mt-6 mb-2">
        {t('billing.items.form.rate.title', 'Rate')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        {values.type === 'one_time' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.items.form.rate.amount', 'Amount')}
              <span className="text-destructive"> *</span>
            </span>
            <Input
              type="number"
              step="0.0001"
              value={values.oneTimeAmount}
              onChange={(event) => set('oneTimeAmount', event.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">
              {t(
                'billing.items.form.rate.amount.help',
                'Negative allowed for refunds / credits / proration credits.',
              )}
            </span>
          </label>
        ) : null}

        {values.type === 'recurring' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.items.form.rate.unit_price_recurring', 'Unit price per cycle')}
              <span className="text-destructive"> *</span>
            </span>
            <Input
              type="number"
              step="0.0001"
              value={values.recurringUnitPrice}
              onChange={(event) => set('recurringUnitPrice', event.currentTarget.value)}
            />
          </label>
        ) : null}

        {values.type === 'usage' ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('billing.items.form.rate.usage_mode', 'Rate model')}
              </span>
              <Select
                value={values.usageMode}
                onValueChange={(next) => set('usageMode', next as UsageRateMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">
                    {t('billing.items.form.rate.usage_mode.simple', 'Simple flat rate')}
                  </SelectItem>
                  <SelectItem value="tiered">
                    {t('billing.items.form.rate.usage_mode.tiered', 'Tiered (volume / graduated / flat)')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            {values.usageMode === 'simple' ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {t('billing.items.form.rate.unit_price_usage', 'Unit price per unit consumed')}
                  <span className="text-destructive"> *</span>
                </span>
                <Input
                  type="number"
                  step="0.000001"
                  value={values.usageUnitPrice}
                  onChange={(event) => set('usageUnitPrice', event.currentTarget.value)}
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-sm col-span-2">
                <span className="text-muted-foreground">
                  {t('billing.items.form.rate.tiered_json', 'Tiered rate JSON')}
                  <span className="text-destructive"> *</span>
                </span>
                <Textarea
                  rows={6}
                  value={values.usageTieredJson}
                  placeholder='{ "model": "graduated", "tiers": [{ "up_to": 10000, "unit_price": 0 }, { "up_to": null, "unit_price": 0.001 }] }'
                  onChange={(event) => set('usageTieredJson', event.currentTarget.value)}
                />
                <span className="text-xs text-muted-foreground">
                  {t(
                    'billing.items.form.rate.tiered_json.help',
                    'Models: volume / graduated / flat. Exactly one tier must have `up_to: null` (the open-ended top tier). Server-side validators reject malformed shapes.',
                  )}
                </span>
              </label>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('billing.items.form.uom_code', 'UoM code')}
                <span className="text-destructive"> *</span>
              </span>
              <Input
                value={values.uomCode}
                placeholder="api_request, gb, seat, …"
                onChange={(event) => set('uomCode', event.currentTarget.value)}
              />
              <span className="text-xs text-muted-foreground">
                {t(
                  'billing.items.form.uom_code.help',
                  'Must exactly match the `uom_code` on usage records. No conversion.',
                )}
              </span>
            </label>
          </>
        ) : null}
      </div>

      <h3 className="text-sm font-semibold mt-6 mb-2">
        {t('billing.items.form.refs.title', 'External references (optional)')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.items.form.subscription_id', 'Subscription ID')}
          </span>
          <Input
            value={values.subscriptionId}
            onChange={(event) => set('subscriptionId', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.items.form.subscription_item_id', 'Subscription item ID')}
          </span>
          <Input
            value={values.subscriptionItemId}
            onChange={(event) => set('subscriptionItemId', event.currentTarget.value)}
          />
        </label>
      </div>

      {isEdit ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              {t('billing.items.form.active', 'Active')}
            </div>
            <div className="text-xs text-muted-foreground">
              {t(
                'billing.items.form.active.help',
                'Inactive items are skipped by the Bill Run engine.',
              )}
            </div>
          </div>
          <Switch
            checked={values.isActive}
            onCheckedChange={(next) => set('isActive', next)}
          />
        </div>
      ) : null}

      {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
          {t('billing.items.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
          {t('billing.items.form.cancel_hint', 'to discard')}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('billing.common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting
              ? t('billing.items.form.saving', 'Saving…')
              : isEdit
                ? t('billing.items.form.save', 'Save changes')
                : t('billing.items.form.create', 'Create item')}
          </Button>
        </div>
      </div>
    </div>
  )
}
