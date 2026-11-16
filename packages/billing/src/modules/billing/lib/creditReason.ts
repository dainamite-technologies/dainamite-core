import { z } from 'zod'

/**
 * Why an item was credited (Part 2, D8–D10). Stored on the ENDED billing item
 * (`billing_items.credit_reason`) and frozen into the credit line's
 * `metadata.credit_reason` at bill time.
 *
 *   text  operator's words, printed verbatim
 *   code  generated (CPQ connector); rendered per document language from
 *         `billing.credit_reason.<code>` with `{reference}` / `{date}`
 */

export const CREDIT_REASON_CODES = [
  'subscription_amended',
  'subscription_cancelled',
  'subscription_superseded',
] as const
export type CreditReasonCode = (typeof CREDIT_REASON_CODES)[number]

export const CREDIT_REASON_TEXT_MAX = 500

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const creditReasonParamsSchema = z.object({
  reference: z.string().trim().min(1).max(120).optional(),
  effectiveDate: isoDay,
})

export const creditReasonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(CREDIT_REASON_TEXT_MAX) }),
  z.object({ kind: z.literal('code'), code: z.enum(CREDIT_REASON_CODES), params: creditReasonParamsSchema }),
])
export type CreditReason = z.infer<typeof creditReasonSchema>

/** API input fields shared by the item update and change-price schemas. */
export const creditReasonInputFields = {
  creditReason: z.string().trim().min(1).max(CREDIT_REASON_TEXT_MAX).optional(),
  creditReasonCode: z.enum(CREDIT_REASON_CODES).optional(),
  creditReasonParams: creditReasonParamsSchema.optional(),
}

export type CreditReasonInput = {
  creditReason?: string
  creditReasonCode?: CreditReasonCode
  creditReasonParams?: z.infer<typeof creditReasonParamsSchema>
}

/** Cross-field rule: free text XOR a code with its params. */
export function refineCreditReasonInput(value: CreditReasonInput, ctx: z.RefinementCtx): void {
  if (value.creditReason !== undefined && value.creditReasonCode !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['creditReason'], message: 'Send either creditReason or creditReasonCode, not both' })
  }
  if (value.creditReasonCode !== undefined && value.creditReasonParams === undefined) {
    ctx.addIssue({ code: 'custom', path: ['creditReasonParams'], message: 'creditReasonParams is required with creditReasonCode' })
  }
}

export function toCreditReason(input: CreditReasonInput): CreditReason | null {
  if (input.creditReason) return { kind: 'text', text: input.creditReason }
  if (input.creditReasonCode && input.creditReasonParams) {
    return { kind: 'code', code: input.creditReasonCode, params: input.creditReasonParams }
  }
  return null
}

export function parseCreditReason(value: unknown): CreditReason | null {
  const parsed = creditReasonSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** `(key, fallback) → template`; placeholders are filled here, so any translator fits. */
export type CreditReasonTranslate = (key: string, fallback: string) => string

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match)
}

const CODE_FALLBACKS: Record<CreditReasonCode, { withRef: string; plain: string }> = {
  subscription_amended: {
    withRef: 'Subscription amended (order {reference}), effective {date}',
    plain: 'Subscription amended, effective {date}',
  },
  subscription_cancelled: {
    withRef: 'Subscription cancelled (order {reference}), effective {date}',
    plain: 'Subscription cancelled, effective {date}',
  },
  subscription_superseded: {
    withRef: 'Subscription replaced (order {reference}), effective {date}',
    plain: 'Subscription replaced, effective {date}',
  },
}

/**
 * Human text of a reason. `translate` decides the language: the document
 * translator for PDFs / emails (invoice language), `useT` on admin pages.
 */
export function creditReasonText(
  reason: CreditReason,
  translate: CreditReasonTranslate,
  formatDate: (isoDay: string) => string,
): string {
  if (reason.kind === 'text') return reason.text
  const fallback = CODE_FALLBACKS[reason.code]
  const date = formatDate(reason.params.effectiveDate)
  return reason.params.reference
    ? fill(translate(`billing.credit_reason.${reason.code}`, fallback.withRef), { reference: reason.params.reference, date })
    : fill(translate(`billing.credit_reason.${reason.code}.plain`, fallback.plain), { date })
}
