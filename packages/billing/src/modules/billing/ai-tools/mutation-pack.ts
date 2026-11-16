/**
 * Billing mutation tools: `billing.trigger_bill_run` + `billing.record_payment`.
 *
 * Both follow the framework mutation approval contract (same shape as the core
 * catalog mutation pack):
 *
 * - `isMutation: true`: the agent runtime never runs the handler on a tool
 *   call. It calls `prepareMutation(...)`, which stores an `ai_pending_actions`
 *   row and streams a `mutation-preview-card` built from `loadBeforeRecord`.
 *   Only the operator's confirm runs the handler (through the pending-action
 *   executor). An agent switched to `mutationPolicy: 'read-only'` (a tenant
 *   override) never even sees these tools.
 * - `isDestructive: true`: the call is gated even under the
 *   `destructive-confirm-required` policy.
 * - The handler additionally refuses to run without `approvedPendingActionId`
 *   (only the pending-action executor sets it), so a direct call, e.g. an MCP
 *   client invoking the tool, fails closed instead of writing.
 * - The write itself goes through the existing REST route in-process, so the
 *   route RBAC, validation, command, audit log and events stay identical to a
 *   UI write.
 *
 * `billing.trigger_bill_run` accepts only `mode: 'dry' | 'test'`. A real run
 * advances account billing state and creates real draft invoices; the agent
 * can preview and test, a human triggers real runs from the Bill Runs page.
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolLoadBeforeSingleRecord } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  assertApprovedMutation,
  assertTenantScope,
  failureMessage,
  isoDateInput,
  MAX_LIST_LIMIT,
  runBillingOperation,
} from './_shared'
import { billingEntityIds } from '../data/entityIds'
import { asBillingTool, type BillingAiToolDefinition } from './types'

export const RUN_TRIGGER_FEATURE = 'billing.run.trigger'
export const PAYMENT_MANAGE_FEATURE = 'billing.payment.manage'

/** Run modes the agent may request. `real` is intentionally absent. */
export const AGENT_BILL_RUN_MODES = ['dry', 'test'] as const

/* ------------------------------------------------------------------------ */
/*  billing.trigger_bill_run                                                 */
/* ------------------------------------------------------------------------ */

export const triggerBillRunInput = z
  .object({
    mode: z
      .enum(AGENT_BILL_RUN_MODES)
      .describe(
        'dry = simulate every due cycle in memory, persist no invoices; test = persist test-flagged draft invoices ' +
          'for every due cycle without advancing account state. Real runs are not available to the agent.',
      ),
    asOfDate: isoDateInput
      .optional()
      .describe('YYYY-MM-DD: bill every cycle due up to this date. Default: today.'),
    scopedAccountIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_LIST_LIMIT)
      .optional()
      .describe('Restrict the run to these billing accounts. Omit to run for every due account.'),
  })
  .strict()

export type TriggerBillRunInput = z.infer<typeof triggerBillRunInput>

export type TriggerBillRunOutput = {
  billRunId: string | null
  status: string | null
  outcomesCount: number
  mode: TriggerBillRunInput['mode']
}

const TRIGGER_BILL_RUN = { name: 'billing.trigger_bill_run', requiredFeatures: [RUN_TRIGGER_FEATURE] }

function triggerBillRunPreview(input: TriggerBillRunInput): Record<string, unknown> {
  return {
    mode: input.mode,
    asOfDate: input.asOfDate ?? null,
    scopedAccountIds: input.scopedAccountIds ?? null,
  }
}

export const triggerBillRunTool = defineAiTool<TriggerBillRunInput, TriggerBillRunOutput>({
  name: TRIGGER_BILL_RUN.name,
  displayName: 'Trigger Bill Run (dry / test)',
  description:
    'Start a Bill Run in dry or test mode (never real). Every run bills all cycles due up to asOfDate. Requires the ' +
    'operator to approve the preview card before it runs. Returns { billRunId, status, outcomesCount, mode }; inspect ' +
    'the result with billing.get_bill_run. Fails with billing.run.lock_busy when another run is in progress.',
  inputSchema: triggerBillRunInput,
  requiredFeatures: [...TRIGGER_BILL_RUN.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = triggerBillRunInput.parse(rawInput)
    return {
      recordId: 'new-bill-run',
      entityType: billingEntityIds.run,
      recordVersion: null,
      before: {},
      after: triggerBillRunPreview(input),
      display: {
        fieldLabels: { mode: 'Run mode', asOfDate: 'As-of date', scopedAccountIds: 'Accounts' },
        after: {
          asOfDate: input.asOfDate ?? 'today',
          scopedAccountIds: input.scopedAccountIds ? `${input.scopedAccountIds.length} selected` : 'all due accounts',
        },
      },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, TRIGGER_BILL_RUN.name)
    const input = triggerBillRunInput.parse(rawInput)
    const body: Record<string, unknown> = { mode: input.mode }
    if (input.asOfDate) body.asOfDate = input.asOfDate
    if (input.scopedAccountIds) body.scopedAccountIds = input.scopedAccountIds
    const response = await runBillingOperation<{
      billRunId?: string | null
      status?: string | null
      outcomesCount?: number
    }>(ctx, TRIGGER_BILL_RUN, { method: 'POST', path: '/billing/runs', body })
    if (!response.success) {
      throw new Error(failureMessage(response, `Failed to trigger a ${input.mode} Bill Run`))
    }
    return {
      billRunId: response.data?.billRunId ?? null,
      status: response.data?.status ?? null,
      outcomesCount: typeof response.data?.outcomesCount === 'number' ? response.data.outcomesCount : 0,
      mode: input.mode,
    }
  },
})

/* ------------------------------------------------------------------------ */
/*  billing.record_payment                                                   */
/* ------------------------------------------------------------------------ */

export const recordPaymentInput = z
  .object({
    receivedAt: isoDateInput.describe('YYYY-MM-DD: date the money was received.'),
    amount: z.number().finite().positive().describe('Amount received, in currencyCode (e.g. 120.5).'),
    currencyCode: z.string().trim().length(3).describe('ISO 4217 currency code, e.g. EUR.'),
    reference: z.string().trim().max(500).optional().describe('Bank transfer reference / title.'),
    payerName: z.string().trim().max(255).optional().describe('Name of the payer.'),
    billAccountId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Billing account the payment belongs to. When set, the payment is matched and applied to the account's open " +
          'invoices (oldest due first); otherwise it stays unmatched.',
      ),
  })
  .strict()

export type RecordPaymentInput = z.infer<typeof recordPaymentInput>

export type RecordPaymentOutput = {
  paymentId: string | null
  status: string | null
  unallocatedAmount: string | number | null
}

const RECORD_PAYMENT = { name: 'billing.record_payment', requiredFeatures: [PAYMENT_MANAGE_FEATURE] }

export const recordPaymentTool = defineAiTool<RecordPaymentInput, RecordPaymentOutput>({
  name: RECORD_PAYMENT.name,
  displayName: 'Record payment',
  description:
    'Record a manual payment received outside the bank import. With billAccountId the payment is matched and ' +
    "applied to that account's open invoices. Requires the operator to approve the preview card before it is saved. " +
    'Returns { paymentId, status, unallocatedAmount }.',
  inputSchema: recordPaymentInput,
  requiredFeatures: [...RECORD_PAYMENT.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = recordPaymentInput.parse(rawInput)
    return {
      recordId: 'new-payment',
      entityType: billingEntityIds.payment,
      recordVersion: null,
      before: {},
      after: {
        receivedAt: input.receivedAt,
        amount: input.amount,
        currencyCode: input.currencyCode.toUpperCase(),
        reference: input.reference ?? null,
        payerName: input.payerName ?? null,
        billAccountId: input.billAccountId ?? null,
      },
      display: {
        fieldLabels: {
          receivedAt: 'Received on',
          amount: 'Amount',
          currencyCode: 'Currency',
          reference: 'Reference',
          payerName: 'Payer',
          billAccountId: 'Billing account',
        },
      },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, RECORD_PAYMENT.name)
    const input = recordPaymentInput.parse(rawInput)
    const body: Record<string, unknown> = {
      receivedAt: input.receivedAt,
      amount: input.amount,
      currencyCode: input.currencyCode.toUpperCase(),
    }
    if (input.reference) body.reference = input.reference
    if (input.payerName) body.payerName = input.payerName
    if (input.billAccountId) body.billAccountId = input.billAccountId
    const response = await runBillingOperation<{
      paymentId?: string | null
      status?: string | null
      unallocatedAmount?: string | number | null
    }>(ctx, RECORD_PAYMENT, { method: 'POST', path: '/billing/payments', body })
    if (!response.success) {
      throw new Error(failureMessage(response, 'Failed to record the payment'))
    }
    return {
      paymentId: response.data?.paymentId ?? null,
      status: response.data?.status ?? null,
      unallocatedAmount: response.data?.unallocatedAmount ?? null,
    }
  },
})

export const mutationAiTools: BillingAiToolDefinition[] = [
  asBillingTool(triggerBillRunTool),
  asBillingTool(recordPaymentTool),
]

export default mutationAiTools
