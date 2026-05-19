import { z } from 'zod'

// ─── Enums ───────────────────────────────────────────────────────

export const BILLING_ITEM_TYPES = ['one_time', 'recurring', 'usage'] as const
export type BillingItemType = (typeof BILLING_ITEM_TYPES)[number]

export const BILL_CYCLES = ['weekly', 'monthly', 'quarterly', 'annually'] as const
export type BillCycle = (typeof BILL_CYCLES)[number]

export const BILL_RUN_TRIGGERS = ['schedule', 'manual'] as const
export type BillRunTrigger = (typeof BILL_RUN_TRIGGERS)[number]

export const BILL_RUN_STATUSES = ['running', 'completed', 'partial_failure', 'failed'] as const
export type BillRunStatus = (typeof BILL_RUN_STATUSES)[number]

export const BILL_RUN_OUTCOME_STATUSES = [
  'success',
  'success_with_warnings',
  'skipped_existing_draft',
  'failed',
] as const
export type BillRunOutcomeStatus = (typeof BILL_RUN_OUTCOME_STATUSES)[number]

export const DRAFT_INVOICE_EDIT_ACTIONS = ['line_added', 'line_removed', 'line_edited'] as const
export type DraftInvoiceEditAction = (typeof DRAFT_INVOICE_EDIT_ACTIONS)[number]

export const INVOICE_STATUSES = ['draft', 'posted', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

// `mon`–`sun` for weekly cycles; 1–28 (as text) for the others.
// Why text for numeric anchors: the column type stays uniform across cycles
// and we never do arithmetic on the raw value (the engine parses it on use).
const WEEKLY_ANCHORS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export const billCycleAnchorSchema = z
  .string()
  .min(1)
  .refine(
    (val) => {
      if ((WEEKLY_ANCHORS as readonly string[]).includes(val.toLowerCase())) return true
      const n = Number.parseInt(val, 10)
      return Number.isInteger(n) && n >= 1 && n <= 28
    },
    {
      message:
        'bill_cycle_anchor must be 1–28 (monthly/quarterly/annually) or mon–sun (weekly)',
    },
  )

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

const listPaginationBase = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}

// ─── BillingAccount payloads ─────────────────────────────────────

export const billingAccountCreateSchema = scopedSchema.extend({
  customerId: z.string().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  currencyCode: z.string().trim().toUpperCase().length(3),
  billCycle: z.enum(BILL_CYCLES),
  billCycleAnchor: billCycleAnchorSchema,
  invoiceEmail: z.string().trim().email().max(320),
  invoiceLanguage: z.string().trim().toLowerCase().min(2).max(5),
  taxId: z.string().trim().max(64).optional(),
  invoiceAddress: invoiceAddressSchema,
  nextBillDate: z.coerce.date(),
  lastBillDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
})

export type BillingAccountCreateInput = z.infer<typeof billingAccountCreateSchema>

export const billingAccountUpdateSchema = scopedSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  billCycle: z.enum(BILL_CYCLES).optional(),
  billCycleAnchor: billCycleAnchorSchema.optional(),
  invoiceEmail: z.string().trim().email().max(320).optional(),
  invoiceLanguage: z.string().trim().toLowerCase().min(2).max(5).optional(),
  taxId: z.string().trim().max(64).nullable().optional(),
  invoiceAddress: invoiceAddressSchema.optional(),
  nextBillDate: z.coerce.date().optional(),
  lastBillDate: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
  // `currencyCode` is intentionally NOT updatable — currency is frozen at
  // account create time so historical invoices keep their currency context.
  // `customerId` is also immutable; create a new account if the customer
  // FK changes.
})

export type BillingAccountUpdateInput = z.infer<typeof billingAccountUpdateSchema>

export const billingAccountDeleteSchema = scopedSchema.extend({
  id: z.string().uuid(),
})

export type BillingAccountDeleteInput = z.infer<typeof billingAccountDeleteSchema>

export const billingAccountListQuerySchema = z
  .object({
    ...listPaginationBase,
    customerId: z.string().optional(),
    currencyCode: z.string().optional(),
    billCycle: z.enum(BILL_CYCLES).optional(),
    isActive: z.coerce.boolean().optional(),
    search: z.string().optional(),
  })
  .passthrough()

export type BillingAccountListQuery = z.infer<typeof billingAccountListQuerySchema>

// ─── BillingItem payloads ────────────────────────────────────────

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
    // currency_mismatch and billed_to_date are system-managed, never set by
    // clients on create.
  })
  .superRefine((val, ctx) => {
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
})

export type BillingItemUpdateInput = z.infer<typeof billingItemUpdateSchema>

export const billingItemDeleteSchema = scopedSchema.extend({
  id: z.string().uuid(),
})

export type BillingItemDeleteInput = z.infer<typeof billingItemDeleteSchema>

export const billingItemListQuerySchema = z
  .object({
    ...listPaginationBase,
    billAccountId: z.string().uuid().optional(),
    type: z.enum(BILLING_ITEM_TYPES).optional(),
    subscriptionId: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
    activeAt: z.coerce.date().optional(), // bill_start_date <= X AND (bill_end_date IS NULL OR bill_end_date >= X)
  })
  .passthrough()

export type BillingItemListQuery = z.infer<typeof billingItemListQuerySchema>

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
    rated: z.coerce.boolean().optional(), // true → already rated; false → unrated
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
  catchUp: z.boolean().optional(),
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
    status: z.enum(BILL_RUN_STATUSES).optional(),
    triggeredBy: z.enum(BILL_RUN_TRIGGERS).optional(),
    parentRunId: z.string().uuid().optional(),
    asOfDateFrom: z.coerce.date().optional(),
    asOfDateTo: z.coerce.date().optional(),
  })
  .passthrough()

export type BillingRunListQuery = z.infer<typeof billingRunListQuerySchema>

// ─── Invoice post (Phase 4) ──────────────────────────────────────

export const billingInvoicePostSchema = scopedSchema.extend({
  invoiceId: z.string().uuid(),
})

export type BillingInvoicePostInput = z.infer<typeof billingInvoicePostSchema>

// ─── Draft invoice edits (Phase 4b) ──────────────────────────────

/**
 * Fields the operator may change on a draft invoice line. Per spec:
 * "operator CAN: add lines, remove lines, edit line description /
 * quantity / unit_price / amount". `taxRate` is owned by core/sales
 * tax service and `currencyCode` is frozen at account create — both
 * intentionally absent from this schema.
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


