/**
 * `billing.list_invoices` + `billing.get_invoice`.
 *
 * Read-only wrappers over `GET /api/billing/invoices` (billing-owned document
 * ledger: invoices, credit / debit memos, top-up receipts) and
 * `GET /api/billing/invoices/:id` (one document with its lines, the payments /
 * memos that settled it, and the memos correcting it).
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import { DOCUMENT_TYPES, INVOICE_STATUSES } from '../data/validators'
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

export const INVOICE_VIEW_FEATURE = 'billing.invoice.view'

export const listInvoicesInput = z.object({
  ...listPaginationInput,
  status: z.enum(INVOICE_STATUSES).optional().describe('Document status. draft = not posted yet (editable).'),
  documentType: z.enum(DOCUMENT_TYPES).optional().describe('invoice, credit_memo, debit_memo or receipt (prepaid top-up).'),
  billAccountId: z.string().uuid().optional().describe('Restrict to the documents of one billing account.'),
  billRunId: z.string().uuid().optional().describe('Restrict to the drafts produced by one Bill Run.'),
  testRun: z
    .boolean()
    .optional()
    .describe('true = only test-mode documents; false = only real documents. Omit for both.'),
  overdue: z.boolean().optional().describe('true = only overdue receivables; false = only not overdue.'),
  dueFrom: isoDateInput.optional().describe('YYYY-MM-DD: due date on or after.'),
  dueTo: isoDateInput.optional().describe('YYYY-MM-DD: due date on or before.'),
  search: z.string().trim().max(100).optional().describe('Match on the document number.'),
})

export type ListInvoicesInput = z.infer<typeof listInvoicesInput>

export const listInvoicesTool = defineApiBackedAiTool<ListInvoicesInput, unknown, PagedListOutput>({
  name: 'billing.list_invoices',
  displayName: 'List billing invoices',
  description:
    'List billing documents, newest first. Returns { items, total, page, pageSize, totalPages }; each item carries ' +
    'id, number, document_type, status, test_run, bill_account_id, bill_account_name, bill_run_id, bill_date, ' +
    'period_start, period_end, issue_date, due_date, currency_code, subtotal_net, tax_total, total_gross, paid_total, ' +
    'credited_total, outstanding and days_overdue. Amounts are decimal strings in currency_code.',
  inputSchema: listInvoicesInput,
  requiredFeatures: [INVOICE_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/invoices',
      query: buildListQuery(input, {
        status: input.status,
        documentType: input.documentType,
        billAccountId: input.billAccountId,
        billRunId: input.billRunId,
        // The invoices route parses only the literal strings "true" / "false".
        testRun: input.testRun === undefined ? undefined : String(input.testRun),
        overdue: input.overdue === undefined ? undefined : String(input.overdue),
        dueFrom: input.dueFrom,
        dueTo: input.dueTo,
        search: input.search,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const getInvoiceInput = z.object({
  invoiceId: z.string().uuid().describe('Billing document id (UUID).'),
  includeParties: z
    .boolean()
    .optional()
    .describe('When true, also return the frozen buyer / seller snapshots (names, addresses, tax ids). Default false.'),
})

export type GetInvoiceInput = z.infer<typeof getInvoiceInput>

export type GetInvoiceOutput =
  | { found: false; invoiceId: string }
  | {
      found: true
      invoice: Record<string, unknown>
      lines: Array<Record<string, unknown>>
      allocations: Array<Record<string, unknown>>
      corrections: Array<Record<string, unknown>>
    }

const PARTY_FIELDS = ['buyer_snapshot', 'seller_snapshot'] as const

const GET_INVOICE = { name: 'billing.get_invoice', requiredFeatures: [INVOICE_VIEW_FEATURE] }

export const getInvoiceTool = defineAiTool<GetInvoiceInput, GetInvoiceOutput>({
  name: GET_INVOICE.name,
  displayName: 'Get billing invoice',
  description:
    'Fetch one billing document with its lines (description, quantity, unit_price_net, tax_rate, net / tax / gross ' +
    'amounts, service period, billing_type), allocations (payments and credit memos that settled it) and corrections ' +
    '(memos correcting it). Returns { found: false } when the document is missing or outside the caller scope.',
  inputSchema: getInvoiceInput,
  requiredFeatures: [...GET_INVOICE.requiredFeatures],
  tags: ['read', 'billing'],
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    const input = getInvoiceInput.parse(rawInput)
    const response = await runBillingOperation<Record<string, unknown>>(ctx, GET_INVOICE, {
      method: 'GET',
      path: `/billing/invoices/${input.invoiceId}`,
    })
    if (!response.success) {
      if (isNotFound(response)) return { found: false, invoiceId: input.invoiceId }
      throw new Error(failureMessage(response, `Failed to load billing invoice ${input.invoiceId}`))
    }
    const data = response.data ?? {}
    const rawInvoice = data.invoice
    if (!rawInvoice || typeof rawInvoice !== 'object') return { found: false, invoiceId: input.invoiceId }
    const invoice: Record<string, unknown> = { ...(rawInvoice as Record<string, unknown>) }
    delete invoice.metadata
    if (!input.includeParties) {
      for (const field of PARTY_FIELDS) delete invoice[field]
    }
    return {
      found: true,
      invoice,
      lines: asRecordArray(data.lines).map(({ metadata: _metadata, ...line }) => line),
      allocations: asRecordArray(data.allocations),
      corrections: asRecordArray(data.corrections),
    }
  },
})

export const invoicesAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listInvoicesTool),
  asBillingTool(getInvoiceTool),
]

export default invoicesAiTools
