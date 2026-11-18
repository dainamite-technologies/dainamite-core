'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { MARKUP_RULES, MARKUP_RULE_FALLBACKS, MARKUP_VALUE_HINTS, type MarkupRule } from '../../lib/costPlusView'

const selectClass = 'w-full rounded-md border bg-background px-2 py-1.5 text-sm'

type Props = {
  markupRule: string | null
  markupValue: string | null
  onChange: (patch: { markupRule?: string | null; markupValue?: string | null }) => void
}

/** Markup rule + value of a cost-plus charge. Rendered for `cpq.costs.view` holders only (the API redacts markup for everyone else). */
export function CostPlusFields({ markupRule, markupValue, onChange }: Props) {
  const t = useT()
  const rule = (MARKUP_RULES as readonly string[]).includes(markupRule ?? '') ? (markupRule as MarkupRule) : 'markup_percent'
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="cpq-markup-rule">{t('cpq.costPlus.markupRule', 'Markup rule')} <span className="text-destructive">*</span></label>
        <select id="cpq-markup-rule" className={selectClass} value={rule} onChange={(e) => onChange({ markupRule: e.target.value })}>
          {MARKUP_RULES.map((value) => (
            <option key={value} value={value}>{t(`cpq.costPlus.markupRules.${value}`, MARKUP_RULE_FALLBACKS[value])}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="cpq-markup-value">{t('cpq.costPlus.markupValue', 'Markup value')} <span className="text-destructive">*</span></label>
        <Input id="cpq-markup-value" inputMode="decimal" value={markupValue ?? ''} onChange={(e) => onChange({ markupValue: e.target.value || null })} aria-describedby="cpq-markup-hint" />
        <p id="cpq-markup-hint" className="mt-0.5 text-xs text-muted-foreground">{t(`cpq.costPlus.markupHints.${rule}`, MARKUP_VALUE_HINTS[rule])}</p>
      </div>
    </>
  )
}
