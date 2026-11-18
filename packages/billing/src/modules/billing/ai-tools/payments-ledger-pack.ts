/**
 * Payments, prepaid balance ledger and consumption statements.
 *
 * - `billing.list_payments` / `billing.get_payment` over
 *   `GET /api/billing/payments` and `GET /api/billing/payments/:id`.
 * - `billing.list_transactions` over `GET /api/billing/transactions`
 *   (prepaid balance ledger: top-ups, usage / recurring debits, adjustments).
 * - `billing.list_statements` / `billing.get_statement` over
 *   `GET /api/billing/statements` (the detail page reads one row via `?id=`).
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import { PAYMENT_STATUSES, STATEMENT_STATUSES, TRANSACTION_TYPES } from '../data/validators'
import {
  asRecordArray,
  assertTenantScope,
  buildListQuery,
  failureMessage,
  isNotFound,
  isoDateInput,
  listPaginationInput,
  mapPagedList,
  runBillingOperation,
  type PagedListOutput,
} from './_shared'
import { asBillingTool, type BillingAiToolDefinition } from './types'

export const PAYMENT_VIEW_FEATURE = 'billing.payment.view'
export const BALANCE_VIEW_FEATURE = 'billing.balance.view'
export const STATEMENT_VIEW_FEATURE = 'billing.statement.view'

/* ------------------------------------------------------------------------ */
/*  Payments                                                                 */
/* ------------------------------------------------------------------------ */

export const listPaymentsInput = z.object({
  ...listPaginationInput,
  status: z
    .enum(PAYMENT_STATUSES)
    .optional()
    .describe('unmatched, matched, partially_allocated, allocated, ignored or converted_to_topup.'),
  billAccountId: z.string().uuid().optional().describe('Restrict to the payments of one billing account.'),
  importId: z.string().uuid().optional().describe('Restrict to the lines of one bank CSV import.'),
  receivedFrom: isoDateInput.optional().describe('YYYY-MM-DD: received on or after.'),
  receivedTo: isoDateInput.optional().describe('YYYY-MM-DD: received on or before.'),
  search: z.string().trim().max(100).optional().describe('Match on the payment reference or payer name.'),
})

export type ListPaymentsInput = z.infer<typeof listPaymentsInput>

export const listPaymentsTool = defineApiBackedAiTool<ListPaymentsInput, unknown, PagedListOutput>({
  name: 'billing.list_payments',
  displayName: 'List billing payments',
  description:
    'List the payment register (bank CSV lines, manual entries, gateway captures). Returns { items, total, page, ' +
    'pageSize, totalPages }; each item carries id, received_at, amount, currency_code, reference, payer_name, ' +
    'payer_account, source (csv / manual / gateway), import_id, bill_account_id, bill_account_name, status, ' +
    'unallocated_amount, match_reason and topup_id.',
  inputSchema: listPaymentsInput,
  requiredFeatures: [PAYMENT_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/payments',
      query: buildListQuery(input, {
        status: input.status,
        billAccountId: input.billAccountId,
        importId: input.importId,
        receivedFrom: input.receivedFrom,
        receivedTo: input.receivedTo,
        search: input.search,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const getPaymentInput = z.object({
  paymentId: z.string().uuid().describe('Billing payment id (UUID).'),
})

export type GetPaymentInput = z.infer<typeof getPaymentInput>

export type GetPaymentOutput =
  | { found: false; paymentId: string }
  | { found: true; payment: Record<string, unknown>; allocations: Array<Record<string, unknown>> }

const GET_PAYMENT = { name: 'billing.get_payment', requiredFeatures: [PAYMENT_VIEW_FEATURE] }

export const getPaymentTool = defineAiTool<GetPaymentInput, GetPaymentOutput>({
  name: GET_PAYMENT.name,
  displayName: 'Get billing payment',
  description:
    'Fetch one payment with the invoices it was allocated to (invoice number, amount, allocated_by). Returns ' +
    '{ found: false } when the payment is missing or outside the caller scope.',
  inputSchema: getPaymentInput,
  requiredFeatures: [...GET_PAYMENT.requiredFeatures],
  tags: ['read', 'billing'],
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    const input = getPaymentInput.parse(rawInput)
    const response = await runBillingOperation<Record<string, unknown>>(ctx, GET_PAYMENT, {
      method: 'GET',
      path: `/billing/payments/${input.paymentId}`,
    })
    if (!response.success) {
      if (isNotFound(response)) return { found: false, paymentId: input.paymentId }
      throw new Error(failureMessage(response, `Failed to load billing payment ${input.paymentId}`))
    }
    const payment = response.data?.payment
    if (!payment || typeof payment !== 'object') return { found: false, paymentId: input.paymentId }
    return {
      found: true,
      payment: payment as Record<string, unknown>,
      allocations: asRecordArray(response.data?.allocations),
    }
  },
})

/* ------------------------------------------------------------------------ */
/*  Prepaid balance ledger                                                   */
/* ------------------------------------------------------------------------ */

export const listTransactionsInput = z.object({
  ...listPaginationInput,
  billAccountId: z.string().uuid().optional().describe('Restrict to the ledger of one (prepaid) billing account.'),
  type: z
    .enum(TRANSACTION_TYPES)
    .optional()
    .describe('Ledger entry type: topup, usage, recurring, one_time, adjustment or reversal.'),
  createdFrom: isoDateInput.optional().describe('YYYY-MM-DD: entries created on or after.'),
  createdTo: isoDateInput.optional().describe('YYYY-MM-DD: entries created on or before.'),
})

export type ListTransactionsInput = z.infer<typeof listTransactionsInput>

export const listTransactionsTool = defineApiBackedAiTool<ListTransactionsInput, unknown, PagedListOutput>({
  name: 'billing.list_transactions',
  displayName: 'List balance transactions',
  description:
    'List prepaid balance ledger entries (top-ups, usage / recurring debits, manual adjustments). Returns { items, ' +
    'total, page, pageSize, totalPages }; each item carries id, bill_account_id, type, amount (signed), currency_code, ' +
    'balance_after, description, the source ids (usage_id, billing_item_id, topup_id, statement_id) and created_at.',
  inputSchema: listTransactionsInput,
  requiredFeatures: [BALANCE_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/transactions',
      query: buildListQuery(input, {
        billAccountId: input.billAccountId,
        type: input.type,
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

/* ------------------------------------------------------------------------ */
/*  Consumption statements                                                   */
/* ------------------------------------------------------------------------ */

export const listStatementsInput = z.object({
  ...listPaginationInput,
  billAccountId: z.string().uuid().optional().describe('Restrict to the statements of one (prepaid) billing account.'),
  status: z.enum(STATEMENT_STATUSES).optional().describe('generated or sent.'),
  periodEndFrom: isoDateInput.optional().describe('YYYY-MM-DD: statement period ends on or after.'),
  periodEndTo: isoDateInput.optional().describe('YYYY-MM-DD: statement period ends on or before.'),
})

export type ListStatementsInput = z.infer<typeof listStatementsInput>

const STATEMENT_DESCRIPTION_FIELDS =
  'id, bill_account_id, bill_run_id, period_start, period_end, currency_code, opening_balance, total_topups, ' +
  'total_usage, total_recurring, total_adjustments, closing_balance, debit_breakdown, vat_summary, status'

export const listStatementsTool = defineApiBackedAiTool<ListStatementsInput, unknown, PagedListOutput>({
  name: 'billing.list_statements',
  displayName: 'List consumption statements',
  description:
    'List prepaid consumption statements (one per closed billing period). Returns { items, total, page, pageSize, ' +
    `totalPages }; each item carries ${STATEMENT_DESCRIPTION_FIELDS}.`,
  inputSchema: listStatementsInput,
  requiredFeatures: [STATEMENT_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/statements',
      query: buildListQuery(input, {
        billAccountId: input.billAccountId,
        status: input.status,
        periodEndFrom: input.periodEndFrom,
        periodEndTo: input.periodEndTo,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const getStatementInput = z.object({
  statementId: z.string().uuid().describe('Consumption statement id (UUID).'),
})

export type GetStatementInput = z.infer<typeof getStatementInput>

export type GetStatementOutput =
  | { found: false; statementId: string }
  | { found: true; statement: Record<string, unknown> }

const GET_STATEMENT = { name: 'billing.get_statement', requiredFeatures: [STATEMENT_VIEW_FEATURE] }

export const getStatementTool = defineAiTool<GetStatementInput, GetStatementOutput>({
  name: GET_STATEMENT.name,
  displayName: 'Get consumption statement',
  description:
    `Fetch one prepaid consumption statement: ${STATEMENT_DESCRIPTION_FIELDS}. ` +
    'Returns { found: false } when the statement is missing or outside the caller scope.',
  inputSchema: getStatementInput,
  requiredFeatures: [...GET_STATEMENT.requiredFeatures],
  tags: ['read', 'billing'],
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    const input = getStatementInput.parse(rawInput)
    const response = await runBillingOperation(ctx, GET_STATEMENT, {
      method: 'GET',
      path: '/billing/statements',
      query: { id: input.statementId, page: 1, pageSize: 1 },
    })
    if (!response.success) {
      if (isNotFound(response)) return { found: false, statementId: input.statementId }
      throw new Error(failureMessage(response, `Failed to load consumption statement ${input.statementId}`))
    }
    const statement = asRecordArray((response.data as { items?: unknown } | undefined)?.items)[0]
    if (!statement) return { found: false, statementId: input.statementId }
    return { found: true, statement }
  },
})

export const paymentsLedgerAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listPaymentsTool),
  asBillingTool(getPaymentTool),
  asBillingTool(listTransactionsTool),
  asBillingTool(listStatementsTool),
  asBillingTool(getStatementTool),
]

export default paymentsLedgerAiTools
