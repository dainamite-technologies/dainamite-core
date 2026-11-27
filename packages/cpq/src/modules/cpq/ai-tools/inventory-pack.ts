/**
 * CPQ customer inventory tools: subscriptions, assets, a customer's whole
 * installed base, the renewal triage list and the ARC change log.
 *
 * API-backed (see `_shared.ts`). Inventory rows are written by order
 * activation, never by these tools. The one write is
 * `cpq.change_subscription_status` (D6: pause / suspend / grace / resume /
 * terminate), which goes through the approval card.
 */
import { z } from 'zod'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  INVENTORY_BILLING_CYCLES,
  INVENTORY_SUBSCRIPTION_STATUSES,
  STATUS_CHARGE_BEHAVIORS,
  SUBSCRIPTION_STATUS_ACTIONS,
} from '../services/types'
import {
  compactQuery,
  defineCpqApiTool,
  runAsTool,
  pageField,
  pageSizeField,
  responseRecord,
  seg,
  sortDirField,
  toPagedOutput,
  type CpqAiToolDefinition,
  type CpqPagedApiResponse,
} from './_shared'

const subscriptionStatus = z.enum(INVENTORY_SUBSCRIPTION_STATUSES)
const billingCycle = z.enum(INVENTORY_BILLING_CYCLES)

/* -------------------------------------------------------------------------- */
/*  cpq.list_subscriptions  ->  GET /api/cpq/inventory/subscriptions           */
/* -------------------------------------------------------------------------- */

export const listSubscriptionsInput = z.object({
  customerId: z.string().uuid().optional().describe('Customer entity id (UUID) from the customers module.'),
  statuses: z.array(subscriptionStatus).max(INVENTORY_SUBSCRIPTION_STATUSES.length).optional().describe('Only subscriptions in one of these statuses.'),
  billingCycle: billingCycle.optional().describe('Billing cycle filter.'),
  sourceOrderId: z.string().uuid().optional().describe('Only subscriptions created by this CPQ order.'),
  expiringWithinDays: z.number().int().min(1).max(365).optional().describe('Only subscriptions whose current term ends within this many days.'),
  search: z.string().trim().optional().describe('Free-text match on subscription code or name.'),
  sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name', 'status', 'startDate', 'currentTermEnd']).optional().describe('Sort column (default createdAt).'),
  sortDir: sortDirField,
  page: pageField,
  pageSize: pageSizeField,
})
type ListSubscriptionsInput = z.infer<typeof listSubscriptionsInput>

const listSubscriptionsTool = defineCpqApiTool<ListSubscriptionsInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_subscriptions',
  displayName: 'List customer subscriptions',
  description:
    'List customer subscriptions (the commercial wrapper created when a CPQ order is activated: contract term, billing cycle, status). Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listSubscriptionsInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/inventory/subscriptions',
    query: compactQuery({
      customerId: input.customerId,
      status: input.statuses && input.statuses.length > 0 ? input.statuses.join(',') : undefined,
      billingCycle: input.billingCycle,
      sourceOrderId: input.sourceOrderId,
      expiringWithinDays: input.expiringWithinDays,
      search: input.search,
      sortField: input.sortField,
      sortDir: input.sortDir,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_subscription  ->  GET /api/cpq/inventory/subscriptions?id=         */
/* -------------------------------------------------------------------------- */

export const getSubscriptionInput = z.object({
  subscriptionId: z.string().uuid().describe('Subscription id (UUID).'),
})
type GetSubscriptionInput = z.infer<typeof getSubscriptionInput>

const getSubscriptionTool = defineCpqApiTool<GetSubscriptionInput, Record<string, unknown>, { subscription: Record<string, unknown> }>({
  name: 'cpq.get_subscription',
  displayName: 'Get customer subscription',
  description:
    'Fetch one subscription with its items (the services the customer pays for, with MRC / NRC) and linked assets. Returns { subscription }.',
  inputSchema: getSubscriptionInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/inventory/subscriptions',
    query: { id: input.subscriptionId },
  }),
  mapResponse: (response) => ({ subscription: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.list_assets  ->  GET /api/cpq/inventory/assets                         */
/* -------------------------------------------------------------------------- */

export const listAssetsInput = z.object({
  customerId: z.string().uuid().optional().describe('Customer entity id (UUID).'),
  subscriptionId: z.string().uuid().optional().describe('Only assets attached to this subscription.'),
  subscriptionItemId: z.string().uuid().optional().describe('Only assets attached to this subscription item.'),
  assetType: z.enum(['one_time', 'license', 'physical', 'logical']).optional().describe('Asset type filter.'),
  status: z.string().trim().optional().describe('Asset status filter, for example "active".'),
  search: z.string().trim().optional().describe('Free-text match on asset code, name or serial.'),
  page: pageField,
  pageSize: pageSizeField,
})
type ListAssetsInput = z.infer<typeof listAssetsInput>

const listAssetsTool = defineCpqApiTool<ListAssetsInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_assets',
  displayName: 'List customer assets',
  description:
    'List customer assets (hardware units, licenses, logical allocations, one-time items) from the installed base. Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listAssetsInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/inventory/assets',
    query: compactQuery({
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      subscriptionItemId: input.subscriptionItemId,
      assetType: input.assetType,
      status: input.status,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_asset  ->  GET /api/cpq/inventory/assets?id=                       */
/* -------------------------------------------------------------------------- */

export const getAssetInput = z.object({
  assetId: z.string().uuid().describe('Asset id (UUID).'),
})
type GetAssetInput = z.infer<typeof getAssetInput>

const getAssetTool = defineCpqApiTool<GetAssetInput, Record<string, unknown>, { asset: Record<string, unknown> }>({
  name: 'cpq.get_asset',
  displayName: 'Get customer asset',
  description: 'Fetch one customer asset with its status, type and subscription linkage. Returns { asset }.',
  inputSchema: getAssetInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/inventory/assets',
    query: { id: input.assetId },
  }),
  mapResponse: (response) => ({ asset: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_customer_inventory  ->  GET /api/cpq/inventory/customer/:id        */
/* -------------------------------------------------------------------------- */

export const getCustomerInventoryInput = z.object({
  customerId: z.string().uuid().describe('Customer entity id (UUID) from the customers module.'),
  status: z.string().trim().optional().describe('Optional status filter applied to subscriptions and assets.'),
  includeTerminated: z.boolean().optional().describe('When true, also include terminated subscriptions (default false).'),
})
type GetCustomerInventoryInput = z.infer<typeof getCustomerInventoryInput>

const getCustomerInventoryTool = defineCpqApiTool<GetCustomerInventoryInput, Record<string, unknown>, { customerId: string; inventory: Record<string, unknown> }>({
  name: 'cpq.get_customer_inventory',
  displayName: 'Get customer installed base',
  description:
    'Fetch the whole installed base of one customer in a single call: subscriptions with their items plus stand-alone assets. Returns { customerId, inventory }.',
  inputSchema: getCustomerInventoryInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: `/cpq/inventory/customer/${seg(input.customerId)}`,
    query: compactQuery({
      status: input.status,
      includeTerminated: input.includeTerminated,
    }),
  }),
  mapResponse: (response, input) => ({ customerId: input.customerId, inventory: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.list_expiring_subscriptions  ->  GET /api/cpq/inventory/subscriptions/expiring */
/* -------------------------------------------------------------------------- */

export const listExpiringSubscriptionsInput = z.object({
  withinDays: z.number().int().min(1).max(365).optional().describe('Look-ahead window in days (default 30).'),
  customerId: z.string().uuid().optional().describe('Only this customer.'),
  billingCycle: billingCycle.optional().describe('Billing cycle filter.'),
  status: subscriptionStatus.optional().describe('Subscription status (default active).'),
  page: pageField,
  pageSize: pageSizeField,
})
type ListExpiringSubscriptionsInput = z.infer<typeof listExpiringSubscriptionsInput>

const listExpiringSubscriptionsTool = defineCpqApiTool<
  ListExpiringSubscriptionsInput,
  CpqPagedApiResponse,
  ReturnType<typeof toPagedOutput>
>({
  name: 'cpq.list_expiring_subscriptions',
  displayName: 'List expiring subscriptions',
  description:
    'Renewal triage: list subscriptions whose current term ends within the next N days (default 30, active only). Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listExpiringSubscriptionsInput,
  requiredFeatures: ['cpq.inventory.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/inventory/subscriptions/expiring',
    query: compactQuery({
      withinDays: input.withinDays,
      customerId: input.customerId,
      billingCycle: input.billingCycle,
      status: input.status,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_subscription_change_log  ->  GET /api/cpq/inventory/subscriptions/:id/change-log */
/* -------------------------------------------------------------------------- */

export const getSubscriptionChangeLogInput = z.object({
  subscriptionId: z.string().uuid().describe('Subscription id (UUID).'),
  page: pageField,
  pageSize: pageSizeField,
})
type GetSubscriptionChangeLogInput = z.infer<typeof getSubscriptionChangeLogInput>

const getSubscriptionChangeLogTool = defineCpqApiTool<
  GetSubscriptionChangeLogInput,
  CpqPagedApiResponse,
  ReturnType<typeof toPagedOutput>
>({
  name: 'cpq.get_subscription_change_log',
  displayName: 'Get subscription change log',
  description:
    'List the amend / renew / cancel history of one subscription (which quote and order changed it, and how). Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: getSubscriptionChangeLogInput,
  requiredFeatures: ['cpq.arc.changelog.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: `/cpq/inventory/subscriptions/${seg(input.subscriptionId)}/change-log`,
    query: compactQuery({ page: input.page, pageSize: input.pageSize }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.change_subscription_status -> POST /api/cpq/inventory/subscriptions/actions */
/* -------------------------------------------------------------------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const changeSubscriptionStatusInput = z
  .object({
    subscriptionId: z.string().uuid().describe('Subscription id (UUID).'),
    subscriptionItemId: z.string().uuid().optional()
      .describe('One subscription item (UUID, from cpq.get_subscription items[].id). Omit to act on the whole subscription.'),
    action: z.enum(SUBSCRIPTION_STATUS_ACTIONS)
      .describe('pause (customer asked to stop), suspend (provider cut the service), grace (payment overdue, service on), resume (run again), terminate (end it).'),
    fromDate: isoDate.optional().describe('Effective date YYYY-MM-DD (default today). Resume: first day running again. Terminate: end date.'),
    toDate: isoDate.optional().describe('pause / suspend / grace only: inclusive last day YYYY-MM-DD. Omit for an open-ended stop.'),
    chargeBehavior: z.enum(STATUS_CHARGE_BEHAVIORS).optional()
      .describe('pause / suspend / grace only: charge or no_charge in billing. Default: pause → no_charge, suspend / grace → charge.'),
    reason: z.string().trim().max(500).optional().describe('Why the status changes (shown on the change log and billing credits).'),
  })
  .strict()
type ChangeSubscriptionStatusInput = z.infer<typeof changeSubscriptionStatusInput>

type SubscriptionSnapshot = {
  id?: string
  code?: string
  name?: string
  status?: string
  items?: Array<{ id?: string; name?: string; status?: string; children?: SubscriptionSnapshot['items'] }>
}

function findItem(items: SubscriptionSnapshot['items'], id: string): { name?: string; status?: string } | null {
  for (const item of items ?? []) {
    if (item.id === id) return item
    const nested = findItem(item.children, id)
    if (nested) return nested
  }
  return null
}

async function readSubscription(tool: CpqAiToolDefinition, ctx: McpToolContext, id: string): Promise<SubscriptionSnapshot | null> {
  try {
    const response = await runAsTool<SubscriptionSnapshot>(tool, ctx, { method: 'GET', path: '/cpq/inventory/subscriptions', query: { id } })
    return response.success && response.data && typeof response.data.id === 'string' ? response.data : null
  } catch {
    return null
  }
}

const ACTION_TARGET_LABEL: Record<ChangeSubscriptionStatusInput['action'], string> = {
  pause: 'paused',
  suspend: 'suspended',
  grace: 'grace',
  resume: 'active',
  terminate: 'terminated',
}

let changeSubscriptionStatusTool: CpqAiToolDefinition
changeSubscriptionStatusTool = defineCpqApiTool<ChangeSubscriptionStatusInput, Record<string, unknown>, Record<string, unknown>>({
  name: 'cpq.change_subscription_status',
  displayName: 'Change subscription status',
  description:
    'Pause, suspend, put in grace, resume or terminate a whole subscription or one of its items, with dates, the billing charge behaviour and a reason. Billing follows through the emitted event (no charge while paused by default; a terminate ends the billing items). Goes through the operator approval card before anything is saved. Returns { subscription, subscriptionItemIds, event }.',
  inputSchema: changeSubscriptionStatusInput,
  requiredFeatures: ['cpq.inventory.manage', 'cpq.inventory.view'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = changeSubscriptionStatusInput.parse(rawInput)
    const sub = await readSubscription(changeSubscriptionStatusTool, ctx, input.subscriptionId)
    if (!sub) return null
    const item = input.subscriptionItemId ? findItem(sub.items, input.subscriptionItemId) : null
    const target = item ? `${item.name ?? input.subscriptionItemId}` : `${sub.code ?? ''} ${sub.name ?? ''}`.trim()
    return {
      recordId: input.subscriptionId,
      entityType: 'cpq:cpq_inventory_subscription',
      recordVersion: null,
      before: { target, status: (item ? item.status : sub.status) ?? null, fromDate: null, toDate: null, chargeBehavior: null, reason: null },
      after: {
        target,
        status: ACTION_TARGET_LABEL[input.action],
        fromDate: input.fromDate ?? 'today',
        toDate: input.toDate ?? null,
        chargeBehavior: input.chargeBehavior ?? null,
        reason: input.reason ?? null,
      },
      display: {
        fieldLabels: { target: 'Subscription / item', status: 'Status', fromDate: 'From', toDate: 'To', chargeBehavior: 'Billing', reason: 'Reason' },
      },
    }
  },
  toOperation: (input) => ({
    method: 'POST',
    path: '/cpq/inventory/subscriptions/actions',
    body: {
      subscriptionId: input.subscriptionId,
      action: input.action,
      ...(input.subscriptionItemId ? { subscriptionItemId: input.subscriptionItemId } : {}),
      ...(input.fromDate ? { fromDate: input.fromDate } : {}),
      ...(input.toDate ? { toDate: input.toDate } : {}),
      ...(input.chargeBehavior ? { chargeBehavior: input.chargeBehavior } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  }),
  mapResponse: (response) => responseRecord(response),
})

export const inventoryAiTools: CpqAiToolDefinition[] = [
  listSubscriptionsTool,
  getSubscriptionTool,
  listAssetsTool,
  getAssetTool,
  getCustomerInventoryTool,
  listExpiringSubscriptionsTool,
  getSubscriptionChangeLogTool,
  changeSubscriptionStatusTool,
]

/** D6: the inventory write tools (approval card; on the quoting assistant). */
export const CPQ_INVENTORY_WRITE_TOOL_NAMES: readonly string[] = ['cpq.change_subscription_status']

export default inventoryAiTools
