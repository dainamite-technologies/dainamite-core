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
import Link from 'next/link'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ItemPriceField } from './ItemPriceField'
import { BILLING_SETTINGS_HREF } from './BillingSettingsLink'
import { counterpartAmount, type PriceBasis } from '../lib/lineAmounts'
import { CreditReasonField, isCreditReasonRequired } from './CreditReasonField'
import { endsBeforeStart } from '../lib/itemDates'

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
  // Spec A — recurring only.
  chargeTiming: 'in_advance' | 'in_arrears'
  prorate: boolean
  // Spec B — VAT %. Empty on create → the organization default.
  taxRate: string
  // Spec F (F-D2) — the basis the price inputs are entered on.
  priceBasis: PriceBasis
}

// The accounts list API (`/api/billing/accounts`) returns snake_case
// rows — mirror that here so the picker reads real values. (camelCase
// resolved to `undefined`, rendering "Name · undefined · undefined".)
export type AccountOption = {
  id: string
  name: string
  customer_id: string
  currency_code: string
  billing_mode?: 'postpaid' | 'prepaid'
}

export type ItemFormProps = {
  mode: 'create' | 'edit'
  /** For create mode: full list of accounts the operator can attach to. */
  accountOptions?: AccountOption[]
  initial?: Partial<ItemFormValues>
  /** Edit mode: the item's account mode (prepaid tax-point rules, Spec F). */
  accountBillingMode?: 'postpaid' | 'prepaid'
  /** Edit mode: the item's account currency, shown next to the rate (Spec F, F2). */
  accountCurrency?: string
  /** Edit mode: how far the item is billed — drives the credit warning (Part 2). */
  billedToDate?: string | null
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
  chargeTiming?: 'in_advance' | 'in_arrears'
  prorate?: boolean
  taxRate?: number
  priceBasis?: PriceBasis
  /** Part 2: set when the new end date credits already-billed days. */
  creditReason?: string
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
  chargeTiming: 'in_advance',
  prorate: true,
  taxRate: '',
  priceBasis: 'net',
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
  accountBillingMode,
  accountCurrency,
  billedToDate = null,
  submitting = false,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  const t = useT()
  const [values, setValues] = React.useState<ItemFormValues>(() => mergeInitial(initial))
  const selectedAccount = accountOptions?.find((option) => option.id === values.billAccountId)
  const isPrepaidAccount = accountBillingMode === 'prepaid' || selectedAccount?.billing_mode === 'prepaid'
  // Read-only: the currency always comes from the parent account.
  const currencyCode = accountCurrency ?? selectedAccount?.currency_code ?? ''
  const [error, setError] = React.useState<string | null>(null)
  const isEdit = mode === 'edit'
  const [creditReason, setCreditReason] = React.useState('')
  // Part 2: an earlier end date on a billed recurring item credits days — ask why.
  const initialEndDate = initial?.billEndDate ?? ''
  const endDateChanged = isEdit && values.billEndDate !== initialEndDate
  const creditItem = {
    type: values.type,
    prorate: initial?.prorate ?? true,
    billStartDate: values.billStartDate || initial?.billStartDate || '',
    billedToDate,
  }
  const creditReasonRequired =
    endDateChanged && isCreditReasonRequired(creditItem, values.billEndDate || null)

  const initialKey = React.useMemo(() => JSON.stringify(initial ?? null), [initial])
  React.useEffect(() => {
    setValues(mergeInitial(initial))
  }, [initialKey, initial])

  // Spec B: prefill the VAT rate with the organization default on create.
  // Spec F (F-D3): the prepaid tax point decides whether VAT applies to
  // prepaid charges at all. Best effort — without settings access the server
  // applies the default rate and the form assumes the `topup` default.
  const [prepaidTaxPoint, setPrepaidTaxPoint] = React.useState<'topup' | 'consumption'>('topup')
  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ settings?: { defaultTaxRate?: number; prepaidTaxPoint?: 'topup' | 'consumption' } }>(
      '/api/billing/settings',
    ).then((call) => {
      if (cancelled || !call.ok) return
      const settings = call.result?.settings
      if (settings?.prepaidTaxPoint === 'consumption') setPrepaidTaxPoint('consumption')
      const rate = settings?.defaultTaxRate
      if (!isEdit && typeof rate === 'number') {
        setValues((prev) => (prev.taxRate === '' ? { ...prev, taxRate: String(rate) } : prev))
      }
    })
    return () => {
      cancelled = true
    }
  }, [isEdit])

  // Prepaid + tax at top-up: VAT was charged on the receipt, so the item
  // price is debited as entered — the VAT rate and basis do not apply.
  const taxLocked = isPrepaidAccount && prepaidTaxPoint === 'topup'
  // Tiered usage rates are always net (P-D4).
  const basisForcedNet = values.type === 'usage' && values.usageMode === 'tiered'
  const effectiveBasis: PriceBasis = basisForcedNet ? 'net' : values.priceBasis

  // Switching the basis converts the typed prices, so the price stays the same.
  const handleBasisChange = React.useCallback((next: string) => {
    const target: PriceBasis = next === 'gross' ? 'gross' : 'net'
    setValues((prev) => {
      if (prev.priceBasis === target) return prev
      const rate = toNumber(prev.taxRate) ?? 0
      const convert = (raw: string, decimals: number): string => {
        const amount = toNumber(raw)
        if (amount === null) return raw
        const converted =
          decimals > 2
            ? prev.priceBasis === 'gross'
              ? amount / (1 + rate / 100)
              : amount * (1 + rate / 100)
            : counterpartAmount(amount, prev.priceBasis, rate)
        return String(Number(converted.toFixed(decimals)))
      }
      return {
        ...prev,
        priceBasis: target,
        oneTimeAmount: convert(prev.oneTimeAmount, 2),
        recurringUnitPrice: convert(prev.recurringUnitPrice, 2),
        usageUnitPrice: convert(prev.usageUnitPrice, 6),
      }
    })
  }, [])

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
    if (values.billEndDate && endsBeforeStart(values.billStartDate, values.billEndDate)) {
      setError(t('billing.items.form.error.end_before_start', 'The end date cannot be more than one day before the start date'))
      return
    }
    if (creditReasonRequired && !creditReason.trim()) {
      setError(t('billing.items.form.error.credit_reason_required', 'Give the reason for the credit — it is shown on the invoice'))
      return
    }
    const taxRate = toNumber(values.taxRate)
    if (values.taxRate.trim() !== '' && (taxRate == null || taxRate < 0 || taxRate > 100)) {
      setError(t('billing.items.form.error.tax_rate_invalid', 'VAT rate must be between 0 and 100'))
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
    if (values.type === 'recurring') {
      payload.chargeTiming = values.chargeTiming
      payload.prorate = values.prorate
    }
    if (taxRate != null) payload.taxRate = taxRate
    payload.priceBasis = effectiveBasis
    if (isEdit) payload.isActive = values.isActive
    if (creditReasonRequired) payload.creditReason = creditReason.trim()
    await onSubmit(payload)
  }, [buildRateJson, creditReason, creditReasonRequired, effectiveBasis, isEdit, onSubmit, t, values])

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
                    {opt.name} · {opt.customer_id} · {opt.currency_code}
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
                  {t('billing.items.form.type.one_time', 'One-time charge')}
                </SelectItem>
                <SelectItem value="recurring">
                  {t('billing.items.form.type.recurring', 'Recurring (per cycle)')}
                </SelectItem>
                <SelectItem value="usage">
                  {t('billing.items.form.type.usage', 'Usage (metered)')}
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

        {endDateChanged ? (
          <div className="col-span-2">
            <CreditReasonField
              item={creditItem}
              newEndDate={values.billEndDate || null}
              value={creditReason}
              onChange={setCreditReason}
            />
          </div>
        ) : null}

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

      <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('billing.items.form.rate.title', 'Rate')}</h3>
        <SegmentedControl
          value={effectiveBasis}
          onValueChange={handleBasisChange}
          disabled={taxLocked || basisForcedNet}
          aria-label={t('billing.items.form.price_basis', 'Price entered as')}
        >
          <SegmentedControlItem value="net">{t('billing.items.price_basis.net', 'Net')}</SegmentedControlItem>
          <SegmentedControlItem value="gross">{t('billing.items.price_basis.gross', 'Gross')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {basisForcedNet && !taxLocked ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t('billing.items.form.price_basis.tiered_net', 'Tiered rates are always entered net.')}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        {values.type === 'one_time' ? (
          <ItemPriceField
            label={t('billing.items.form.rate.amount', 'Amount')}
            value={values.oneTimeAmount}
            onChange={(next) => set('oneTimeAmount', next)}
            step="0.01"
            currencyCode={currencyCode}
            priceBasis={effectiveBasis}
            taxRate={values.taxRate}
            showCounterpart={!taxLocked}
            help={t('billing.items.form.rate.amount.help', 'Negative allowed for refunds / credits / proration credits.')}
          />
        ) : null}

        {values.type === 'recurring' ? (
          <ItemPriceField
            label={t('billing.items.form.rate.unit_price_recurring', 'Unit price per cycle')}
            value={values.recurringUnitPrice}
            onChange={(next) => set('recurringUnitPrice', next)}
            step="0.01"
            currencyCode={currencyCode}
            priceBasis={effectiveBasis}
            taxRate={values.taxRate}
            showCounterpart={!taxLocked}
          />
        ) : null}

        {values.type === 'usage' && values.usageMode === 'simple' ? (
          <ItemPriceField
            label={t('billing.items.form.rate.unit_price_usage', 'Unit price per unit consumed')}
            value={values.usageUnitPrice}
            onChange={(next) => set('usageUnitPrice', next)}
            step="0.000001"
            currencyCode={currencyCode}
            priceBasis={effectiveBasis}
            taxRate={values.taxRate}
            showCounterpart={!taxLocked}
            precision={6}
          />
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('billing.items.form.tax_rate', 'VAT rate (%)')}</span>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={values.taxRate}
            disabled={taxLocked}
            onChange={(event) => set('taxRate', event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            {taxLocked ? (
              <>
                {t('billing.items.form.tax_rate.prepaid_topup', 'For prepaid accounts, tax is allocated at top-up.')}{' '}
                <Link href={BILLING_SETTINGS_HREF} className="text-primary hover:underline">
                  {t('billing.settings.link', 'Billing settings')}
                </Link>
              </>
            ) : isPrepaidAccount ? (
              t('billing.items.form.tax_rate.prepaid_consumption', 'Charged from the balance including VAT.')
            ) : isEdit ? (
              t('billing.items.form.tax_rate.help_edit', 'Applies to future invoices; posted invoices keep their rate.')
            ) : (
              t('billing.items.form.tax_rate.help', 'Defaults to the organization VAT rate from billing settings.')
            )}
          </span>
        </label>

        {values.type === 'recurring' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.items.form.charge_timing', 'Charge timing')}
            </span>
            <Select
              value={values.chargeTiming}
              onValueChange={(next) => set('chargeTiming', next === 'in_arrears' ? 'in_arrears' : 'in_advance')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_advance">
                  {t('billing.items.charge_timing.in_advance', 'In advance')}
                </SelectItem>
                <SelectItem value="in_arrears">
                  {t('billing.items.charge_timing.in_arrears', 'In arrears')}
                </SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {values.chargeTiming === 'in_arrears'
                ? t('billing.items.form.charge_timing.help_arrears', 'Each bill date charges the period that just ended.')
                : t('billing.items.form.charge_timing.help_advance', 'Each bill date charges the coming period.')}
            </span>
          </label>
        ) : null}

        {values.type === 'recurring' ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div>
              <div className="font-medium">
                {t('billing.items.form.prorate', 'Prorate partial periods')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(
                  'billing.items.form.prorate.help',
                  'Charge by calendar days when the item starts or ends mid-period, and credit unused days if it ends after being billed in advance.',
                )}
              </div>
            </div>
            <Switch checked={values.prorate} onCheckedChange={(next) => set('prorate', next)} />
          </div>
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

            {values.usageMode === 'tiered' ? (
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
                {currencyCode ? (
                  <span className="text-xs text-muted-foreground">
                    {t('billing.items.form.rate.prices_in', 'Prices in')} <span className="font-medium">{currencyCode}</span>
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {t(
                    'billing.items.form.rate.tiered_json.help',
                    'Models: volume / graduated / flat. Exactly one tier must have `up_to: null` (the open-ended top tier). Server-side validators reject malformed shapes.',
                  )}
                </span>
              </label>
            ) : null}

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
