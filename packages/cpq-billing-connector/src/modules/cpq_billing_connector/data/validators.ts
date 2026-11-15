import { z } from 'zod'
import {
  BILL_CYCLES,
  billCycleAnchorSchema,
  invoiceAddressSchema,
} from '@dainamite/billing/modules/billing/data/validators'
import { INVOICE_LANGUAGE_CODES } from '@dainamite/billing/modules/billing/lib/invoiceLanguages'

/** Same rule as billing's account schema: a code its document template supports. */
const invoiceLanguageSchema = z.string().trim().toLowerCase().pipe(z.enum(INVOICE_LANGUAGE_CODES))

/** `YYYY-MM-DD` that is a real calendar date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Expected a valid calendar date')

export const ORDER_SETUP_ACCOUNT_MODES = ['existing', 'new'] as const
export type OrderSetupAccountMode = (typeof ORDER_SETUP_ACCOUNT_MODES)[number]

/**
 * New-account fields an operator may override. Validated with billing's own
 * schemas so a saved override can never fail `billing.accounts.create` later.
 * Strict: unknown keys are rejected rather than silently stored.
 */
export const accountOverridesSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    customerKind: z.enum(['company', 'person']),
    invoiceEmail: z.string().trim().email().max(320),
    invoiceLanguage: invoiceLanguageSchema,
    invoiceAddress: invoiceAddressSchema,
    billCycle: z.enum(BILL_CYCLES),
    billCycleAnchor: billCycleAnchorSchema,
    nextBillDate: isoDateSchema,
    taxId: z.string().trim().max(64).nullable(),
  })
  .partial()
  .strict()

export type AccountOverrides = z.infer<typeof accountOverridesSchema>

/**
 * `accountMode` is required for new-sale orders and ignored for amend / renew
 * orders, whose added lines bill to the subscription's existing account (the
 * service enforces both — it knows the order's quote type).
 */
export const orderSetupUpsertSchema = z
  .object({
    accountMode: z.enum(ORDER_SETUP_ACCOUNT_MODES).optional(),
    billingAccountId: z.string().uuid().nullable().optional(),
    accountOverrides: accountOverridesSchema.optional(),
    defaultBillStartDate: isoDateSchema.nullable().optional(),
    lineBillStarts: z.record(z.string().uuid(), isoDateSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.accountMode === 'existing' && !value.billingAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['billingAccountId'],
        message: 'billingAccountId is required when accountMode is "existing"',
      })
    }
  })

export type OrderSetupUpsertBody = z.infer<typeof orderSetupUpsertSchema>

/** Command input: the body plus the order and scope the route resolved. */
export const orderSetupSaveCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  orderId: z.string().uuid(),
  body: orderSetupUpsertSchema,
})

export type OrderSetupSaveCommandInput = z.infer<typeof orderSetupSaveCommandSchema>
