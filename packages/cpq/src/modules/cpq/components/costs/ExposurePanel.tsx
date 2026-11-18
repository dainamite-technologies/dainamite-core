'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { exposureReference, exposureRows, hasExposure } from '../../lib/arcCostView'
import type { CancelExposureView } from '../../lib/quoteCostView'

/**
 * Supplier exposure of a cancellation (ARC costs spec §UI/UX): the costs that outlive the cancel, as of the reference date
 * ("as of today" until the order is active, the effective date after). Names, supplier, term end and months only — no amounts.
 * Renders nothing when nothing outlives the reference date. The caller shows it to `cpq.costs.view` holders only (the server omits it otherwise).
 */
export function ExposurePanel({ exposure, today, compact }: { exposure: CancelExposureView | null | undefined; today: string; compact?: boolean }) {
  const t = useT()
  if (!hasExposure(exposure)) return null
  const reference = exposureReference(exposure.referenceDate, today)
  return (
    <section className={compact ? 'space-y-1' : 'rounded-lg border bg-card px-4 py-3 space-y-1'} aria-label={t('cpq.arc.exposure.title', 'Supplier exposure')} data-testid="cpq-exposure-panel">
      <h3 className="text-sm font-medium">
        {t('cpq.arc.exposure.title', 'Supplier exposure')}
        <span className="ml-2 text-xs font-normal text-muted-foreground" data-testid="cpq-exposure-reference">
          {reference.today ? t('cpq.arc.exposure.asOfToday', 'as of today') : t('cpq.arc.exposure.asOfDate', 'as of {date}', { date: reference.date })}
        </span>
      </h3>
      <ul className="space-y-0.5 text-xs">
        {exposureRows(exposure).map((row) => (
          <li key={row.key} data-testid="cpq-exposure-row">
            {row.termUnknown || !row.termEnd ? (
              <>{t('cpq.arc.exposure.unknown', '{name} — supplier term unknown', { name: row.label })}</>
            ) : (
              <>
                {t('cpq.arc.exposure.row', '{name} — term ends {date}', { name: row.label, date: row.termEnd })}{' '}
                {row.months === 1
                  ? t('cpq.arc.exposure.monthsOne', '(exposure 1 month)')
                  : t('cpq.arc.exposure.months', '(exposure {months} months)', { months: row.months ?? 0 })}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
