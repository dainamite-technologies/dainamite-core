/**
 * Line period, price phases and line status tools (2026-11-26 specs):
 *
 *   billing.list_item_status_periods   read   GET  /billing/items/status-periods
 *   billing.update_item_schedule       write  PUT  /billing/items (period + phases)
 *   billing.set_item_status            write  POST /billing/items/status-periods
 *   billing.end_item_status            write  PUT  /billing/items/status-periods (resume)
 *   billing.set_account_lines_status   write  POST /billing/items/status-periods/bulk
 *
 * Writes follow the billing mutation contract (`mutation-pack.ts`):
 * `isMutation` + `isDestructive`, a preview card from `loadBeforeRecord`, and
 * the handler refuses without `approvedPendingActionId`. Every call goes
 * through the REST route in-process, so RBAC, validation, the undoable
 * commands and the D6 rule (CPQ lines are read-only) apply unchanged.
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type { AiToolLoadBeforeSingleRecord } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { BILL_CYCLES } from '../data/validators'
import { billingEntityIds } from '../data/entityIds'
import { MAX_PHASES_PER_ITEM, PHASE_DURATION_UNITS, PHASE_PRICE_TYPES } from '../lib/pricePhases'
import { ITEM_STATUSES, STATUS_CHARGE_BEHAVIORS } from '../lib/itemStatusPeriods'
import {
  asRecordArray,
  assertApprovedMutation,
  assertTenantScope,
  buildListQuery,
  failureMessage,
  isoDateInput,
  listPaginationInput,
  mapPagedList,
  runBillingOperation,
  type PagedListOutput,
} from './_shared'
import { asBillingTool, type BillingAiToolDefinition, type BillingToolContext } from './types'

export const ITEM_VIEW_FEATURE = 'billing.item.view'
export const ITEM_MANAGE_FEATURE = 'billing.item.manage'

/* ------------------------------------------------------------------------ */
/*  billing.list_item_status_periods                                         */
/* ------------------------------------------------------------------------ */

export const listItemStatusPeriodsInput = z.object({
  ...listPaginationInput,
  billingItemId: z.string().uuid().optional().describe('Restrict to the status periods of one billing item.'),
  status: z.enum(ITEM_STATUSES).optional().describe('paused | suspended | grace.'),
})
export type ListItemStatusPeriodsInput = z.infer<typeof listItemStatusPeriodsInput>

export const listItemStatusPeriodsTool = defineApiBackedAiTool<ListItemStatusPeriodsInput, unknown, PagedListOutput>({
  name: 'billing.list_item_status_periods',
  displayName: 'List line status periods',
  description:
    'List dated line status periods (paused / suspended / grace) of billing items. Returns { items, total, page, ' +
    'pageSize, totalPages }; each item carries id, billing_item_id, status, from_date, to_date (null = open), ' +
    'charge_behavior (charge / no_charge), reason, applied_from / applied_to (days the Bill Run already left ' +
    'uncharged or credited). The status of an item is also on billing.list_items (statusPeriods).',
  inputSchema: listItemStatusPeriodsInput,
  requiredFeatures: [ITEM_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/items/status-periods',
      query: buildListQuery(input, { billingItemId: input.billingItemId, status: input.status }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

/* ------------------------------------------------------------------------ */
/*  shared                                                                   */
/* ------------------------------------------------------------------------ */

async function loadItem(ctx: BillingToolContext, toolName: string, id: string): Promise<Record<string, unknown> | null> {
  const response = await runBillingOperation<{ items?: unknown }>(
    ctx,
    { name: toolName, requiredFeatures: [ITEM_VIEW_FEATURE, ITEM_MANAGE_FEATURE] },
    { method: 'GET', path: '/billing/items', query: { id, page: 1, pageSize: 1 } },
  )
  if (!response.success) return null
  return asRecordArray(response.data?.items)[0] ?? null
}

function scheduleView(row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) return {}
  return {
    description: row.description ?? null,
    billingPeriod: row.billing_period_unit ? `every ${row.billing_period_interval ?? 1} ${row.billing_period_unit}` : 'same as account',
    phasesEnabled: Boolean(row.phases_enabled ?? row.phasesEnabled),
    phases: Array.isArray(row.phases) ? row.phases : [],
  }
}

/* ------------------------------------------------------------------------ */
/*  billing.update_item_schedule                                             */
/* ------------------------------------------------------------------------ */

const phaseInput = z
  .object({
    name: z.string().trim().max(120).optional().describe('Printed on the invoice line, e.g. "Free trial", "Promo 50%", "Year 1".'),
    durationUnit: z.enum(PHASE_DURATION_UNITS).optional().describe('day | week | month | year — with durationCount.'),
    durationCount: z.number().int().min(1).optional().describe('How many durationUnit the phase lasts.'),
    endDate: isoDateInput.optional().describe('YYYY-MM-DD inclusive last day — instead of a duration.'),
    priceType: z.enum(PHASE_PRICE_TYPES).describe('free | fixed (price per billing period) | percent_off (0–100) | amount_off.'),
    value: z.number().finite().nonnegative().optional().describe('The fixed price, the percentage or the amount off. Omit for free.'),
  })
  .strict()

export const updateItemScheduleInput = z
  .object({
    id: z.string().uuid().describe('Billing item id (a recurring item).'),
    billingPeriodUnit: z
      .enum(BILL_CYCLES)
      .nullable()
      .optional()
      .describe("Own billing period unit (daily | weekly | monthly | annually); null = follow the account's cycle."),
    billingPeriodInterval: z.number().int().min(1).nullable().optional().describe('Every N units, with billingPeriodUnit.'),
    phasesEnabled: z.boolean().optional().describe('The "price changes over time" switch.'),
    phases: z
      .array(phaseInput)
      .max(MAX_PHASES_PER_ITEM)
      .optional()
      .describe('Replaces the whole phase schedule. Phases run back to back from the item start; then the regular price.'),
  })
  .strict()
export type UpdateItemScheduleInput = z.infer<typeof updateItemScheduleInput>

const UPDATE_SCHEDULE = { name: 'billing.update_item_schedule', requiredFeatures: [ITEM_MANAGE_FEATURE, ITEM_VIEW_FEATURE] }

function scheduleBody(input: UpdateItemScheduleInput): Record<string, unknown> {
  const body: Record<string, unknown> = { id: input.id }
  if (input.billingPeriodUnit !== undefined) body.billingPeriodUnit = input.billingPeriodUnit
  if (input.billingPeriodInterval !== undefined) body.billingPeriodInterval = input.billingPeriodInterval
  if (input.phasesEnabled !== undefined) body.phasesEnabled = input.phasesEnabled
  if (input.phases !== undefined) body.phases = input.phases
  return body
}

export const updateItemScheduleTool = defineAiTool<UpdateItemScheduleInput, { ok: boolean; id: string }>({
  name: UPDATE_SCHEDULE.name,
  displayName: 'Update item billing period / price phases',
  description:
    'Set a recurring billing item\'s own billing period (e.g. every 1 year on a monthly account) and/or its price phases ' +
    '(free trial, promotion, ramp). Only periods not yet invoiced can change: the route refuses with ' +
    'billing.item.phase_edit_billed when invoiced days would be re-priced (correct those with a credit memo), and ' +
    'billing.item.billing_period_change_billed when the billing period changes after the item was first invoiced (end ' +
    'it and add a new item instead). Requires ' +
    'the operator to approve the preview card. Returns { ok, id }; read the result back with billing.list_items.',
  inputSchema: updateItemScheduleInput,
  requiredFeatures: [...UPDATE_SCHEDULE.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = updateItemScheduleInput.parse(rawInput)
    const before = await loadItem(ctx, UPDATE_SCHEDULE.name, input.id)
    return {
      recordId: input.id,
      entityType: billingEntityIds.item,
      recordVersion: typeof before?.updated_at === 'string' ? before.updated_at : null,
      before: scheduleView(before),
      after: { ...scheduleView(before), ...scheduleBody(input) },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, UPDATE_SCHEDULE.name)
    const input = updateItemScheduleInput.parse(rawInput)
    const response = await runBillingOperation(ctx, UPDATE_SCHEDULE, { method: 'PUT', path: '/billing/items', body: scheduleBody(input) })
    if (!response.success) throw new Error(failureMessage(response, 'Failed to update the item schedule'))
    return { ok: true, id: input.id }
  },
})

/* ------------------------------------------------------------------------ */
/*  billing.set_item_status                                                  */
/* ------------------------------------------------------------------------ */

const statusFields = {
  status: z.enum(ITEM_STATUSES).describe('paused (no charge by default) | suspended (keeps charging by default) | grace (flag only).'),
  fromDate: isoDateInput.describe('YYYY-MM-DD first day of the status.'),
  toDate: isoDateInput.nullable().optional().describe('YYYY-MM-DD last day; omit / null = open-ended (resume later).'),
  chargeBehavior: z.enum(STATUS_CHARGE_BEHAVIORS).optional().describe('Override the default billing effect: charge | no_charge.'),
  reason: z.string().trim().max(500).optional().describe('Shown on a credit line when already-billed days are credited.'),
}

export const setItemStatusInput = z
  .object({ billingItemId: z.string().uuid().describe('Billing item id.'), ...statusFields })
  .strict()
export type SetItemStatusInput = z.infer<typeof setItemStatusInput>

const SET_STATUS = { name: 'billing.set_item_status', requiredFeatures: [ITEM_MANAGE_FEATURE, ITEM_VIEW_FEATURE] }

export const setItemStatusTool = defineAiTool<SetItemStatusInput, { id: string | null }>({
  name: SET_STATUS.name,
  displayName: 'Pause / suspend a billing line',
  description:
    'Put one billing line in a dated status: paused, suspended or grace period. Paused days are not charged (prorated); ' +
    'already-billed paused days are credited on the next Bill Run. Refused for CPQ lines (status comes from the CPQ ' +
    'subscription) and for overlapping periods. Requires the operator to approve the preview card. Returns { id }.',
  inputSchema: setItemStatusInput,
  requiredFeatures: [...SET_STATUS.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = setItemStatusInput.parse(rawInput)
    const item = await loadItem(ctx, SET_STATUS.name, input.billingItemId)
    return {
      recordId: 'new-status-period',
      entityType: billingEntityIds.itemStatusPeriod,
      recordVersion: null,
      before: { item: item?.description ?? input.billingItemId, statusPeriods: item?.statusPeriods ?? [] },
      after: { ...input, toDate: input.toDate ?? null },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, SET_STATUS.name)
    const input = setItemStatusInput.parse(rawInput)
    const response = await runBillingOperation<{ id?: string | null }>(ctx, SET_STATUS, {
      method: 'POST',
      path: '/billing/items/status-periods',
      body: { ...input },
    })
    if (!response.success) throw new Error(failureMessage(response, 'Failed to set the line status'))
    return { id: response.data?.id ?? null }
  },
})

/* ------------------------------------------------------------------------ */
/*  billing.end_item_status (resume)                                         */
/* ------------------------------------------------------------------------ */

export const endItemStatusInput = z
  .object({
    id: z.string().uuid().describe('Status period id (from billing.list_item_status_periods).'),
    toDate: isoDateInput.describe('YYYY-MM-DD last day of the status; the line runs again the next day.'),
  })
  .strict()
export type EndItemStatusInput = z.infer<typeof endItemStatusInput>

const END_STATUS = { name: 'billing.end_item_status', requiredFeatures: [ITEM_MANAGE_FEATURE, ITEM_VIEW_FEATURE] }

export const endItemStatusTool = defineAiTool<EndItemStatusInput, { ok: boolean; id: string }>({
  name: END_STATUS.name,
  displayName: 'Resume a billing line',
  description:
    'Resume a paused / suspended line: set the last day of its status period. Days the Bill Run left uncharged after ' +
    'that day are charged on the next run. Requires the operator to approve the preview card. Returns { ok, id }.',
  inputSchema: endItemStatusInput,
  requiredFeatures: [...END_STATUS.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = endItemStatusInput.parse(rawInput)
    const response = await runBillingOperation<{ items?: unknown }>(ctx, END_STATUS, {
      method: 'GET',
      path: '/billing/items/status-periods',
      query: { id: input.id, page: 1, pageSize: 1 },
    })
    const row = response.success ? (asRecordArray(response.data?.items)[0] ?? null) : null
    return {
      recordId: input.id,
      entityType: billingEntityIds.itemStatusPeriod,
      recordVersion: typeof row?.updated_at === 'string' ? row.updated_at : null,
      before: { status: row?.status ?? null, fromDate: row?.from_date ?? null, toDate: row?.to_date ?? null },
      after: { status: row?.status ?? null, fromDate: row?.from_date ?? null, toDate: input.toDate },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, END_STATUS.name)
    const input = endItemStatusInput.parse(rawInput)
    const response = await runBillingOperation(ctx, END_STATUS, {
      method: 'PUT',
      path: '/billing/items/status-periods',
      body: { id: input.id, toDate: input.toDate },
    })
    if (!response.success) throw new Error(failureMessage(response, 'Failed to resume the line'))
    return { ok: true, id: input.id }
  },
})

/* ------------------------------------------------------------------------ */
/*  billing.set_account_lines_status (bulk)                                  */
/* ------------------------------------------------------------------------ */

export const setAccountLinesStatusInput = z
  .object({ billAccountId: z.string().uuid().describe('Billing account whose lines get the status.'), ...statusFields })
  .strict()
export type SetAccountLinesStatusInput = z.infer<typeof setAccountLinesStatusInput>

const BULK_STATUS = { name: 'billing.set_account_lines_status', requiredFeatures: [ITEM_MANAGE_FEATURE] }

export type BulkStatusOutput = { created: number; skipped: Array<{ billingItemId: string; reason: string }> }

export const setAccountLinesStatusTool = defineAiTool<SetAccountLinesStatusInput, BulkStatusOutput>({
  name: BULK_STATUS.name,
  displayName: 'Pause / suspend every line of an account',
  description:
    'Set the same dated status (paused / suspended / grace) on every active line of a billing account, e.g. suspend a ' +
    'customer for non-payment. CPQ lines, lines with an overlapping status and lines ended before fromDate are skipped ' +
    'and reported. Requires the operator to approve the preview card. Returns { created, skipped[] }.',
  inputSchema: setAccountLinesStatusInput,
  requiredFeatures: [...BULK_STATUS.requiredFeatures],
  tags: ['write', 'billing'],
  isMutation: true,
  isDestructive: true,
  loadBeforeRecord: async (rawInput): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = setAccountLinesStatusInput.parse(rawInput)
    return {
      recordId: input.billAccountId,
      entityType: billingEntityIds.account,
      recordVersion: null,
      before: {},
      after: { ...input, toDate: input.toDate ?? null, scope: 'every active line of the account' },
    }
  },
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    assertApprovedMutation(ctx, BULK_STATUS.name)
    const input = setAccountLinesStatusInput.parse(rawInput)
    const response = await runBillingOperation<{ created?: unknown[]; skipped?: Array<{ billingItemId: string; reason: string }> }>(
      ctx,
      BULK_STATUS,
      { method: 'POST', path: '/billing/items/status-periods/bulk', body: { ...input } },
    )
    if (!response.success) throw new Error(failureMessage(response, 'Failed to set the status on the account lines'))
    return { created: response.data?.created?.length ?? 0, skipped: response.data?.skipped ?? [] }
  },
})

export const itemScheduleAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listItemStatusPeriodsTool),
  asBillingTool(updateItemScheduleTool),
  asBillingTool(setItemStatusTool),
  asBillingTool(endItemStatusTool),
  asBillingTool(setAccountLinesStatusTool),
]

export default itemScheduleAiTools
