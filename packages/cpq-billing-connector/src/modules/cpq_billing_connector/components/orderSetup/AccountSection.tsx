"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { SUPPORTED_INVOICE_LANGUAGES } from '@dainamite/billing/modules/billing/lib/invoiceLanguages'
import {
  BILL_CYCLES,
  BILL_CYCLE_INTERVAL_MAX,
  WEEKDAYS,
  type BillCycle,
} from '@dainamite/billing/modules/billing/lib/billCycle'
import {
  changeCycleUnit,
  parseCycleInterval,
  type AccountFields,
  type AccountOption,
  type OrderSetupFormState,
} from '../../lib/orderSetupForm'

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1))
// Monday-first for the picker; storage codes stay `sun`…`sat`.
const WEEKDAY_ORDER = [...WEEKDAYS.slice(1), WEEKDAYS[0]]
const PLURAL_KEYS = new Set(['one', 'few', 'many', 'other'])

const UNIT_FALLBACK: Record<BillCycle, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  annually: ['year', 'years'],
}

/** Unit label agreeing with N ("1 month" / "3 months"; Polish few / many forms). */
function useCycleUnitLabel() {
  const t = useT()
  const locale = useLocale()
  const rules = React.useMemo(() => {
    try {
      return new Intl.PluralRules(locale)
    } catch {
      return new Intl.PluralRules('en')
    }
  }, [locale])
  return React.useCallback(
    (unit: BillCycle, count: number) => {
      const category = rules.select(count)
      const key = PLURAL_KEYS.has(category) ? category : 'other'
      const [one, other] = UNIT_FALLBACK[unit]
      return t(`cpq_billing_connector.orderSetup.billCycle.unit.${unit}.${key}`, count === 1 ? one : other)
    },
    [rules, t],
  )
}

function isBillCycle(value: string | null): value is BillCycle {
  return value !== null && (BILL_CYCLES as readonly string[]).includes(value)
}

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
  const unitLabel = useCycleUnitLabel()
  const cycle: BillCycle = isBillCycle(state.account.billCycle) ? state.account.billCycle : 'monthly'
  const interval = parseCycleInterval(state.account.billCycleInterval)
  const dayLabel = (day: string) =>
    (WEEKDAYS as readonly string[]).includes(day)
      ? t(`cpq_billing_connector.orderSetup.billCycle.weekday.${day}`, day)
      : t('cpq_billing_connector.orderSetup.billCycle.dayOfMonth', 'day {day}', { day })
  /** "every 3 months · day 15" for an existing account (older rows may lack N / day). */
  const optionCycle = (option: AccountOption) => {
    if (!isBillCycle(option.billCycle)) return option.billCycle
    const count = option.billCycleInterval ?? 1
    const every = t('cpq_billing_connector.orderSetup.billCycle.every', 'Every {count} {unit}', {
      count,
      unit: unitLabel(option.billCycle, count),
    })
    return option.billCycleDay ? `${every} · ${dayLabel(option.billCycleDay)}` : every
  }
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
                  {[option.name, option.currencyCode, optionCycle(option), option.nextBillDate]
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
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="cpq-billing-setup-billCycleInterval">
              {t('cpq_billing_connector.orderSetup.account.billCycle', 'Bill cycle')}
            </Label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('cpq_billing_connector.orderSetup.account.billCycleEvery', 'Every')}</span>
              <Input
                id="cpq-billing-setup-billCycleInterval"
                type="number"
                inputMode="numeric"
                min={1}
                max={BILL_CYCLE_INTERVAL_MAX[cycle]}
                className="w-20"
                aria-label={t('cpq_billing_connector.orderSetup.account.billCycleInterval', 'Number of units per cycle')}
                value={state.account.billCycleInterval}
                disabled={disabled}
                onChange={(event) => setAccount({ billCycleInterval: event.target.value })}
              />
              <Select
                value={cycle}
                onValueChange={(value) => onChange({ ...state, account: changeCycleUnit(state.account, value as BillCycle) })}
                disabled={disabled}
              >
                <SelectTrigger
                  id="cpq-billing-setup-billCycle"
                  className="w-36"
                  aria-label={t('cpq_billing_connector.orderSetup.account.billCycleUnit', 'Cycle unit')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILL_CYCLES.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unitLabel(unit, interval ?? 1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cycle !== 'daily' && (
                <>
                  <span>{t('cpq_billing_connector.orderSetup.account.billCycleOn', 'on')}</span>
                  <Select
                    value={state.account.billCycleDay || undefined}
                    onValueChange={(value) => setAccount({ billCycleDay: value })}
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id="cpq-billing-setup-billCycleDay"
                      className="w-36"
                      aria-label={t('cpq_billing_connector.orderSetup.account.billCycleDay', 'Bill cycle day')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(cycle === 'weekly' ? WEEKDAY_ORDER : MONTH_DAYS).map((day) => (
                        <SelectItem key={day} value={day}>
                          {dayLabel(day)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            {cycle !== 'daily' && cycle !== 'weekly' && Number(state.account.billCycleDay) > 28 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  'cpq_billing_connector.orderSetup.account.billCycleShortMonthHint',
                  'Shorter months bill on their last day.',
                )}
              </p>
            )}
            {interval === null || interval < 1 || interval > BILL_CYCLE_INTERVAL_MAX[cycle] ? (
              <p className="text-xs text-destructive">
                {t('cpq_billing_connector.orderSetup.account.billCycleIntervalRange', 'Enter a whole number from 1 to {max}.', {
                  max: BILL_CYCLE_INTERVAL_MAX[cycle],
                })}
              </p>
            ) : null}
          </div>
          <Field
            id="cpq-billing-setup-nextBillDate"
            label={t('cpq_billing_connector.orderSetup.account.nextBillDate', 'First bill date (optional)')}
          >
            <Input type="date" {...text('nextBillDate')} />
            <p className="text-xs text-muted-foreground">
              {t(
                'cpq_billing_connector.orderSetup.account.nextBillDateHint',
                'Empty = the next bill cycle day on or after the day the account is created.',
              )}
            </p>
          </Field>
        </div>
      )}
    </section>
  )
}
