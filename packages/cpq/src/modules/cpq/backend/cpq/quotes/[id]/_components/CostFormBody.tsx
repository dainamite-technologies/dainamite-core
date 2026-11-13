'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  COST_ISSUE_FALLBACKS,
  COST_ROLE_FALLBACKS,
  costErrorFallback,
  type CostForm,
  type CostFormIssue,
  type FullQuoteCost,
} from '../../../../../lib/quoteCostView'

export type ChargeOption = { chargeCode: string; chargeName: string; chargeType: string; pricingMethod?: string | null }
export type CostDialogMode = 'add' | 'edit' | 'confirm'

const LINE_LEVEL = '__line__'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Choice<V extends string>({ value, onChange, options, disabled }: { value: V; onChange: (value: V) => void; options: Array<[V, string]>; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as V)} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
    </Select>
  )
}

/** Fields of the Add / Edit / Confirm cost dialog. Presentational: state and submit live in `CostDialog`. */
export function CostFormBody({ form, onChange, mode, existing, charges, issues, errorCode, onReload }: {
  form: CostForm
  onChange: (next: CostForm) => void
  mode: CostDialogMode
  existing: FullQuoteCost | null
  charges: ChargeOption[]
  /** Pre-submit problems; empty until the user tried to save. */
  issues: CostFormIssue[]
  errorCode: string | null
  onReload: () => void
}) {
  const t = useT()
  const set = <K extends keyof CostForm>(key: K, value: CostForm[K]) => onChange({ ...form, [key]: value })
  const structureLocked = existing !== null && existing.origin !== 'manual'
  const needsNote = issues.includes('NOTE_REQUIRED') || issues.includes('VALIDITY_EVIDENCE_REQUIRED')
  const issueText = (issue: CostFormIssue) => t(`cpq.quoteCosts.dialog.issues.${issue}`, COST_ISSUE_FALLBACKS[issue])
  const errorText = errorCode ? t(`cpq.quoteCosts.errors.${errorCode}`, costErrorFallback(errorCode)) : null

  return (
    <div className="space-y-3 text-sm" data-testid="cpq-cost-form">
      {existing && existing.origin === 'catalog' && (
        <p className="text-xs text-muted-foreground">
          {t('cpq.quoteCosts.dialog.catalogHint', 'This value comes from the catalog. Overwriting it needs a note; the cost then stays as you set it.')}
        </p>
      )}
      <Field label={t('cpq.quoteCosts.name', 'Name')}>
        <Input autoFocus={mode === 'add'} value={form.name} disabled={structureLocked} maxLength={255} onChange={(event) => set('name', event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cpq.quoteCosts.role', 'Role')}>
          <Choice value={form.role} disabled={structureLocked} onChange={(value) => set('role', value)}
            options={[['margin_only', t('cpq.quoteCosts.roles.margin_only', COST_ROLE_FALLBACKS.margin_only)], ['price_basis', t('cpq.quoteCosts.roles.price_basis', COST_ROLE_FALLBACKS.price_basis)]]} />
        </Field>
        <Field label={t('cpq.quoteCosts.dialog.costType', 'Cost type')}>
          <Choice value={form.costType} disabled={structureLocked} onChange={(value) => set('costType', value)}
            options={[['mrc', t('cpq.quoteCosts.dialog.mrc', 'Recurring (MRC)')], ['nrc', t('cpq.quoteCosts.dialog.nrc', 'One-time (NRC)')]]} />
        </Field>
        <Field label={t('cpq.quoteCosts.source', 'Source')}>
          <Choice value={form.source} disabled={structureLocked} onChange={(value) => set('source', value)}
            options={[['fixed', t('cpq.quoteCosts.sources.fixed', 'Fixed')], ['on_request', t('cpq.quoteCosts.sources.on_request', 'On request')]]} />
        </Field>
        <Field label={t('cpq.quoteCosts.dialog.costModel', 'Cost model')}>
          <Choice value={form.costModel} disabled={structureLocked} onChange={(value) => set('costModel', value)}
            options={[['flat', t('cpq.quoteCosts.dialog.flat', 'Flat per instance')], ['per_unit', t('cpq.quoteCosts.dialog.perUnit', 'Per unit')]]} />
        </Field>
      </div>
      <Field label={t('cpq.quoteCosts.dialog.charge', 'Charge')}>
        <Select value={form.chargeCode || LINE_LEVEL} disabled={structureLocked} onValueChange={(value) => set('chargeCode', value === LINE_LEVEL ? '' : value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={LINE_LEVEL}>{t('cpq.quoteCosts.dialog.lineLevel', 'Whole line (margin only)')}</SelectItem>
            {charges.map((charge) => <SelectItem key={charge.chargeCode} value={charge.chargeCode}>{charge.chargeName}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {form.source === 'fixed' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label={t('cpq.quoteCosts.value', 'Value')}>
              <Input inputMode="decimal" value={form.unitAmount} onChange={(event) => set('unitAmount', event.target.value)} />
            </Field>
          </div>
          <Field label={t('cpq.quoteCosts.currency', 'Currency')}>
            <Input value={form.currencyCode} maxLength={3} onChange={(event) => set('currencyCode', event.target.value.toUpperCase())} />
          </Field>
        </div>
      )}
      {form.source === 'fixed' && mode !== 'confirm' && form.unitAmount.trim() !== '' && (
        <Field label={t('cpq.quoteCosts.status', 'Status')}>
          <Choice value={form.valueStatus} onChange={(value) => set('valueStatus', value)}
            options={[['estimated', t('cpq.quoteCosts.statuses.estimated', 'Estimated')], ['confirmed', t('cpq.quoteCosts.statuses.confirmed', 'Confirmed')]]} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cpq.quoteCosts.supplier', 'Supplier')}>
          <Input value={form.supplierName} maxLength={255} onChange={(event) => set('supplierName', event.target.value)} />
        </Field>
        <Field label={t('cpq.quoteCosts.dialog.supplierQuoteRef', 'Supplier quote ref')}>
          <Input value={form.supplierQuoteRef} maxLength={255} onChange={(event) => set('supplierQuoteRef', event.target.value)} />
        </Field>
        <Field label={t('cpq.quoteCosts.validUntil', 'Valid until')}>
          <Input type="date" value={form.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
        </Field>
        <Field label={t('cpq.quoteCosts.dialog.supplierTermEnd', 'Supplier term end')}>
          <Input type="date" value={form.supplierTermEnd} onChange={(event) => set('supplierTermEnd', event.target.value)} />
        </Field>
        <Field label={t('cpq.quoteCosts.dialog.supplierMinTermMonths', 'Min. term (months)')}>
          <Input inputMode="numeric" value={form.supplierMinTermMonths} onChange={(event) => set('supplierMinTermMonths', event.target.value)} />
        </Field>
      </div>
      <Field
        label={`${t('cpq.quoteCosts.dialog.note', 'Note')}${needsNote ? ' *' : ''}`}
        hint={existing?.note ? t('cpq.quoteCosts.dialog.currentNote', 'Current note: {note}', { note: existing.note }) : undefined}
      >
        <Textarea rows={2} maxLength={500} value={form.note} onChange={(event) => set('note', event.target.value)} />
      </Field>

      {(issues.length > 0 || errorText) && (
        <Alert variant="warning" data-testid="cpq-cost-form-errors">
          <AlertDescription>
            {issues.length > 0 && <span className="block">{issues.map(issueText).join(' · ')}</span>}
            {errorText && <span className="block">{errorText}</span>}
            {errorCode === 'STALE_REVISION' && (
              <Button variant="outline" size="sm" className="mt-1" onClick={onReload}>{t('cpq.quoteCosts.dialog.reload', 'Reload')}</Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
