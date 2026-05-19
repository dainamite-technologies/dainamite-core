"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
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
 * Shared form for Billing Account create + edit.
 *
 * Hand-rolled (not CrudForm) on purpose — the form's `invoiceAddress`
 * jsonb sub-object would need a custom-field renderer in the
 * CrudForm DSL, which is heavier than just rendering five inputs
 * inline. The trade-off is documented in `xd-249-billing-spec.md`
 * Phase 4d notes.
 *
 * UX per the OM UI AGENTS.md:
 *   - `Cmd/Ctrl + Enter` submits.
 *   - Buttons use the `Button` / `Switch` primitives, never raw HTML.
 *   - Footer hint row uses `Kbd` / `KbdShortcut`.
 *
 * `mode='create'` shows the always-required fields. `mode='edit'`
 * disables `customerId` and `currencyCode` per the spec
 * ("immutable per spec — create a new account if the customer FK
 * changes" — see `billingAccountUpdateSchema`).
 */

export type AccountFormValues = {
  customerId: string
  name: string
  currencyCode: string
  billCycle: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  billCycleAnchor: string
  invoiceEmail: string
  invoiceLanguage: string
  taxId: string
  invoiceAddress: {
    line1: string
    line2: string
    city: string
    postal_code: string
    country: string
  }
  nextBillDate: string
  isActive: boolean
}

export type AccountFormProps = {
  mode: 'create' | 'edit'
  initial?: Partial<AccountFormValues>
  submitting?: boolean
  onSubmit: (values: AccountFormValues) => Promise<void> | void
  onCancel: () => void
}

const EMPTY_VALUES: AccountFormValues = {
  customerId: '',
  name: '',
  currencyCode: 'EUR',
  billCycle: 'monthly',
  billCycleAnchor: '1',
  invoiceEmail: '',
  invoiceLanguage: 'en',
  taxId: '',
  invoiceAddress: {
    line1: '',
    line2: '',
    city: '',
    postal_code: '',
    country: 'PL',
  },
  nextBillDate: '',
  isActive: true,
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function mergeInitial(initial: Partial<AccountFormValues> | undefined): AccountFormValues {
  if (!initial) return { ...EMPTY_VALUES, nextBillDate: todayIso() }
  return {
    ...EMPTY_VALUES,
    nextBillDate: EMPTY_VALUES.nextBillDate || todayIso(),
    ...initial,
    invoiceAddress: {
      ...EMPTY_VALUES.invoiceAddress,
      ...(initial.invoiceAddress ?? {}),
    },
  }
}

export function AccountForm({
  mode,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: AccountFormProps) {
  const t = useT()
  const [values, setValues] = React.useState<AccountFormValues>(() => mergeInitial(initial))
  const [error, setError] = React.useState<string | null>(null)
  const isEdit = mode === 'edit'

  // Reset when the parent swaps `initial` (e.g. after loading the edit row).
  const initialKey = React.useMemo(
    () => JSON.stringify(initial ?? null),
    [initial],
  )
  React.useEffect(() => {
    setValues(mergeInitial(initial))
  }, [initialKey, initial])

  const set = React.useCallback(
    <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const setAddress = React.useCallback(
    <K extends keyof AccountFormValues['invoiceAddress']>(
      key: K,
      value: AccountFormValues['invoiceAddress'][K],
    ) => {
      setValues((prev) => ({
        ...prev,
        invoiceAddress: { ...prev.invoiceAddress, [key]: value },
      }))
    },
    [],
  )

  const handleSubmit = React.useCallback(async () => {
    if (!isEdit && !values.customerId.trim()) {
      setError(t('billing.accounts.form.error.customerId_required', 'Customer ID is required'))
      return
    }
    if (!values.name.trim()) {
      setError(t('billing.accounts.form.error.name_required', 'Name is required'))
      return
    }
    if (!isEdit && values.currencyCode.trim().length !== 3) {
      setError(t('billing.accounts.form.error.currency_invalid', 'Currency must be a 3-letter ISO code'))
      return
    }
    if (!values.invoiceEmail.includes('@')) {
      setError(t('billing.accounts.form.error.email_invalid', 'Invoice email looks invalid'))
      return
    }
    if (!values.invoiceAddress.line1.trim() || !values.invoiceAddress.city.trim()) {
      setError(t('billing.accounts.form.error.address_required', 'Invoice address (line 1 + city) is required'))
      return
    }
    if (!values.nextBillDate) {
      setError(t('billing.accounts.form.error.next_bill_date_required', 'Next bill date is required'))
      return
    }
    setError(null)
    await onSubmit(values)
  }, [isEdit, onSubmit, t, values])

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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.customer_id', 'Customer ID')}
            {!isEdit ? <span className="text-destructive"> *</span> : null}
          </span>
          <Input
            value={values.customerId}
            disabled={isEdit}
            onChange={(event) => set('customerId', event.currentTarget.value)}
          />
          {isEdit ? (
            <span className="text-xs text-muted-foreground">
              {t('billing.accounts.form.customer_id.locked', 'Immutable — create a new account to re-link the customer.')}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.name', 'Name')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.name}
            onChange={(event) => set('name', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.currency', 'Currency (ISO 4217)')}
            {!isEdit ? <span className="text-destructive"> *</span> : null}
          </span>
          <Input
            value={values.currencyCode}
            disabled={isEdit}
            maxLength={3}
            onChange={(event) =>
              set('currencyCode', event.currentTarget.value.toUpperCase())
            }
          />
          {isEdit ? (
            <span className="text-xs text-muted-foreground">
              {t('billing.accounts.form.currency.locked', 'Immutable — frozen at account create time.')}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.bill_cycle', 'Bill cycle')}
          </span>
          <Select
            value={values.billCycle}
            onValueChange={(next) =>
              set('billCycle', next as AccountFormValues['billCycle'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">{t('billing.cycle.weekly', 'Weekly')}</SelectItem>
              <SelectItem value="monthly">{t('billing.cycle.monthly', 'Monthly')}</SelectItem>
              <SelectItem value="quarterly">{t('billing.cycle.quarterly', 'Quarterly')}</SelectItem>
              <SelectItem value="annually">{t('billing.cycle.annually', 'Annually')}</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.cycle_anchor', 'Cycle anchor')}
          </span>
          <Input
            value={values.billCycleAnchor}
            placeholder={
              values.billCycle === 'weekly'
                ? t('billing.accounts.form.cycle_anchor.weekly_hint', 'mon | tue | … | sun')
                : t('billing.accounts.form.cycle_anchor.month_hint', '1 — 28')
            }
            onChange={(event) => set('billCycleAnchor', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.next_bill_date', 'Next bill date')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="date"
            value={values.nextBillDate}
            onChange={(event) => set('nextBillDate', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.invoice_email', 'Invoice email')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            type="email"
            value={values.invoiceEmail}
            onChange={(event) => set('invoiceEmail', event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.invoice_language', 'Invoice language (ISO 639-1)')}
          </span>
          <Input
            value={values.invoiceLanguage}
            maxLength={5}
            onChange={(event) =>
              set('invoiceLanguage', event.currentTarget.value.toLowerCase())
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.tax_id', 'Tax ID (NIP / VATIN, optional)')}
          </span>
          <Input
            value={values.taxId}
            onChange={(event) => set('taxId', event.currentTarget.value)}
          />
        </label>
      </div>

      <h3 className="text-sm font-semibold mt-6 mb-2">
        {t('billing.accounts.form.address.title', 'Invoice address')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.line1', 'Line 1')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.invoiceAddress.line1}
            onChange={(event) => setAddress('line1', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.line2', 'Line 2')}
          </span>
          <Input
            value={values.invoiceAddress.line2}
            onChange={(event) => setAddress('line2', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.city', 'City')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.invoiceAddress.city}
            onChange={(event) => setAddress('city', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.postal_code', 'Postal code')}
          </span>
          <Input
            value={values.invoiceAddress.postal_code}
            onChange={(event) => setAddress('postal_code', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.country', 'Country (ISO 3166)')}
          </span>
          <Input
            value={values.invoiceAddress.country}
            maxLength={3}
            onChange={(event) =>
              setAddress('country', event.currentTarget.value.toUpperCase())
            }
          />
        </label>
      </div>

      {isEdit ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              {t('billing.accounts.form.active', 'Active')}
            </div>
            <div className="text-xs text-muted-foreground">
              {t(
                'billing.accounts.form.active.help',
                'Inactive accounts stay billable until soft-deleted — toggle for visibility filtering only.',
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
          {t('billing.accounts.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
          {t('billing.accounts.form.cancel_hint', 'to discard')}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('billing.common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting
              ? t('billing.accounts.form.saving', 'Saving…')
              : isEdit
                ? t('billing.accounts.form.save', 'Save changes')
                : t('billing.accounts.form.create', 'Create account')}
          </Button>
        </div>
      </div>
    </div>
  )
}
