import { z } from 'zod'
import { DEFAULT_INVOICE_LANGUAGE, INVOICE_LANGUAGE_CODES } from '../lib/invoiceLanguages'
import { DOCUMENT_SERIES, validateMask } from '../lib/numbering'
import { isValidBic, isValidIban, normalizeIban } from '../lib/iban'
import { creditReasonInputFields, refineCreditReasonInput } from '../lib/creditReason'
import {
  MAX_PHASES_PER_ITEM,
  PHASE_DURATION_UNITS,
  PHASE_PRICE_TYPES,
  validatePhaseSchedule,
} from '../lib/pricePhases'
import { ITEM_STATUSES, STATUS_CHARGE_BEHAVIORS } from '../lib/itemStatusPeriods'

// ─── Enums ───────────────────────────────────────────────────────

export const BILLING_ITEM_TYPES = ['one_time', 'recurring', 'usage'] as const
export type BillingItemType = (typeof BILLING_ITEM_TYPES)[number]

// Bill cycle units + day semantics live in `lib/billCycle.ts` (shared with the
// cycle math and the UI); re-exported here as the validators' public surface.
import {
  BILL_CYCLES,
  DEFAULT_BILL_CYCLE,
  DEFAULT_BILL_CYCLE_INTERVAL,
  BILL_CYCLE_INTERVAL_MAX,
  defaultCycleDay,
  normalizeCycleDay,
  validateCycleSpec,
} from '../lib/billCycle'
export { BILL_CYCLES }
export type { BillCycle } from '../lib/billCycle'

// Spec A: when a recurring item is charged relative to the bill date —
// for the coming period (in advance, default) or the period just ended.
export const CHARGE_TIMINGS = ['in_advance', 'in_arrears'] as const
export type ChargeTiming = (typeof CHARGE_TIMINGS)[number]

// Spec F (F-D2): the basis the item price was entered on.
export const PRICE_BASES = ['net', 'gross'] as const
export type PriceBasis = (typeof PRICE_BASES)[number]

// Spec F (F-D3): where prepaid VAT is charged.
export const PREPAID_TAX_POINTS = ['topup', 'consumption'] as const
export type PrepaidTaxPoint = (typeof PREPAID_TAX_POINTS)[number]

export const BILL_RUN_TRIGGERS = ['schedule', 'manual'] as const
export type BillRunTrigger = (typeof BILL_RUN_TRIGGERS)[number]

export const BILL_RUN_STATUSES = ['running', 'completed', 'partial_failure', 'failed'] as const
export type BillRunStatus = (typeof BILL_RUN_STATUSES)[number]

export const BILL_RUN_OUTCOME_STATUSES = [
  'success',
  'success_with_warnings',
  'skipped_existing_draft',
  // SPEC-002: prepaid period close was skipped because a statement already
  // exists for the window.
  'skipped_existing_statement',
  'failed',
] as const
export type BillRunOutcomeStatus = (typeof BILL_RUN_OUTCOME_STATUSES)[number]

export const DRAFT_INVOICE_EDIT_ACTIONS = ['line_added', 'line_removed', 'line_edited'] as const
export type DraftInvoiceEditAction = (typeof DRAFT_INVOICE_EDIT_ACTIONS)[number]

// Spec 0: billing-owned document statuses. No 'void' — a posted document is
// only neutralised by a credit memo ('credited'); drafts are deleted.
export const INVOICE_STATUSES = ['draft', 'posted', 'partially_paid', 'paid', 'credited'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const DOCUMENT_TYPES = ['invoice', 'credit_memo', 'debit_memo', 'receipt'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// ─── Prepaid (SPEC-002) enums ────────────────────────────────────

export const BILLING_MODES = ['postpaid', 'prepaid'] as const
export type BillingMode = (typeof BILLING_MODES)[number]

export const TRANSACTION_TYPES = [
  'topup',
  'usage',
  'recurring',
  'one_time',
  'adjustment',
  'reversal',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const TOPUP_STATUSES = [
  'pending',
  'captured',
  'failed',
  'expired',
  'cancelled',
] as const
export type TopupStatus = (typeof TOPUP_STATUSES)[number]

// Spec E (B2C): a billing account belongs to a company or a person. Both
// live in the customers module under one `customer_entities` id space, so
// `customer_id` is kind-agnostic — `customer_kind` only drives the lookup
// and the label.
export const CUSTOMER_KINDS = ['company', 'person'] as const
export type CustomerKind = (typeof CUSTOMER_KINDS)[number]

export const STATEMENT_STATUSES = ['generated', 'sent'] as const
export type StatementStatus = (typeof STATEMENT_STATUSES)[number]

// Prepaid funds status (the account's own money).
export const BALANCE_STATUSES = ['ok', 'low', 'exhausted'] as const
export type BalanceStatus = (typeof BALANCE_STATUSES)[number]

// Credit-line status (extended overdraft / AR exposure — both modes).
export const CREDIT_STATUSES = ['within_limit', 'near_limit', 'over_limit'] as const
export type CreditStatus = (typeof CREDIT_STATUSES)[number]

// Bill cycle day: '1'–'31' (monthly / annually; a day past the end of a short
// month means its last day) or 'mon'–'sun' (weekly); null for daily cycles.
// Stored as text so both shapes share one column. Numbers are accepted and
// normalized ('05' / 5 → '5'). Which shape is valid depends on the unit —
// checked cross-field by `validateCycleSpec`.
export const billCycleDaySchema = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((value, ctx) => {
    if (value === null) return null
    const normalized = normalizeCycleDay(value)
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'bill_cycle_day must be 1–31 or mon–sun' })
      return z.NEVER
    }
    return normalized
  })

// "Every N units" — the per-unit upper bound is enforced by `validateCycleSpec`.
export const billCycleIntervalSchema = z.coerce.number().int().min(1).max(366)

// ─── rate_json — pricing definitions ─────────────────────────────
//
// Validated at API ingress so the engine can trust the shape downstream.
// Negative amounts are intentionally allowed only on `one_time` (refunds /
// credits / proration credits). Recurring and usage unit prices MUST be
// non-negative — discounts on those are modeled as separate `one_time`
// credit items.

const numericNonNegative = z.number().finite().nonnegative()
const numericAny = z.number().finite()

export const rateJsonOneTime = z
  .object({ amount: numericAny })
  .strict()

export const rateJsonRecurring = z
  .object({ unit_price: numericNonNegative })
  .strict()

export const rateJsonUsageSimple = z
  .object({ unit_price: numericNonNegative })
  .strict()

const tierWithUnitPrice = z
  .object({
    up_to: z.union([z.number().int().positive(), z.null()]),
    unit_price: numericNonNegative,
  })
  .strict()

const tierWithFlatAmount = z
  .object({
    up_to: z.union([z.number().int().positive(), z.null()]),
    flat_amount: numericNonNegative,
  })
  .strict()

// All tiers must use the same key shape (consistent with the model). Mixing
// `unit_price` and `flat_amount` across tiers is rejected — see spec
// validation rules.
const tiersUnitPrice = z
  .array(tierWithUnitPrice)
  .min(1, 'tiers must be a non-empty array')
const tiersFlatAmount = z
  .array(tierWithFlatAmount)
  .min(1, 'tiers must be a non-empty array')

function refineTierProgression<T extends { up_to: number | null }>(
  tiers: T[],
  ctx: z.RefinementCtx,
): void {
  const openTopCount = tiers.filter((t) => t.up_to === null).length
  if (openTopCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tiers must contain exactly one open-ended top tier (up_to: null)',
    })
    return
  }
  if (tiers[tiers.length - 1].up_to !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'the open-ended top tier (up_to: null) must be the last entry',
    })
    return
  }
  for (let i = 1; i < tiers.length - 1; i++) {
    const prev = tiers[i - 1].up_to
    const curr = tiers[i].up_to
    if (prev !== null && curr !== null && curr <= prev) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `up_to values must be strictly increasing across tiers (failed at index ${i})`,
      })
      return
    }
  }
}

export const rateJsonUsageVolume = z
  .object({
    model: z.literal('volume'),
    tiers: tiersUnitPrice,
  })
  .strict()
  .superRefine((val, ctx) => refineTierProgression(val.tiers, ctx))

export const rateJsonUsageGraduated = z
  .object({
    model: z.literal('graduated'),
    tiers: tiersUnitPrice,
  })
  .strict()
  .superRefine((val, ctx) => refineTierProgression(val.tiers, ctx))

export const rateJsonUsageFlat = z
  .object({
    model: z.literal('flat'),
    tiers: tiersFlatAmount,
  })
  .strict()
  .superRefine((val, ctx) => refineTierProgression(val.tiers, ctx))

export const rateJsonUsageTiered = z.discriminatedUnion('model', [
  rateJsonUsageVolume,
  rateJsonUsageGraduated,
  rateJsonUsageFlat,
])

export const rateJsonUsage = z.union([rateJsonUsageSimple, rateJsonUsageTiered])

/**
 * Validate a `rate_json` payload against the rules for a given Billing Item
 * `type`. Returns the parsed value or throws a `ZodError` whose message
 * surfaces the specific shape violation.
 */
export function validateRateJson(
  type: BillingItemType,
  rateJson: unknown,
):
  | z.infer<typeof rateJsonOneTime>
  | z.infer<typeof rateJsonRecurring>
  | z.infer<typeof rateJsonUsage> {
  switch (type) {
    case 'one_time':
      return rateJsonOneTime.parse(rateJson)
    case 'recurring':
      return rateJsonRecurring.parse(rateJson)
    case 'usage':
      return rateJsonUsage.parse(rateJson)
  }
}

// ─── Invoice address (BillingAccount.invoice_address) ────────────

export const invoiceAddressSchema = z
  .object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    postal_code: z.string().min(1),
    country: z.string().min(2).max(3), // ISO 3166-1 alpha-2 or alpha-3
  })
  .strict()

export type InvoiceAddress = z.infer<typeof invoiceAddressSchema>

// ─── Scope (injected by withScopedPayload at API ingress) ────────

const scopedSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

// ─── List pagination (shared shape) ──────────────────────────────

// Query-string boolean: only the literal strings count ("false" must NOT
// coerce to true the way z.coerce.boolean() would).
const queryBoolean = z.preprocess(
  (value) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined),
  z.boolean().optional(),
)

const listPaginationBase = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}

// ─── BillingAccount payloads ─────────────────────────────────────

// numeric(18,4) money inputs arrive as numbers; the command coerces to a
// 4dp string at persist time.
const moneyNonNegative = z.number().finite().nonnegative()

// Invoice language must be one the document template supports (Spec E, D22).
// Case/whitespace-tolerant on input, canonical lowercase code on output.
// Spec B: payment terms in days (0 = due on issue).
const paymentTermsDaysSchema = z.coerce.number().int().min(0).max(365)

const invoiceLanguageSchema = z.string().trim().toLowerCase().pipe(z.enum(INVOICE_LANGUAGE_CODES))

export const billingAccountCreateSchema = scopedSchema.extend({
  customerId: z.string().min(1).max(255),
  // Immutable after create (like customerId). Default 'company' keeps
  // existing callers (CPQ connector, seeds) unaffected.
  customerKind: z.enum(CUSTOMER_KINDS).default('company'),
  name: z.string().trim().min(1).max(255),
  currencyCode: z.string().trim().toUpperCase().length(3),
  billCycle: z.enum(BILL_CYCLES).default(DEFAULT_BILL_CYCLE),
  billCycleInterval: billCycleIntervalSchema.default(DEFAULT_BILL_CYCLE_INTERVAL),
  // Omitted → the day `nextBillDate` falls on, else '1' / 'mon' (create command).
  billCycleDay: billCycleDaySchema.optional(),
  invoiceEmail: z.string().trim().email().max(320),
  invoiceLanguage: invoiceLanguageSchema.default(DEFAULT_INVOICE_LANGUAGE),
  // Nullable + optional — consistent with the update schema, and the
  // cpq-billing-connector's shell-account seed sends `taxId: null`
  // for customers with no tax id.
  taxId: z.string().trim().max(64).nullable().optional(),
  invoiceAddress: invoiceAddressSchema,
  // Omitted → the first bill cycle day on or after today. An explicit date
  // off the cycle day bills one short alignment period first.
  nextBillDate: z.coerce.date().optional(),
  lastBillDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  // SPEC-002: mode is immutable after create (like currencyCode). Default
  // 'postpaid' so existing callers are unaffected.
  billingMode: z.enum(BILLING_MODES).optional(),
  // Credit line (both modes). 0 = no credit.
  creditLimit: moneyNonNegative.optional(),
  // Initial low-balance threshold for a prepaid account's balance row.
  // Null = resolve the tenant config default at read time.
  lowBalanceThreshold: moneyNonNegative.nullable().optional(),
  // Spec B: null/omitted = the organization default payment terms.
  paymentTermsDays: paymentTermsDaysSchema.nullable().optional(),
  autoSendInvoice: z.boolean().optional(),
}).superRefine((value, ctx) => {
  // Full cross-field check only when the day is given; an omitted day is
  // defaulted by the create command, so only the interval range applies.
  const issue = validateCycleSpec({
    cycle: value.billCycle,
    interval: value.billCycleInterval,
    day: value.billCycleDay === undefined ? defaultCycleDay(value.billCycle, value.nextBillDate ?? null) : value.billCycleDay,
  })
  if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
})

export type BillingAccountCreateInput = z.infer<typeof billingAccountCreateSchema>

export const billingAccountUpdateSchema = scopedSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  // Cycle fields are validated against the stored record by the update
  // command (a partial patch cannot be cross-checked here). Changing any of
  // them without an explicit `nextBillDate` re-aligns the next bill date.
  billCycle: z.enum(BILL_CYCLES).optional(),
  billCycleInterval: billCycleIntervalSchema.optional(),
  billCycleDay: billCycleDaySchema.optional(),
  invoiceEmail: z.string().trim().email().max(320).optional(),
  invoiceLanguage: invoiceLanguageSchema.optional(),
  taxId: z.string().trim().max(64).nullable().optional(),
  invoiceAddress: invoiceAddressSchema.optional(),
  nextBillDate: z.coerce.date().optional(),
  lastBillDate: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
  // SPEC-002: credit_limit is editable (it's an AR/overdraft policy knob);
  // `billingMode` is intentionally NOT updatable — mode is frozen at create
  // (like currencyCode), no live postpaid↔prepaid switch in v1.
  creditLimit: moneyNonNegative.optional(),
  // Editing the prepaid balance row's low-balance threshold. Null clears it
  // back to the tenant config default.
  lowBalanceThreshold: moneyNonNegative.nullable().optional(),
  paymentTermsDays: paymentTermsDaysSchema.nullable().optional(),
  autoSendInvoice: z.boolean().optional(),
  // `currencyCode` is intentionally NOT updatable — currency is frozen at
  // account create time so historical invoices keep their currency context.
  // `customerId` is also immutable; create a new account if the customer
  // FK changes. `customerKind` follows `customerId` and is likewise not
  // updatable.
})

export type BillingAccountUpdateInput = z.infer<typeof billingAccountUpdateSchema>

export const billingAccountDeleteSchema = scopedSchema.extend({
  id: z.string().uuid(),
})

export type BillingAccountDeleteInput = z.infer<typeof billingAccountDeleteSchema>

export const billingAccountListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    customerId: z.string().optional(),
    customerKind: z.enum(CUSTOMER_KINDS).optional(),
    currencyCode: z.string().optional(),
    billCycle: z.enum(BILL_CYCLES).optional(),
    billingMode: z.enum(BILLING_MODES).optional(),
    isActive: queryBoolean,
    search: z.string().optional(),
    // Spec F (F8): only accounts with at least one overdue receivable.
    hasOverdue: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .optional(),
  })
  .passthrough()

export type BillingAccountListQuery = z.infer<typeof billingAccountListQuerySchema>

// ─── BillingItem payloads ────────────────────────────────────────

// Spec A: `chargeTiming` / `prorate` only mean something for recurring
// items. Omitted → the command applies the defaults (in_advance, true).
// Setting a non-default value on another type is a client mistake.
// Spec B (B-D1): VAT rate in percent. Omitted on create → the command fills
// the organization default; never re-filled on update.
const taxRateSchema = z.coerce.number().finite().min(0).max(100)

const chargeTimingFields = {
  chargeTiming: z.enum(CHARGE_TIMINGS).optional(),
  prorate: z.boolean().optional(),
  // Spec F (F-D2). Omitted → 'net' on create; unchanged on update.
  priceBasis: z.enum(PRICE_BASES).optional(),
}

export const GROSS_TIERED_UNSUPPORTED_MESSAGE = 'billing.item.gross_tiered_unsupported'

/** Tiered usage rates (`{ model, tiers }`) are always net (Spec F, P-D4). */
export function isTieredRate(rateJson: unknown): boolean {
  return typeof rateJson === 'object' && rateJson !== null && 'model' in rateJson && 'tiers' in rateJson
}

function refinePriceBasis(val: { priceBasis?: PriceBasis; rateJson: unknown }, ctx: z.RefinementCtx): void {
  if (val.priceBasis === 'gross' && isTieredRate(val.rateJson)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceBasis'], message: GROSS_TIERED_UNSUPPORTED_MESSAGE })
  }
}

// ─── Line period + price phases (2026-11-26 specs) ───────────────

/** Contract C1: one price phase of a recurring item, back to back from its start. */
export const billingItemPhaseInputSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  // Exactly one of (durationUnit + durationCount) or endDate — checked below.
  durationUnit: z.enum(PHASE_DURATION_UNITS).optional(),
  durationCount: z.coerce.number().int().min(1).max(1200).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priceType: z.enum(PHASE_PRICE_TYPES),
  value: z.coerce.number().finite().nonnegative().nullable().optional(),
})
export type BillingItemPhaseInput = z.infer<typeof billingItemPhaseInputSchema>

const linePeriodFields = {
  // Own billing period (L §4.2). null / omitted = follow the account cycle.
  billingPeriodUnit: z.enum(BILL_CYCLES).nullable().optional(),
  billingPeriodInterval: z.coerce.number().int().min(1).nullable().optional(),
  // Price phases (P §4.1). Recurring items only.
  phasesEnabled: z.boolean().optional(),
  phases: z.array(billingItemPhaseInputSchema).max(MAX_PHASES_PER_ITEM).optional(),
}

export const LINE_PERIOD_RECURRING_ONLY_MESSAGE = 'billingPeriod / phases can only be set on recurring items'

/**
 * `BILLING_PERIOD_CHANGE_BILLED` (lib/pricePhases): the own billing period is fixed once the item was invoiced (`billed_to_date`
 * set): a new grid would not line up with the watermark — with `prorate=false`
 * the next run skips the partial period it lands in, leaving days unbilled.
 */
export const BILLING_PERIOD_CHANGE_BILLED_MESSAGE =
  'The billing period cannot change once the item has been invoiced — end this item and add a new one with the new period.'

/** Cross-field checks of the period pair (shared by create and the update command). */
export function billingPeriodIssue(
  unit: string | null | undefined,
  interval: number | null | undefined,
): { path: 'billingPeriodUnit' | 'billingPeriodInterval'; message: string } | null {
  const hasUnit = unit !== null && unit !== undefined
  const hasInterval = interval !== null && interval !== undefined
  if (!hasUnit && hasInterval) return { path: 'billingPeriodUnit', message: 'billingPeriodInterval needs a billingPeriodUnit' }
  if (hasUnit && !hasInterval) return { path: 'billingPeriodInterval', message: 'billingPeriodInterval is required with a billingPeriodUnit' }
  if (hasUnit && hasInterval) {
    const max = BILL_CYCLE_INTERVAL_MAX[unit as keyof typeof BILL_CYCLE_INTERVAL_MAX]
    if (interval! > max) return { path: 'billingPeriodInterval', message: `billingPeriodInterval must be 1–${max} for ${unit}` }
  }
  return null
}

function refineLinePeriod(
  val: {
    type?: BillingItemType
    billStartDate?: Date
    billingPeriodUnit?: string | null
    billingPeriodInterval?: number | null
    phasesEnabled?: boolean
    phases?: BillingItemPhaseInput[]
  },
  ctx: z.RefinementCtx,
): void {
  const periodIssue = billingPeriodIssue(val.billingPeriodUnit, val.billingPeriodInterval)
  if (periodIssue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [periodIssue.path], message: periodIssue.message })
  if (val.type && val.type !== 'recurring') {
    if (val.billingPeriodUnit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingPeriodUnit'], message: LINE_PERIOD_RECURRING_ONLY_MESSAGE })
    }
    if (val.phasesEnabled || (val.phases && val.phases.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phases'], message: LINE_PERIOD_RECURRING_ONLY_MESSAGE })
    }
  }
  if (val.phases) {
    const issue = validatePhaseSchedule(val.billStartDate ?? null, val.phases)
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', issue.index, issue.path], message: issue.message })
  }
}

export const CHARGE_TIMING_RECURRING_ONLY_MESSAGE =
  'chargeTiming / prorate can only be set on recurring items'

function refineChargeTiming(
  val: { type: BillingItemType; chargeTiming?: ChargeTiming; prorate?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (val.type === 'recurring') return
  if (val.chargeTiming !== undefined && val.chargeTiming !== 'in_advance') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chargeTiming'], message: CHARGE_TIMING_RECURRING_ONLY_MESSAGE })
  }
  if (val.prorate === false) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prorate'], message: CHARGE_TIMING_RECURRING_ONLY_MESSAGE })
  }
}

const ratePayloadByType = z
  .object({
    type: z.enum(BILLING_ITEM_TYPES),
    rateJson: z.unknown(),
  })
  .superRefine((val, ctx) => {
    try {
      validateRateJson(val.type, val.rateJson)
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rateJson'],
        message: err instanceof Error ? err.message : 'rate_json is invalid for this type',
      })
    }
  })

export const billingItemCreateSchema = scopedSchema
  .extend({
    billAccountId: z.string().uuid(),
    type: z.enum(BILLING_ITEM_TYPES),
    billStartDate: z.coerce.date(),
    billEndDate: z.coerce.date().nullable().optional(),
    description: z.string().trim().min(1).max(500),
    rateJson: z.unknown(), // shape validated via the refine below
    uomCode: z.string().trim().max(64).optional(),
    subscriptionId: z.string().trim().max(255).optional(),
    subscriptionItemId: z.string().trim().max(255).optional(),
    // `source_ref` is the idempotency key. NULL → no dedup, always create.
    sourceRef: z.string().trim().min(1).max(255).optional(),
    taxRate: taxRateSchema.optional(),
    ...chargeTimingFields,
    ...linePeriodFields,
    // currency_mismatch and billed_to_date are system-managed, never set by
    // clients on create.
  })
  .superRefine((val, ctx) => {
    refineChargeTiming(val, ctx)
    refineLinePeriod(val, ctx)
    refinePriceBasis(val, ctx)
    try {
      validateRateJson(val.type, val.rateJson)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'rate_json is invalid for this type'
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rateJson'], message })
    }
    if (val.type === 'usage' && !val.uomCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uomCode'],
        message: 'uomCode is required for type=usage',
      })
    }
  })

export type BillingItemCreateInput = z.infer<typeof billingItemCreateSchema>

// ─── Bulk item create (Phase 4g) ─────────────────────────────────
//
// One scope envelope, N item payloads. The CPQ connector activating
// a large subscription used to fire one `billing.items.create` per
// charge — bulk-create collapses that into a single command with a
// batched `source_ref` idempotency check + single flush.

const billingItemBulkEntrySchema = z
  .object({
    billAccountId: z.string().uuid(),
    type: z.enum(BILLING_ITEM_TYPES),
    billStartDate: z.coerce.date(),
    billEndDate: z.coerce.date().nullable().optional(),
    description: z.string().trim().min(1).max(500),
    rateJson: z.unknown(),
    uomCode: z.string().trim().max(64).optional(),
    subscriptionId: z.string().trim().max(255).optional(),
    subscriptionItemId: z.string().trim().max(255).optional(),
    sourceRef: z.string().trim().min(1).max(255).optional(),
    taxRate: taxRateSchema.optional(),
    ...chargeTimingFields,
    ...linePeriodFields,
  })
  .superRefine((val, ctx) => {
    refineChargeTiming(val, ctx)
    refineLinePeriod(val, ctx)
    refinePriceBasis(val, ctx)
    try {
      validateRateJson(val.type, val.rateJson)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'rate_json is invalid for this type'
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rateJson'], message })
    }
    if (val.type === 'usage' && !val.uomCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uomCode'],
        message: 'uomCode is required for type=usage',
      })
    }
  })

export type BillingItemBulkEntry = z.infer<typeof billingItemBulkEntrySchema>

export const billingItemBulkCreateSchema = scopedSchema.extend({
  // Cap at 500 per call — keeps a single bulk transaction bounded.
  // A CPQ subscription with >500 charges should be split by the
  // caller (the connector); 500 is already far past any realistic
  // single-subscription charge count.
  items: z.array(billingItemBulkEntrySchema).min(1).max(500),
})

export type BillingItemBulkCreateInput = z.infer<typeof billingItemBulkCreateSchema>

export const billingItemUpdateSchema = scopedSchema.extend({
  id: z.string().uuid(),
  // `type` is immutable — changing one_time → recurring would silently
  // change billing semantics. Cancel the old item, create a new one.
  billStartDate: z.coerce.date().optional(),
  billEndDate: z.coerce.date().nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  rateJson: z.unknown().optional(),
  uomCode: z.string().trim().max(64).nullable().optional(),
  subscriptionId: z.string().trim().max(255).nullable().optional(),
  subscriptionItemId: z.string().trim().max(255).nullable().optional(),
  // `source_ref` immutable — it's the idempotency identity of the item.
  isActive: z.boolean().optional(),
  // Affects future invoices only — posted lines keep their snapshot.
  taxRate: taxRateSchema.optional(),
  // Recurring only (enforced by the command, which knows the item type).
  // Safe to change after billing: the `billed_to_date` watermark prevents
  // any day from being billed twice.
  ...chargeTimingFields,
  // Own period + phases: the type is not in the payload — the command checks
  // "recurring only", the merged period pair and "only unbilled periods".
  // `phases` replaces the whole schedule when sent.
  ...linePeriodFields,
  // Part 2: required (by the command) when a new end date credits billed days.
  ...creditReasonInputFields,
}).superRefine((val, ctx) => {
  refineCreditReasonInput(val, ctx)
  if (val.phases) {
    const issue = validatePhaseSchedule(val.billStartDate ?? null, val.phases)
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', issue.index, issue.path], message: issue.message })
  }
})

export type BillingItemUpdateInput = z.infer<typeof billingItemUpdateSchema>

// Change a recurring item's price from a date on: end the item the day
// before, start a copy with the new price (see lib/itemPriceChange.ts).
export const billingItemChangePriceSchema = scopedSchema.extend({
  id: z.string().uuid(),
  effectiveDate: z.coerce.date(),
  unitPrice: z.coerce.number().finite().nonnegative(),
  // Part 2: required (by the command) when the change credits billed days.
  ...creditReasonInputFields,
}).superRefine(refineCreditReasonInput)

export type BillingItemChangePriceInput = z.infer<typeof billingItemChangePriceSchema>

export const billingItemDeleteSchema = scopedSchema.extend({
  id: z.string().uuid(),
})

export type BillingItemDeleteInput = z.infer<typeof billingItemDeleteSchema>

export const billingItemListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    billAccountId: z.string().uuid().optional(),
    type: z.enum(BILLING_ITEM_TYPES).optional(),
    subscriptionId: z.string().optional(),
    isActive: queryBoolean,
    activeAt: z.coerce.date().optional(), // bill_start_date <= X AND (bill_end_date IS NULL OR bill_end_date >= X)
  })
  .passthrough()

export type BillingItemListQuery = z.infer<typeof billingItemListQuerySchema>

// ─── BillingItemStatusPeriod payloads (L §4.3, contract C1) ──────

const isoDay = z.coerce.date()

export const billingItemStatusPeriodCreateSchema = scopedSchema
  .extend({
    billingItemId: z.string().uuid(),
    status: z.enum(ITEM_STATUSES),
    fromDate: isoDay,
    toDate: isoDay.nullable().optional(),
    // Default: paused → no_charge, suspended / grace → charge.
    chargeBehavior: z.enum(STATUS_CHARGE_BEHAVIORS).optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.toDate && val.toDate.getTime() < val.fromDate.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toDate'], message: 'toDate cannot be before fromDate' })
    }
  })
export type BillingItemStatusPeriodCreateInput = z.infer<typeof billingItemStatusPeriodCreateSchema>

export const billingItemStatusPeriodUpdateSchema = scopedSchema.extend({
  id: z.string().uuid(),
  // Resume = set the end of the open period.
  fromDate: isoDay.optional(),
  toDate: isoDay.nullable().optional(),
  chargeBehavior: z.enum(STATUS_CHARGE_BEHAVIORS).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
})
export type BillingItemStatusPeriodUpdateInput = z.infer<typeof billingItemStatusPeriodUpdateSchema>

export const billingItemStatusPeriodDeleteSchema = scopedSchema.extend({
  id: z.string().uuid(),
})
export type BillingItemStatusPeriodDeleteInput = z.infer<typeof billingItemStatusPeriodDeleteSchema>

/** Bulk: pause / suspend every recurring line of an account (L §4.3). */
export const billingItemStatusPeriodBulkSchema = scopedSchema
  .extend({
    billAccountId: z.string().uuid(),
    status: z.enum(ITEM_STATUSES),
    fromDate: isoDay,
    toDate: isoDay.nullable().optional(),
    chargeBehavior: z.enum(STATUS_CHARGE_BEHAVIORS).optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.toDate && val.toDate.getTime() < val.fromDate.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toDate'], message: 'toDate cannot be before fromDate' })
    }
  })
export type BillingItemStatusPeriodBulkInput = z.infer<typeof billingItemStatusPeriodBulkSchema>

export const billingItemStatusPeriodListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    billingItemId: z.string().uuid().optional(),
    status: z.enum(ITEM_STATUSES).optional(),
  })
  .passthrough()
export type BillingItemStatusPeriodListQuery = z.infer<typeof billingItemStatusPeriodListQuerySchema>

// ─── BillingAccountUsage payloads ────────────────────────────────

export const billingUsageCreateSchema = scopedSchema.extend({
  billAccountId: z.string().uuid(),
  uomCode: z.string().trim().min(1).max(64),
  // `quantity` arrives as a number from JSON; MikroORM stores it as
  // numeric(18,4). The service coerces to a string at persist time.
  quantity: z.number().finite().nonnegative(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  lineDescription: z.string().trim().min(1).max(500).optional(),
  sourceRef: z.string().trim().min(1).max(255).optional(),
}).superRefine((val, ctx) => {
  if (val.periodEnd < val.periodStart) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periodEnd'],
      message: 'periodEnd must be on or after periodStart',
    })
  }
})

export type BillingUsageCreateInput = z.infer<typeof billingUsageCreateSchema>

export const billingUsageListQuerySchema = z
  .object({
    ...listPaginationBase,
    billAccountId: z.string().uuid().optional(),
    uomCode: z.string().optional(),
    rated: queryBoolean, // true → already rated; false → unrated
    periodEndFrom: z.coerce.date().optional(),
    periodEndTo: z.coerce.date().optional(),
  })
  .passthrough()

export type BillingUsageListQuery = z.infer<typeof billingUsageListQuerySchema>

// Suppress unused-export TS warning — `ratePayloadByType` is reserved for
// reuse by a future per-tenant rate-validation CLI tool.
void ratePayloadByType

// ─── Bill Run trigger payloads (Phase 2) ─────────────────────────

export const BILL_RUN_MODES = ['real', 'test', 'dry'] as const
export type BillRunMode = (typeof BILL_RUN_MODES)[number]

export const billingRunTriggerSchema = scopedSchema.extend({
  // `triggeredBy` is filled in by the route layer (always 'manual' for
  // API triggers; the cron worker sets 'schedule'). The client cannot
  // forge a 'schedule' trigger — the field is intentionally omitted
  // from the input shape.
  mode: z.enum(BILL_RUN_MODES).default('real'),
  asOfDate: z.coerce.date().optional(),
  scopedAccountIds: z.array(z.string().uuid()).optional(),
  // Spec A: there is no `catchUp` flag — every run bills all due cycles up
  // to `asOfDate`. Old clients still sending it are not rejected: the
  // object schema strips unknown keys.
})

export type BillingRunTriggerInput = z.infer<typeof billingRunTriggerSchema>

export const billingRunRetryFailedSchema = scopedSchema.extend({
  billRunId: z.string().uuid(),
  mode: z.enum(BILL_RUN_MODES).default('real'),
})

export type BillingRunRetryFailedInput = z.infer<typeof billingRunRetryFailedSchema>

export const billingRunListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    status: z.enum(BILL_RUN_STATUSES).optional(),
    triggeredBy: z.enum(BILL_RUN_TRIGGERS).optional(),
    parentRunId: z.string().uuid().optional(),
    asOfDateFrom: z.coerce.date().optional(),
    asOfDateTo: z.coerce.date().optional(),
    // Spec F (F1): narrow the list to one run mode.
    mode: z.enum(['real', 'test', 'dry']).optional(),
  })
  .passthrough()

export type BillingRunListQuery = z.infer<typeof billingRunListQuerySchema>

// ─── Invoice post (Phase 4) ──────────────────────────────────────

export const billingInvoicePostSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
})

export type BillingInvoicePostInput = z.infer<typeof billingInvoicePostSchema>

// Spec B — email a posted document (manual send / resend).
export const billingInvoiceSendSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
})

export type BillingInvoiceSendInput = z.infer<typeof billingInvoiceSendSchema>

// ─── Draft invoice edits (Phase 4b) ──────────────────────────────

/**
 * Fields the operator may change on a draft invoice line. Per spec:
 * "operator CAN: add lines, remove lines, edit line description /
 * quantity / unit_price / amount". Spec B adds `taxRate` (VAT % of the
 * line). `currencyCode` is frozen at account create and intentionally absent.
 */
const lineEditableFields = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  quantity: z.coerce.number().finite().nonnegative().optional(),
  unitPriceNet: z.coerce.number().finite().optional(),
  // `totalNetAmount` is operator-overridable for the "I know better
  // than `unit_price × quantity`" cases (rare; mostly for negative
  // credits or rounding fix-ups). When provided, it short-circuits
  // the auto-compute path.
  totalNetAmount: z.coerce.number().finite().optional(),
  taxRate: taxRateSchema.optional(),
})

export const billingInvoiceEditLineSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
  invoiceLineId: z.string().uuid(),
  changes: lineEditableFields,
})

export type BillingInvoiceEditLineInput = z.infer<typeof billingInvoiceEditLineSchema>

export const billingInvoiceAddLineSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().finite().nonnegative(),
  unitPriceNet: z.coerce.number().finite(),
  // Optional metadata for traceability — typically operators leave
  // `billing_item_id` blank because ad-hoc lines aren't tied to a
  // Billing Item.
  billingItemId: z.string().uuid().optional(),
  billingType: z.enum(BILLING_ITEM_TYPES).optional(),
  // Omitted → the organization default VAT rate.
  taxRate: taxRateSchema.optional(),
})

export type BillingInvoiceAddLineInput = z.infer<typeof billingInvoiceAddLineSchema>

export const billingInvoiceRemoveLineSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
  invoiceLineId: z.string().uuid(),
})

export type BillingInvoiceRemoveLineInput = z.infer<typeof billingInvoiceRemoveLineSchema>

// ─── Test-invoices wipe (Phase 4b) ───────────────────────────────

export const billingWipeTestInvoicesSchema = scopedSchema.extend({
  /** Optional — when set, wipes only test invoices from this run. */
  billRunId: z.string().uuid().optional(),
})

export type BillingWipeTestInvoicesInput = z.infer<typeof billingWipeTestInvoicesSchema>

// Spec F (F-D1): test and dry runs can be deleted (real runs never).
export const billingRunDeleteSchema = scopedSchema.extend({
  billRunId: z.string().uuid(),
})

export type BillingRunDeleteInput = z.infer<typeof billingRunDeleteSchema>

// Post the draft invoices of a REAL run, one bounded batch per call; the
// caller passes back `nextCursor` until `remaining` is 0.
export const billingRunPostDraftsSchema = scopedSchema.extend({
  billRunId: z.string().uuid(),
  /** Continue after this invoice id (ids are processed in ascending order). */
  afterInvoiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export type BillingRunPostDraftsInput = z.infer<typeof billingRunPostDraftsSchema>

// ─── Prepaid: top-ups (SPEC-002 P2) ──────────────────────────────

export const billingTopupCreateSchema = scopedSchema.extend({
  // The route maps the `/accounts/{id}/topups` path param into billAccountId.
  billAccountId: z.string().uuid(),
  amount: z.number().finite().positive(),
  // Optional — defaults to the tenant config `prepaid.topup_provider`.
  providerKey: z.string().trim().min(1).max(64).optional(),
  successUrl: z.string().trim().url().max(2048).optional(),
  cancelUrl: z.string().trim().url().max(2048).optional(),
  // Optional idempotency for the initiating request.
  sourceRef: z.string().trim().min(1).max(255).optional(),
})

export type BillingTopupCreateInput = z.infer<typeof billingTopupCreateSchema>

export const billingTopupListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    status: z.enum(TOPUP_STATUSES).optional(),
    search: z.string().optional(),
  })
  .passthrough()

export type BillingTopupListQuery = z.infer<typeof billingTopupListQuerySchema>

// ─── Prepaid: transactions / manual adjustments (SPEC-002 P1/P5) ──

export const billingTransactionAdjustSchema = scopedSchema
  .extend({
    billAccountId: z.string().uuid(),
    // SIGNED: > 0 credit, < 0 debit. Zero is rejected.
    amount: z.number().finite(),
    description: z.string().trim().min(1).max(500),
    sourceRef: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.amount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'amount must be non-zero (positive credit or negative debit)',
      })
    }
  })

export type BillingTransactionAdjustInput = z.infer<typeof billingTransactionAdjustSchema>

export const billingTransactionListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
  })
  .passthrough()

export type BillingTransactionListQuery = z.infer<typeof billingTransactionListQuerySchema>

// ─── Prepaid: statements (SPEC-002 P3) ───────────────────────────

export const billingStatementGenerateSchema = scopedSchema.extend({
  billAccountId: z.string().uuid(),
  // "today" the close evaluates the due period against. Defaults to now.
  asOfDate: z.coerce.date().optional(),
})

export type BillingStatementGenerateInput = z.infer<typeof billingStatementGenerateSchema>

export const billingStatementListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    status: z.enum(STATEMENT_STATUSES).optional(),
    periodEndFrom: z.coerce.date().optional(),
    periodEndTo: z.coerce.date().optional(),
  })
  .passthrough()

export type BillingStatementListQuery = z.infer<typeof billingStatementListQuerySchema>



// ─── Spec 0 — invoice ledger + billing settings ──────────────────


export const billingInvoiceListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    status: z.enum(INVOICE_STATUSES).optional(),
    documentType: z.enum(DOCUMENT_TYPES).optional(),
    billRunId: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    testRun: queryBoolean,
    search: z.string().trim().max(100).optional(),
    // Spec B: computed overdue (B-D6) and due-date window.
    overdue: queryBoolean,
    dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .passthrough()

export type BillingInvoiceListQuery = z.infer<typeof billingInvoiceListQuerySchema>

const numberMaskSchema = z
  .string()
  .trim()
  .superRefine((mask, ctx) => {
    for (const code of validateMask(mask)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: code })
    }
  })

const moneyString = z.coerce.number().finite().nonnegative()

/** Trimmed optional text; '' → null (clears the field). */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
}

// Seller address: same shape (and country rule) as the buyer's invoice address.
const sellerAddressSchema = invoiceAddressSchema

export const billingSettingsUpdateSchema = scopedSchema.extend({
  lowBalanceThresholdDefault: moneyString.optional(),
  nearLimitBufferDefault: moneyString.optional(),
  statementEnabled: z.boolean().optional(),
  topupTaxRate: z.coerce.number().finite().min(0).max(100).optional(),
  topupProvider: z.string().trim().min(1).max(64).optional(),
  numberMasks: z
    .object(Object.fromEntries(DOCUMENT_SERIES.map((series) => [series, numberMaskSchema.optional()])) as Record<
      (typeof DOCUMENT_SERIES)[number],
      z.ZodOptional<typeof numberMaskSchema>
    >)
    .strict()
    .optional(),
  // Seller / payment / document fields (Spec B). Empty string clears.
  legalName: optionalText(255),
  sellerAddress: sellerAddressSchema.nullable().optional(),
  taxId: optionalText(64),
  bankName: optionalText(255),
  iban: z
    .string()
    .transform(normalizeIban)
    .refine((value) => value === '' || isValidIban(value), { message: 'billing.settings.error.iban_invalid' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  bic: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === '' || isValidBic(value), { message: 'billing.settings.error.bic_invalid' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  invoiceFooter: optionalText(2000),
  logoAttachmentId: z.string().uuid().nullable().optional(),
  defaultPaymentTermsDays: paymentTermsDaysSchema.optional(),
  defaultTaxRate: taxRateSchema.optional(),
  // Spec F (F-D3).
  prepaidTaxPoint: z.enum(PREPAID_TAX_POINTS).optional(),
})

export type BillingSettingsUpdateInput = z.infer<typeof billingSettingsUpdateSchema>

// ─── Spec C — payments ───────────────────────────────────────────

export const PAYMENT_STATUSES = [
  'unmatched',
  'matched',
  'partially_allocated',
  'allocated',
  'ignored',
  'converted_to_topup',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_SOURCES = ['csv', 'manual', 'gateway'] as const
export type PaymentSource = (typeof PAYMENT_SOURCES)[number]

export const PAYMENT_MATCH_REASONS = [
  'no_reference',
  'currency_mismatch',
  'invoice_already_paid',
  'prepaid_account',
  'manual',
] as const
export type PaymentMatchReason = (typeof PAYMENT_MATCH_REASONS)[number]

export const ALLOCATION_SOURCE_TYPES = ['payment', 'credit_memo'] as const
export type AllocationSourceType = (typeof ALLOCATION_SOURCE_TYPES)[number]

export const ALLOCATED_BY = ['auto', 'credit', 'user', 'gateway'] as const
export type AllocatedBy = (typeof ALLOCATED_BY)[number]

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const positiveMoney = z.coerce.number().finite().positive()

export const billingPaymentCreateSchema = scopedSchema.extend({
  receivedAt: isoDateString,
  amount: positiveMoney,
  currencyCode: z.string().trim().toUpperCase().length(3),
  reference: z.string().trim().max(500).optional(),
  payerName: z.string().trim().max(255).optional(),
  payerAccount: z.string().trim().max(64).optional(),
  // Known account → status `matched` and credit auto-apply; else `unmatched`.
  billAccountId: z.string().uuid().optional(),
})
export type BillingPaymentCreateInput = z.infer<typeof billingPaymentCreateSchema>

export const billingPaymentAssignSchema = scopedSchema.extend({
  paymentId: z.string().uuid(),
  billAccountId: z.string().uuid(),
})
export type BillingPaymentAssignInput = z.infer<typeof billingPaymentAssignSchema>

export const billingPaymentAllocateSchema = scopedSchema.extend({
  paymentId: z.string().uuid(),
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount: positiveMoney }))
    .min(1)
    .max(100),
})
export type BillingPaymentAllocateInput = z.infer<typeof billingPaymentAllocateSchema>

export const billingAllocationRemoveSchema = scopedSchema.extend({
  allocationId: z.string().uuid(),
})
export type BillingAllocationRemoveInput = z.infer<typeof billingAllocationRemoveSchema>

export const billingPaymentIdSchema = scopedSchema.extend({
  paymentId: z.string().uuid(),
})
export type BillingPaymentIdInput = z.infer<typeof billingPaymentIdSchema>

export const billingPaymentConvertSchema = scopedSchema.extend({
  paymentId: z.string().uuid(),
  billAccountId: z.string().uuid(),
})
export type BillingPaymentConvertInput = z.infer<typeof billingPaymentConvertSchema>

// CSV upload: 2 MB of text, ≤ 5,000 data rows (checked by the parser).
export const PAYMENT_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const PAYMENT_IMPORT_MAX_ROWS = 5000

export const billingPaymentImportSchema = scopedSchema.extend({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().max(PAYMENT_IMPORT_MAX_BYTES),
})
export type BillingPaymentImportInput = z.infer<typeof billingPaymentImportSchema>

export const billingPaymentListQuerySchema = z
  .object({
    ...listPaginationBase,
    id: z.string().uuid().optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
    billAccountId: z.string().uuid().optional(),
    importId: z.string().uuid().optional(),
    receivedFrom: isoDateString.optional(),
    receivedTo: isoDateString.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .passthrough()
export type BillingPaymentListQuery = z.infer<typeof billingPaymentListQuerySchema>

export const billingPaymentImportListQuerySchema = z
  .object({ ...listPaginationBase, id: z.string().uuid().optional() })
  .passthrough()
export type BillingPaymentImportListQuery = z.infer<typeof billingPaymentImportListQuerySchema>

// ─── Spec D — credit / debit memos ───────────────────────────────

export const MEMO_TYPES = ['credit_memo', 'debit_memo'] as const
export type MemoType = (typeof MEMO_TYPES)[number]

const memoLineSchema = z.object({
  // Copied from the original (credit prefill). The original line's VAT rate wins.
  correctsLineId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().finite().positive(),
  unitPriceNet: z.coerce.number().finite().nonnegative(),
  // New lines: omitted → organization default rate.
  taxRate: z.coerce.number().finite().min(0).max(100).optional(),
})
export type MemoLineInput = z.infer<typeof memoLineSchema>

export const billingMemoCreateSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
  type: z.enum(MEMO_TYPES),
  reason: z.string().trim().min(1, 'billing.memo.error.reason_required').max(1000),
  // Credit memo without lines = full credit (all original lines). Debit memo
  // without lines = empty draft (lines are added on the draft).
  lines: z.array(memoLineSchema).max(200).optional(),
})
export type BillingMemoCreateInput = z.infer<typeof billingMemoCreateSchema>

export const billingDraftDeleteSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
})
export type BillingDraftDeleteInput = z.infer<typeof billingDraftDeleteSchema>
