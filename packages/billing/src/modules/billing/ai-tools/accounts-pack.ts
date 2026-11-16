/**
 * `billing.list_accounts` + `billing.get_account`.
 *
 * Read-only wrappers over `GET /api/billing/accounts` (CRUD list, also used
 * with `?id=` by the account detail page) and
 * `GET /api/billing/accounts/:id/summary` (receivables + prepaid balance
 * summary shown on the account workspace).
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  BILL_CYCLES,
  BILLING_MODES,
  CUSTOMER_KINDS,
} from '../data/validators'
import {
  asRecordArray,
  assertTenantScope,
  buildListQuery,
  failureMessage,
  isNotFound,
  listPaginationInput,
  mapPagedList,
  runBillingOperation,
  type PagedListOutput,
} from './_shared'
import { asBillingTool, type BillingAiToolDefinition } from './types'

export const ACCOUNT_VIEW_FEATURE = 'billing.account.view'

export const listAccountsInput = z.object({
  ...listPaginationInput,
  search: z.string().trim().max(200).optional().describe('Free-text match on the account name.'),
  customerId: z.string().trim().optional().describe('Restrict to accounts of this customer (CRM person or company id).'),
  customerKind: z.enum(CUSTOMER_KINDS).optional().describe('Customer type: company or person.'),
  currencyCode: z.string().trim().length(3).optional().describe('ISO 4217 currency code, e.g. EUR.'),
  billCycle: z.enum(BILL_CYCLES).optional().describe('Billing cycle of the account.'),
  billingMode: z
    .enum(BILLING_MODES)
    .optional()
    .describe('postpaid = invoiced after the fact; prepaid = charges debited from a balance.'),
  activeOnly: z.boolean().optional().describe('When true, only active accounts. Omit to include inactive ones.'),
  hasOverdue: z.boolean().optional().describe('When true, only accounts with at least one overdue invoice.'),
})

export type ListAccountsInput = z.infer<typeof listAccountsInput>

export const listAccountsTool = defineApiBackedAiTool<ListAccountsInput, unknown, PagedListOutput>({
  name: 'billing.list_accounts',
  displayName: 'List billing accounts',
  description:
    'List billing accounts (who is billed, in which currency, on which cycle). Returns { items, total, page, pageSize, totalPages }; ' +
    'each item carries id, name, customer_id, customer_kind, currency_code, bill_cycle, billing_mode, next_bill_date, ' +
    'last_bill_date, credit_limit, payment_terms_days, is_active. Balances are not included: use billing.get_account.',
  inputSchema: listAccountsInput,
  requiredFeatures: [ACCOUNT_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/accounts',
      query: buildListQuery(input, {
        search: input.search,
        customerId: input.customerId,
        customerKind: input.customerKind,
        currencyCode: input.currencyCode?.toUpperCase(),
        billCycle: input.billCycle,
        billingMode: input.billingMode,
        // The route coerces the query string with z.coerce.boolean, which reads
        // "false" as true: only the positive filter is safe to send.
        isActive: input.activeOnly === true ? 'true' : undefined,
        hasOverdue: input.hasOverdue === undefined ? undefined : String(input.hasOverdue),
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const getAccountInput = z.object({
  accountId: z.string().uuid().describe('Billing account id (UUID).'),
})

export type GetAccountInput = z.infer<typeof getAccountInput>

export type GetAccountOutput =
  | { found: false; accountId: string }
  | { found: true; account: Record<string, unknown>; summary: Record<string, unknown> | null }

const GET_ACCOUNT = { name: 'billing.get_account', requiredFeatures: [ACCOUNT_VIEW_FEATURE] }

export const getAccountTool = defineAiTool<GetAccountInput, GetAccountOutput>({
  name: GET_ACCOUNT.name,
  displayName: 'Get billing account',
  description:
    'Fetch one billing account with its receivables summary: open / overdue amounts, last invoice, bill cycle and ' +
    'next bill date, and for prepaid accounts the current balance, balance status (ok / low / exhausted), credit ' +
    'limit and last statement. Returns { found: false } when the account is missing or outside the caller scope.',
  inputSchema: getAccountInput,
  requiredFeatures: [ACCOUNT_VIEW_FEATURE],
  tags: ['read', 'billing'],
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    const input = getAccountInput.parse(rawInput)
    const listResponse = await runBillingOperation(ctx, GET_ACCOUNT, {
      method: 'GET',
      path: '/billing/accounts',
      query: { id: input.accountId, page: 1, pageSize: 1 },
    })
    if (!listResponse.success) {
      if (isNotFound(listResponse)) return { found: false, accountId: input.accountId }
      throw new Error(failureMessage(listResponse, `Failed to load billing account ${input.accountId}`))
    }
    const account = asRecordArray((listResponse.data as { items?: unknown } | undefined)?.items)[0]
    if (!account) return { found: false, accountId: input.accountId }

    const summaryResponse = await runBillingOperation<Record<string, unknown>>(ctx, GET_ACCOUNT, {
      method: 'GET',
      path: `/billing/accounts/${input.accountId}/summary`,
    })
    if (!summaryResponse.success && !isNotFound(summaryResponse)) {
      throw new Error(failureMessage(summaryResponse, `Failed to load summary of billing account ${input.accountId}`))
    }
    return {
      found: true,
      account,
      summary: summaryResponse.success ? (summaryResponse.data ?? null) : null,
    }
  },
})

export const accountsAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listAccountsTool),
  asBillingTool(getAccountTool),
]

export default accountsAiTools
