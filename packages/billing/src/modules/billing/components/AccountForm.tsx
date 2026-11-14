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
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Building2, User } from 'lucide-react'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CustomerKind } from '../data/validators'
import {
  applyCustomerPrefill,
  customerEndpoint,
  extractItems,
  mapPrimaryAddress,
  toCustomerSummary,
  type CustomerSummary,
  type PrefillAddress,
} from '../lib/customerLookup'
import { DEFAULT_INVOICE_LANGUAGE, SUPPORTED_INVOICE_LANGUAGES } from '../lib/invoiceLanguages'
import { fetchCustomerAddressRows } from './customerNames'

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
 *
 * Spec E (B2C): the customer can be a company or a person
 * (`customerKind`, immutable after create). Picking a customer prefills
 * name / invoice email / invoice address — only into empty fields, and a
 * prefill that the operator has not touched is rolled back when they pick a
 * different customer or switch kind.
 */

export type AccountFormValues = {
  customerId: string
  customerKind: CustomerKind
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
  // SPEC-002 — immutable after create (like currencyCode).
  billingMode: 'postpaid' | 'prepaid'
  creditLimit: string
  // Prepaid-only initial low-balance threshold for the balance row.
  lowBalanceThreshold: string
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
  customerKind: 'company',
  name: '',
  currencyCode: 'EUR',
  billCycle: 'monthly',
  billCycleAnchor: '1',
  invoiceEmail: '',
  invoiceLanguage: DEFAULT_INVOICE_LANGUAGE,
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
  billingMode: 'postpaid',
  creditLimit: '0',
  lowBalanceThreshold: '',
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

  // Customer cache for the combobox — populated as the user searches, so the
  // picker can render "Acme Telecom" after selection instead of the raw UUID
  // we send to the API, and so prefill has the name + email at hand.
  const customerCacheRef = React.useRef<Map<string, CustomerSummary>>(new Map())
  // What the last prefill wrote — used to roll it back (only where the
  // operator has not edited it since) when the customer or kind changes.
  const prefilledRef = React.useRef<{ name?: string; invoiceEmail?: string; address?: PrefillAddress }>({})

  const loadCustomerOptions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      const q = (query ?? '').trim()
      if (q) params.set('search', q)
      const call = await apiCall<unknown>(`${customerEndpoint(values.customerKind)}?${params.toString()}`)
      if (!call.ok || call.result == null) return []
      const options: ComboboxOption[] = []
      for (const raw of extractItems(call.result)) {
        const summary = toCustomerSummary(raw)
        if (!summary) continue
        customerCacheRef.current.set(summary.id, summary)
        options.push({ value: summary.id, label: summary.name, description: summary.email })
      }
      return options
    },
    [values.customerKind],
  )

  const resolveCustomerLabel = React.useCallback(
    (id: string) => customerCacheRef.current.get(id)?.name ?? id,
    [],
  )
  const resolveCustomerDescription = React.useCallback(
    (id: string) => customerCacheRef.current.get(id)?.email ?? null,
    [],
  )

  // Pure: strip fields that still hold the last prefill (untouched by the
  // operator). Kept free of side effects so it is safe inside state updaters.
  const withoutUntouchedPrefill = React.useCallback((prev: AccountFormValues): AccountFormValues => {
    const filled = prefilledRef.current
    let next = prev
    if (filled.name !== undefined && prev.name === filled.name) next = { ...next, name: '' }
    if (filled.invoiceEmail !== undefined && prev.invoiceEmail === filled.invoiceEmail) {
      next = { ...next, invoiceEmail: '' }
    }
    if (filled.address && JSON.stringify(prev.invoiceAddress) === JSON.stringify(filled.address)) {
      next = { ...next, invoiceAddress: { ...EMPTY_VALUES.invoiceAddress } }
    }
    return next
  }, [])

  const handleKindChange = React.useCallback(
    (next: string) => {
      const kind: CustomerKind = next === 'person' ? 'person' : 'company'
      if (values.customerKind === kind) return
      const reset = { ...withoutUntouchedPrefill(values), customerKind: kind, customerId: '' }
      prefilledRef.current = {}
      setValues(reset)
    },
    [values, withoutUntouchedPrefill],
  )

  const handleCustomerChange = React.useCallback(
    (customerId: string) => {
      const summary = customerCacheRef.current.get(customerId) ?? null
      const base = { ...withoutUntouchedPrefill(values), customerId }
      const filled = applyCustomerPrefill(base, summary, null)
      prefilledRef.current = {
        ...(filled.name !== base.name ? { name: filled.name } : {}),
        ...(filled.invoiceEmail !== base.invoiceEmail ? { invoiceEmail: filled.invoiceEmail } : {}),
      }
      setValues(filled)
      if (!customerId) return
      void fetchCustomerAddressRows(customerId).then((rows) => {
        const address = mapPrimaryAddress(rows)
        if (!address) return
        setValues((prev) => {
          // Ignore a late response for a customer the operator already left.
          if (prev.customerId !== customerId) return prev
          return applyCustomerPrefill(prev, null, address)
        })
        // Record what we wrote; harmless if the updater above skipped (the
        // rollback compares values, so a non-matching address is kept).
        prefilledRef.current = { ...prefilledRef.current, address }
      })
    },
    [values, withoutUntouchedPrefill],
  )

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
      setError(t('billing.accounts.form.error.customerId_required', 'Please select a customer'))
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
    if (
      !values.invoiceAddress.line1.trim() ||
      !values.invoiceAddress.city.trim() ||
      !values.invoiceAddress.postal_code.trim()
    ) {
      setError(
        t(
          'billing.accounts.form.error.address_required',
          'Invoice address (line 1 + city + postal code) is required',
        ),
      )
      return
    }
    const country = values.invoiceAddress.country.trim()
    if (country.length < 2 || country.length > 3) {
      setError(
        t(
          'billing.accounts.form.error.country_invalid',
          'Country must be a 2- or 3-letter ISO 3166 code',
        ),
      )
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
        <div className="flex flex-col gap-1 text-sm col-span-2">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.customer_kind', 'Customer type')}
          </span>
          {isEdit ? (
            <span className="inline-flex items-center gap-2">
              {values.customerKind === 'person' ? <User size={16} /> : <Building2 size={16} />}
              {values.customerKind === 'person'
                ? t('billing.accounts.kind.person', 'Person')
                : t('billing.accounts.kind.company', 'Company')}
            </span>
          ) : (
            <SegmentedControl
              value={values.customerKind}
              onValueChange={handleKindChange}
              aria-label={t('billing.accounts.form.customer_kind', 'Customer type')}
              className="self-start"
            >
              <SegmentedControlItem value="company">
                <Building2 size={14} />
                {t('billing.accounts.kind.company', 'Company')}
              </SegmentedControlItem>
              <SegmentedControlItem value="person">
                <User size={14} />
                {t('billing.accounts.kind.person', 'Person')}
              </SegmentedControlItem>
            </SegmentedControl>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {isEdit
              ? t('billing.accounts.form.customer_id', 'Customer ID')
              : values.customerKind === 'person'
                ? t('billing.accounts.form.customer.person', 'Person')
                : t('billing.accounts.form.customer.company', 'Company')}
            {!isEdit ? <span className="text-destructive"> *</span> : null}
          </span>
          {isEdit ? (
            <Input value={values.customerId} disabled />
          ) : (
            <ComboboxInput
              // Re-mount on kind switch so cached suggestions from the other
              // collection never leak into this one.
              key={values.customerKind}
              value={values.customerId}
              onChange={handleCustomerChange}
              loadSuggestions={loadCustomerOptions}
              resolveLabel={resolveCustomerLabel}
              resolveDescription={resolveCustomerDescription}
              placeholder={
                values.customerKind === 'person'
                  ? t('billing.accounts.form.customer.placeholder_person', 'Search people by name or email…')
                  : t('billing.accounts.form.customer.placeholder', 'Search customers by name or email…')
              }
              allowCustomValues={false}
            />
          )}
          {isEdit ? (
            <span className="text-xs text-muted-foreground">
              {t('billing.accounts.form.customer_id.locked', 'Immutable — create a new account to re-link the customer.')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t(
                'billing.accounts.form.customer.prefill_hint',
                'Name, invoice email and address are prefilled from the customer record when empty.',
              )}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.name', 'Name')}
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.name}
            placeholder={
              !isEdit
                ? t(
                    'billing.accounts.form.name.placeholder',
                    'Auto-filled from customer — override e.g. "Acme — production"',
                  )
                : undefined
            }
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
            {t('billing.accounts.form.invoice_language', 'Invoice language')}
          </span>
          <Select
            value={values.invoiceLanguage}
            onValueChange={(next) => set('invoiceLanguage', next)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_INVOICE_LANGUAGES.map((language) => (
                <SelectItem key={language.code} value={language.code}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <span className="text-destructive"> *</span>
          </span>
          <Input
            value={values.invoiceAddress.postal_code}
            onChange={(event) => setAddress('postal_code', event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.form.address.country', 'Country (ISO 3166)')}
            <span className="text-destructive"> *</span>
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

      <h3 className="text-sm font-semibold mt-6 mb-2">
        {t('billing.accounts.form.mode.title', 'Billing mode & credit')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.columns.mode', 'Mode')}
          </span>
          <Select
            value={values.billingMode}
            disabled={isEdit}
            onValueChange={(next) => set('billingMode', next as AccountFormValues['billingMode'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="postpaid">{t('billing.mode.postpaid', 'Postpaid')}</SelectItem>
              <SelectItem value="prepaid">{t('billing.mode.prepaid', 'Prepaid')}</SelectItem>
            </SelectContent>
          </Select>
          {isEdit ? (
            <span className="text-xs text-muted-foreground">
              {t('billing.accounts.form.mode.locked', 'Immutable — frozen at account create time.')}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {t('billing.accounts.columns.credit_limit', 'Credit limit')}
          </span>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={values.creditLimit}
            onChange={(event) => set('creditLimit', event.currentTarget.value)}
          />
        </label>

        {values.billingMode === 'prepaid' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.prepaid.panel.threshold', 'Low threshold')}
            </span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={values.lowBalanceThreshold}
              placeholder={t('billing.accounts.form.threshold.hint', 'Blank = tenant default')}
              onChange={(event) => set('lowBalanceThreshold', event.currentTarget.value)}
            />
          </label>
        ) : null}
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
