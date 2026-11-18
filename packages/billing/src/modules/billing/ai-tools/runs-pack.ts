/**
 * Bill Run history: `billing.list_bill_runs`, `billing.get_bill_run`,
 * `billing.list_run_outcomes`.
 *
 * Read-only wrappers over `GET /api/billing/runs` (history list; the detail
 * page reads one run via `?id=`) and `GET /api/billing/run-outcomes`
 * (per-account outcome of a run, with one `cycles[]` entry per bill date).
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  BILL_RUN_MODES,
  BILL_RUN_OUTCOME_STATUSES,
  BILL_RUN_STATUSES,
  BILL_RUN_TRIGGERS,
} from '../data/validators'
import {
  asRecordArray,
  assertTenantScope,
  buildListQuery,
  failureMessage,
  isNotFound,
  isoDateInput,
  listPaginationInput,
  MAX_LIST_LIMIT,
  mapPagedList,
  runBillingOperation,
  type PagedListOutput,
} from './_shared'
import { asBillingTool, type BillingAiToolDefinition } from './types'

export const RUN_VIEW_FEATURE = 'billing.run.view'

const RUN_FIELDS_DESCRIPTION =
  'id, triggered_by (schedule / manual), parent_run_id (set on retries), dry_run, test_mode, scoped_account_ids, ' +
  'as_of_date, started_at, finished_at, status (running / completed / partial_failure / failed) and summary (counts ' +
  'and totals). Mode: dry_run=true is a dry run, test_mode=true a test run, both false a real run.'

const OUTCOME_FIELDS_DESCRIPTION =
  'id, billRunId, billAccountId, bill_account_name, status, errorMessage, warnings, draftInvoiceId, invoice_number, ' +
  'run_mode, run_as_of_date and cycles[] (one entry per bill date: bill_date, period_start, period_end, status ' +
  'invoiced / charged / previewed / empty / skipped_existing, line_count, total_net, invoice_id, invoice_number, ' +
  'total_debit, statement_id)'

export const listBillRunsInput = z.object({
  ...listPaginationInput,
  status: z.enum(BILL_RUN_STATUSES).optional().describe('Run status.'),
  mode: z.enum(BILL_RUN_MODES).optional().describe('real, test or dry.'),
  triggeredBy: z.enum(BILL_RUN_TRIGGERS).optional().describe('schedule (cron) or manual.'),
  parentRunId: z.string().uuid().optional().describe('Only retries of this run.'),
  asOfDateFrom: isoDateInput.optional().describe('YYYY-MM-DD: as-of date on or after.'),
  asOfDateTo: isoDateInput.optional().describe('YYYY-MM-DD: as-of date on or before.'),
})

export type ListBillRunsInput = z.infer<typeof listBillRunsInput>

export const listBillRunsTool = defineApiBackedAiTool<ListBillRunsInput, unknown, PagedListOutput>({
  name: 'billing.list_bill_runs',
  displayName: 'List Bill Runs',
  description:
    `List Bill Run history. Returns { items, total, page, pageSize, totalPages }; each item carries ${RUN_FIELDS_DESCRIPTION}`,
  inputSchema: listBillRunsInput,
  requiredFeatures: [RUN_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/runs',
      query: buildListQuery(input, {
        status: input.status,
        mode: input.mode,
        triggeredBy: input.triggeredBy,
        parentRunId: input.parentRunId,
        asOfDateFrom: input.asOfDateFrom,
        asOfDateTo: input.asOfDateTo,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const getBillRunInput = z.object({
  billRunId: z.string().uuid().describe('Bill Run id (UUID).'),
  outcomesLimit: z
    .number()
    .int()
    .min(0)
    .max(MAX_LIST_LIMIT)
    .optional()
    .describe(`How many per-account outcomes to include (default 25, max ${MAX_LIST_LIMIT}, 0 = none).`),
})

export type GetBillRunInput = z.infer<typeof getBillRunInput>

export type GetBillRunOutput =
  | { found: false; billRunId: string }
  | {
      found: true
      run: Record<string, unknown>
      outcomes: Array<Record<string, unknown>>
      outcomesTotal: number
    }

const GET_BILL_RUN = { name: 'billing.get_bill_run', requiredFeatures: [RUN_VIEW_FEATURE] }

export const getBillRunTool = defineAiTool<GetBillRunInput, GetBillRunOutput>({
  name: GET_BILL_RUN.name,
  displayName: 'Get Bill Run',
  description:
    `Fetch one Bill Run (${RUN_FIELDS_DESCRIPTION}) plus its first per-account outcomes (${OUTCOME_FIELDS_DESCRIPTION}). ` +
    'outcomesTotal is the full outcome count; page through billing.list_run_outcomes for more. Returns ' +
    '{ found: false } when the run is missing or outside the caller scope.',
  inputSchema: getBillRunInput,
  requiredFeatures: [...GET_BILL_RUN.requiredFeatures],
  tags: ['read', 'billing'],
  handler: async (rawInput, ctx) => {
    assertTenantScope(ctx)
    const input = getBillRunInput.parse(rawInput)
    const runResponse = await runBillingOperation(ctx, GET_BILL_RUN, {
      method: 'GET',
      path: '/billing/runs',
      query: { id: input.billRunId, page: 1, pageSize: 1 },
    })
    if (!runResponse.success) {
      if (isNotFound(runResponse)) return { found: false, billRunId: input.billRunId }
      throw new Error(failureMessage(runResponse, `Failed to load Bill Run ${input.billRunId}`))
    }
    const run = asRecordArray((runResponse.data as { items?: unknown } | undefined)?.items)[0]
    if (!run) return { found: false, billRunId: input.billRunId }

    const outcomesLimit = input.outcomesLimit ?? 25
    if (outcomesLimit === 0) return { found: true, run, outcomes: [], outcomesTotal: 0 }
    const outcomesResponse = await runBillingOperation(ctx, GET_BILL_RUN, {
      method: 'GET',
      path: '/billing/run-outcomes',
      query: { billRunId: input.billRunId, page: 1, pageSize: outcomesLimit },
    })
    if (!outcomesResponse.success) {
      throw new Error(failureMessage(outcomesResponse, `Failed to load outcomes of Bill Run ${input.billRunId}`))
    }
    const outcomes = mapPagedList(outcomesResponse, { limit: outcomesLimit, page: 1 })
    return { found: true, run, outcomes: outcomes.items, outcomesTotal: outcomes.total }
  },
})

export const listRunOutcomesInput = z.object({
  ...listPaginationInput,
  billRunId: z.string().uuid().optional().describe('Outcomes of one Bill Run.'),
  billAccountId: z.string().uuid().optional().describe('Outcomes of one billing account across runs.'),
  status: z.enum(BILL_RUN_OUTCOME_STATUSES).optional().describe('Outcome status, e.g. failed.'),
})

export type ListRunOutcomesInput = z.infer<typeof listRunOutcomesInput>

export const listRunOutcomesTool = defineApiBackedAiTool<ListRunOutcomesInput, unknown, PagedListOutput>({
  name: 'billing.list_run_outcomes',
  displayName: 'List Bill Run outcomes',
  description:
    'List per-account Bill Run outcomes (what each run did for each account). Returns { items, total, page, pageSize, ' +
    `totalPages }; each item carries ${OUTCOME_FIELDS_DESCRIPTION}.`,
  inputSchema: listRunOutcomesInput,
  requiredFeatures: [RUN_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/run-outcomes',
      query: buildListQuery(input, {
        billRunId: input.billRunId,
        billAccountId: input.billAccountId,
        status: input.status,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const runsAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listBillRunsTool),
  asBillingTool(getBillRunTool),
  asBillingTool(listRunOutcomesTool),
]

export default runsAiTools
