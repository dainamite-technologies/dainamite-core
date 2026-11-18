"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { OrderSetupFormState } from '../../lib/orderSetupForm'
import type { OrderSetupView } from '../../services/orderSetupService'

type BillStartSectionProps = {
  state: OrderSetupFormState
  lines: OrderSetupView['defaults']['lines']
  disabled: boolean
  onChange: (next: OrderSetupFormState) => void
  /**
   * What applies when no date is set. Defaults to "on activation" (new sale);
   * ARC orders pass the effective date (amend) or the new term start (renew).
   */
  fallback?: { label: string; hint: string }
}

/**
 * Order default bill start + a per-line override. The placeholder of each
 * line shows what applies without an override (D3): CPQ service start, else
 * the order default, else "on activation".
 */
export function BillStartSection({ state, lines, disabled, onChange, fallback }: BillStartSectionProps) {
  const t = useT()
  const onActivation = fallback?.label ?? t('cpq_billing_connector.orderSetup.billStart.onActivation', 'On activation')

  const inherited = (serviceStartDate: string | null): string =>
    serviceStartDate ?? (state.defaultBillStartDate || onActivation)

  const setLine = (lineId: string, value: string) => {
    const next = { ...state.lineBillStarts }
    if (value) next[lineId] = value
    else delete next[lineId]
    onChange({ ...state, lineBillStarts: next })
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium">{t('cpq_billing_connector.orderSetup.billStart.title', 'Bill start')}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'cpq_billing_connector.orderSetup.billStart.description',
            'Billing of a line starts on its own date if set, else on its service start, else on the order default.',
          )}
        </p>
      </div>

      <div className="max-w-xs space-y-1">
        <Label htmlFor="cpq-billing-setup-default-start">
          {t('cpq_billing_connector.orderSetup.billStart.default', 'Default bill start')}
        </Label>
        <Input
          id="cpq-billing-setup-default-start"
          type="date"
          value={state.defaultBillStartDate}
          disabled={disabled}
          onChange={(event) => onChange({ ...state, defaultBillStartDate: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {fallback?.hint ?? t('cpq_billing_connector.orderSetup.billStart.defaultHint', 'Empty = the activation date.')}
        </p>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('cpq_billing_connector.orderSetup.billStart.noLines', 'This order has no billable lines.')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('cpq_billing_connector.orderSetup.billStart.line', 'Line')}</th>
                <th className="px-3 py-2 font-medium">
                  {t('cpq_billing_connector.orderSetup.billStart.serviceStart', 'Service start')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t('cpq_billing_connector.orderSetup.billStart.billStart', 'Bill start')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line) => (
                <tr key={line.lineId}>
                  <td className={`px-3 py-2 ${line.parentLineId ? 'pl-8' : ''}`}>{line.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{line.serviceStartDate ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        className="max-w-[11rem]"
                        aria-label={t('cpq_billing_connector.orderSetup.billStart.lineAria', 'Bill start of {line}', {
                          line: line.name,
                        })}
                        value={state.lineBillStarts[line.lineId] ?? ''}
                        disabled={disabled}
                        onChange={(event) => setLine(line.lineId, event.target.value)}
                      />
                      {!state.lineBillStarts[line.lineId] && (
                        <span className="text-xs text-muted-foreground">{inherited(line.serviceStartDate)}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
