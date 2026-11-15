"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SUPPORTED_INVOICE_LANGUAGES } from '@dainamite/billing/modules/billing/lib/invoiceLanguages'
import type { AccountFields, AccountOption, OrderSetupFormState } from '../../lib/orderSetupForm'

const BILL_CYCLE_OPTIONS = ['monthly', 'quarterly', 'annually', 'weekly'] as const

type AccountSectionProps = {
  state: OrderSetupFormState
  candidates: AccountOption[]
  /** False when the user may not list billing accounts (no `billing.account.view`). */
  canListAccounts: boolean
  disabled: boolean
  onChange: (next: OrderSetupFormState) => void
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

export function AccountSection({ state, candidates, canListAccounts, disabled, onChange }: AccountSectionProps) {
  const t = useT()
  const setAccount = (patch: Partial<AccountFields>) => onChange({ ...state, account: { ...state.account, ...patch } })
  const text = (key: keyof AccountFields) => ({
    id: `cpq-billing-setup-${key}`,
    value: state.account[key],
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setAccount({ [key]: event.target.value }),
  })

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium">{t('cpq_billing_connector.orderSetup.account.title', 'Billing account')}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'cpq_billing_connector.orderSetup.account.description',
            "Only active accounts of this customer in the order's currency can be reused.",
          )}
        </p>
      </div>

      <RadioGroup
        value={state.accountMode}
        onValueChange={(value) => onChange({ ...state, accountMode: value as OrderSetupFormState['accountMode'] })}
        disabled={disabled}
        className="flex flex-row flex-wrap gap-6"
      >
        <label className="flex items-center gap-2 text-sm">
          <Radio value="existing" disabled={disabled || candidates.length === 0} />
          {t('cpq_billing_connector.orderSetup.account.useExisting', 'Use existing account')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Radio value="new" />
          {t('cpq_billing_connector.orderSetup.account.createNew', 'Create new account')}
        </label>
      </RadioGroup>

      {!canListAccounts && (
        <p className="text-xs text-muted-foreground">
          {t(
            'cpq_billing_connector.orderSetup.account.noListPermission',
            'You cannot list billing accounts, so only a new account can be chosen.',
          )}
        </p>
      )}

      {state.accountMode === 'existing' ? (
        <Field id="cpq-billing-setup-account" label={t('cpq_billing_connector.orderSetup.account.select', 'Account')}>
          <Select
            value={state.billingAccountId ?? undefined}
            onValueChange={(value) => onChange({ ...state, billingAccountId: value })}
            disabled={disabled}
          >
            <SelectTrigger id="cpq-billing-setup-account">
              <SelectValue
                placeholder={t('cpq_billing_connector.orderSetup.account.selectPlaceholder', 'Select a billing account')}
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {[option.name, option.currencyCode, option.billCycle, option.nextBillDate]
                    .filter(Boolean)
                    .join(' · ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="cpq-billing-setup-name" label={t('cpq_billing_connector.orderSetup.account.name', 'Account name')}>
            <Input {...text('name')} />
          </Field>
          <Field
            id="cpq-billing-setup-invoiceEmail"
            label={t('cpq_billing_connector.orderSetup.account.invoiceEmail', 'Invoice email')}
          >
            <Input type="email" {...text('invoiceEmail')} />
          </Field>
          <Field
            id="cpq-billing-setup-invoiceLanguage"
            label={t('cpq_billing_connector.orderSetup.account.invoiceLanguage', 'Invoice language')}
          >
            <Select
              value={state.account.invoiceLanguage}
              onValueChange={(value) => setAccount({ invoiceLanguage: value })}
              disabled={disabled}
            >
              <SelectTrigger id="cpq-billing-setup-invoiceLanguage">
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
          </Field>
          <Field id="cpq-billing-setup-taxId" label={t('cpq_billing_connector.orderSetup.account.taxId', 'Tax ID')}>
            <Input {...text('taxId')} />
          </Field>
          <Field id="cpq-billing-setup-line1" label={t('cpq_billing_connector.orderSetup.account.line1', 'Address line 1')}>
            <Input {...text('line1')} />
          </Field>
          <Field id="cpq-billing-setup-line2" label={t('cpq_billing_connector.orderSetup.account.line2', 'Address line 2')}>
            <Input {...text('line2')} />
          </Field>
          <Field id="cpq-billing-setup-city" label={t('cpq_billing_connector.orderSetup.account.city', 'City')}>
            <Input {...text('city')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id="cpq-billing-setup-postalCode"
              label={t('cpq_billing_connector.orderSetup.account.postalCode', 'Postal code')}
            >
              <Input {...text('postalCode')} />
            </Field>
            <Field id="cpq-billing-setup-country" label={t('cpq_billing_connector.orderSetup.account.country', 'Country')}>
              <Input maxLength={3} {...text('country')} />
            </Field>
          </div>
          <Field
            id="cpq-billing-setup-billCycle"
            label={t('cpq_billing_connector.orderSetup.account.billCycle', 'Bill cycle')}
          >
            <Select
              value={state.account.billCycle}
              onValueChange={(value) => setAccount({ billCycle: value })}
              disabled={disabled}
            >
              <SelectTrigger id="cpq-billing-setup-billCycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILL_CYCLE_OPTIONS.map((cycle) => (
                  <SelectItem key={cycle} value={cycle}>
                    {t(`cpq_billing_connector.orderSetup.billCycle.${cycle}`, cycle)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="cpq-billing-setup-billCycleAnchor"
            label={t('cpq_billing_connector.orderSetup.account.billCycleAnchor', 'Bill cycle anchor')}
          >
            <Input {...text('billCycleAnchor')} />
          </Field>
          <Field
            id="cpq-billing-setup-nextBillDate"
            label={t('cpq_billing_connector.orderSetup.account.nextBillDate', 'First bill date')}
          >
            <Input type="date" {...text('nextBillDate')} />
            <p className="text-xs text-muted-foreground">
              {t(
                'cpq_billing_connector.orderSetup.account.nextBillDateHint',
                'Empty = the earliest bill start of the order lines.',
              )}
            </p>
          </Field>
        </div>
      )}
    </section>
  )
}
