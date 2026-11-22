/**
 * CPQ quote tools.
 *
 * Reads: `cpq.list_quotes`, `cpq.get_quote`.
 *
 * Mutations (`isMutation: true`): `cpq.create_quote`, `cpq.add_quote_line`,
 * `cpq.update_quote_line`, `cpq.submit_quote_for_approval`. The agent
 * runtime never calls a mutation handler directly from the model: it routes
 * the call through `prepareMutation`, stores a pending action with the
 * `loadBeforeRecord` snapshot, shows the operator a preview card, and only
 * runs the handler after the operator confirms. On confirm the runtime calls
 * `loadBeforeRecord` again and refuses with 412 when the quote fingerprint
 * (`quoteRecordVersion`) changed in the meantime.
 *
 * Every handler writes through the same REST route the UI uses, so mutation
 * guards (`runCpqMutationGuards`: approval rules, ARC checks), validation and
 * recalculation stay identical to a manual edit.
 *
 * Mutation tools that preview an existing quote read it through
 * `GET /api/cpq/quotes/:id`, so they require `cpq.quotes.view` in addition to
 * the write feature (the operation runner asserts the tool features cover
 * every route the tool calls).
 */
import { z } from 'zod'
import { CPQ_STATUSES, SUBMIT_FOR_APPROVAL_FROM_STATUSES, type CpqStatus } from '../services/types'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { BundleTreeNode } from '../services/cpqBundleService'
import { selectDefaultComponents } from '../lib/bundleDefaults'
import {
  compactQuery,
  configurationField,
  defineCpqApiTool,
  loadQuoteSnapshot,
  pageField,
  pageSizeField,
  quoteRecordVersion,
  toUsageEstimateInputs,
  responseRecord,
  runAsTool,
  seg,
  sortDirField,
  toPagedOutput,
  type CpqAiToolDefinition,
  type CpqPagedApiResponse,
} from './_shared'

const QUOTE_ENTITY = 'cpq:cpq_quote_configuration'
const QUOTE_LINE_ENTITY = 'cpq:cpq_quote_line_configuration'
/** A new quote has no row yet; its preview is anchored on the customer it is created for. */
const CUSTOMER_ENTITY = 'customers:customer_entity'

/* -------------------------------------------------------------------------- */
/*  cpq.list_quotes  ->  GET /api/cpq/quotes                                   */
/* -------------------------------------------------------------------------- */

export const listQuotesInput = z.object({
  customerId: z.string().uuid().optional().describe('Customer entity id (UUID) from the customers module.'),
  cpqStatus: z.enum(CPQ_STATUSES).optional().describe('CPQ quote status filter.'),
  currencyCode: z.string().trim().min(3).max(3).optional().describe('ISO 4217 currency filter.'),
  search: z.string().trim().optional().describe('Free-text match on the quote id or customer id.'),
  sortField: z.enum(['createdAt', 'updatedAt', 'cpqStatus', 'version', 'currencyCode']).optional().describe('Sort column (default createdAt).'),
  sortDir: sortDirField,
  page: pageField,
  pageSize: pageSizeField,
})
type ListQuotesInput = z.infer<typeof listQuotesInput>

const listQuotesTool = defineCpqApiTool<ListQuotesInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_quotes',
  displayName: 'List CPQ quotes',
  description:
    'List CPQ quotes with their quote number, customer, CPQ status, quote type (new / amend / renew / cancel), version and currency. Returns { items, total, page, pageSize, totalPages }. Use cpq.get_quote for lines and totals.',
  inputSchema: listQuotesInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/quotes',
    query: compactQuery({
      customerId: input.customerId,
      cpqStatus: input.cpqStatus,
      currencyCode: input.currencyCode?.toUpperCase(),
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
/*  cpq.get_quote  ->  GET /api/cpq/quotes/:quoteId                            */
/* -------------------------------------------------------------------------- */

const quoteIdField = z
  .string()
  .uuid()
  .describe('CPQ quote id or the linked sales quote id (UUID), as returned by cpq.list_quotes or cpq.create_quote.')

export const getQuoteInput = z.object({ quoteId: quoteIdField })
type GetQuoteInput = z.infer<typeof getQuoteInput>

const getQuoteTool = defineCpqApiTool<GetQuoteInput, Record<string, unknown>, { quote: Record<string, unknown> }>({
  name: 'cpq.get_quote',
  displayName: 'Get CPQ quote',
  description:
    'Fetch one CPQ quote with every line (offering, configuration, quantity, term, resolved charges, NRC / MRC totals, validation errors), the pricing summary (NRC / MRC totals, discounts, deal value) and the quote-level validation result. Returns { quote }.',
  inputSchema: getQuoteInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: `/cpq/quotes/${seg(input.quoteId)}`,
  }),
  mapResponse: (response) => ({ quote: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.create_quote  ->  POST /api/cpq/quotes (mutation)                      */
/* -------------------------------------------------------------------------- */

export const createQuoteInput = z
  .object({
    customerId: z.string().uuid().describe('Customer entity id (UUID) the quote is for. Look it up with the customers tools; never invent it.'),
    currencyCode: z.string().trim().min(3).max(3).optional().describe('ISO 4217 currency. Defaults to the tenant base currency.'),
    dealId: z.string().uuid().optional().describe('Optional CRM deal id (UUID) to link the quote to.'),
  })
  .strict()
type CreateQuoteInput = z.infer<typeof createQuoteInput>

let createQuoteTool: CpqAiToolDefinition
createQuoteTool = defineCpqApiTool<CreateQuoteInput, Record<string, unknown>, { quote: Record<string, unknown> }>({
  name: 'cpq.create_quote',
  displayName: 'Create CPQ quote',
  description:
    'Create a new draft CPQ quote (quote type "new", no lines yet) for a customer. Goes through the operator approval card before anything is saved. Returns { quote } with the new quote id and number. ARC quotes (amend / renew / cancel) are created from a subscription in the backoffice, not with this tool.',
  inputSchema: createQuoteInput,
  requiredFeatures: ['cpq.quotes.manage'],
  isMutation: true,
  loadBeforeRecord: async (rawInput) => {
    const input = createQuoteInput.parse(rawInput)
    const after: Record<string, unknown> = {
      quoteType: 'new',
      customerId: input.customerId,
      currencyCode: input.currencyCode?.toUpperCase() ?? '(tenant base currency)',
    }
    if (input.dealId) after.dealId = input.dealId
    return {
      recordId: input.customerId,
      entityType: CUSTOMER_ENTITY,
      recordVersion: null,
      before: { quoteType: null, customerId: null, currencyCode: null, ...(input.dealId ? { dealId: null } : {}) },
      after,
      display: {
        fieldLabels: { quoteType: 'Quote type', customerId: 'Customer', currencyCode: 'Currency', dealId: 'Deal' },
      },
    }
  },
  toOperation: (input) => {
    const body: Record<string, unknown> = { customerId: input.customerId, quoteType: 'new' }
    if (input.currencyCode) body.currencyCode = input.currencyCode.toUpperCase()
    if (input.dealId) body.dealId = input.dealId
    return { method: 'POST', path: '/cpq/quotes', body }
  },
  mapResponse: (response) => ({ quote: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.add_quote_line  ->  POST /api/cpq/quotes/:quoteId/items (mutation)     */
/* -------------------------------------------------------------------------- */

const lineTermFields = {
  quantity: z.number().int().min(1).max(100000).optional().describe('Line quantity (default 1).'),
  startDate: z.string().trim().optional().describe('Service start date, ISO 8601 (YYYY-MM-DD).'),
  termMonths: z.number().int().min(1).max(600).optional().describe('Contract term in months.'),
  endDate: z.string().trim().optional().describe('Service end date, ISO 8601 (YYYY-MM-DD).'),
}

export const addQuoteLineInput = z
  .object({
    quoteId: quoteIdField,
    offeringId: z.string().uuid().describe('CPQ offering id (UUID) to add.'),
    configuration: configurationField,
    ...lineTermFields,
    parentLineId: z.string().uuid().optional().describe('Existing line id this line is nested under (bundle child or add-on).'),
    expandBundleDefaults: z
      .boolean()
      .optional()
      .describe('For a bundle offering: also add its default components as child lines (nested bundles included). Set true when adding a bundle unless you will add its components yourself.'),
  })
  .strict()
type AddQuoteLineInput = z.infer<typeof addQuoteLineInput>

/** Lines the server will add for a bundle's defaults (recursive), or null when the tree cannot be read. */
async function countDefaultComponentLines(tool: CpqAiToolDefinition, ctx: McpToolContext, offeringId: string): Promise<number | null> {
  try {
    const response = await runAsTool<{ tree?: BundleTreeNode | null }>(tool, ctx, {
      method: 'GET',
      path: '/cpq/bundle-tree',
      query: { offeringId },
    })
    const tree = response.success ? response.data?.tree : null
    if (!tree) return null
    const count = (node: BundleTreeNode): number =>
      selectDefaultComponents(node).reduce((sum, child) => sum + 1 + (child.offeringType === 'bundle' ? count(child) : 0), 0)
    return tree.offeringType === 'bundle' ? count(tree) : 0
  } catch {
    return null
  }
}

async function previewAddLine(tool: CpqAiToolDefinition, rawInput: unknown, ctx: McpToolContext) {
  const input = addQuoteLineInput.parse(rawInput)
  const quote = await loadQuoteSnapshot(tool, ctx, input.quoteId)
  if (!quote) return null
  const lineCount = quote.lines?.length ?? 0
  // The approval card must not understate the change: bundle defaults add lines too.
  const defaultLines = input.expandBundleDefaults
    ? await countDefaultComponentLines(tool, ctx, input.offeringId)
    : 0
  return {
    recordId: quote.id,
    entityType: QUOTE_ENTITY,
    recordVersion: quoteRecordVersion(quote),
    before: { lineCount, newLine: null },
    after: {
      lineCount: lineCount + 1 + (defaultLines ?? 0),
      ...(input.expandBundleDefaults ? { defaultComponentLines: defaultLines ?? 'unknown' } : {}),
      newLine: {
        offeringId: input.offeringId,
        quantity: input.quantity ?? 1,
        configuration: input.configuration,
        ...(input.termMonths !== undefined ? { termMonths: input.termMonths } : {}),
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
        ...(input.parentLineId ? { parentLineId: input.parentLineId } : {}),
      },
    },
    display: { fieldLabels: { lineCount: 'Lines on quote', newLine: 'New line', defaultComponentLines: 'Default component lines' } },
  }
}

let addQuoteLineTool: CpqAiToolDefinition
addQuoteLineTool = defineCpqApiTool<AddQuoteLineInput, Record<string, unknown>, { quote: Record<string, unknown> }>({
  name: 'cpq.add_quote_line',
  displayName: 'Add CPQ quote line',
  description:
    'Add a configured offering as a new line on a CPQ quote. The server prices the line and recalculates the quote. For a bundle, pass expandBundleDefaults: true to also add its default components; a bundle whose required slots are empty stays incomplete (V-QBUN-1). Goes through the operator approval card before anything is saved. Returns { quote } after the change.',
  inputSchema: addQuoteLineInput,
  // cpq.offerings.view: the preview reads the bundle tree to count default lines.
  requiredFeatures: ['cpq.quotes.manage', 'cpq.quotes.view', 'cpq.offerings.view'],
  isMutation: true,
  loadBeforeRecord: (rawInput, ctx) => previewAddLine(addQuoteLineTool, rawInput, ctx),
  toOperation: (input) => {
    const body: Record<string, unknown> = {
      offeringId: input.offeringId,
      configuration: input.configuration,
      action: 'add',
    }
    if (input.quantity !== undefined) body.quantity = input.quantity
    if (input.startDate) body.startDate = input.startDate
    if (input.termMonths !== undefined) body.termMonths = input.termMonths
    if (input.endDate) body.endDate = input.endDate
    if (input.parentLineId) body.parentLineId = input.parentLineId
    if (input.expandBundleDefaults) body.expandBundleDefaults = true
    return { method: 'POST', path: `/cpq/quotes/${seg(input.quoteId)}/items`, body }
  },
  mapResponse: (response) => ({ quote: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.update_quote_line  ->  PUT /api/cpq/quotes/:quoteId/items/:lineId      */
/* -------------------------------------------------------------------------- */

export const updateQuoteLineInput = z
  .object({
    quoteId: quoteIdField,
    lineId: z.string().uuid().describe('Quote line id (UUID) from cpq.get_quote lines[].lineId.'),
    configuration: configurationField
      .optional()
      .describe('Attribute values to change, keyed by attribute code. Merged over the current line configuration; omit to keep it.'),
    ...lineTermFields,
  })
  .strict()
type UpdateQuoteLineInput = z.infer<typeof updateQuoteLineInput>

type LineSnapshot = {
  configuration: Record<string, unknown>
  quantity: number | null
  startDate: string | null
  termMonths: number | null
  endDate: string | null
  /** Carried over unchanged: the item PUT clears estimates that are not sent. */
  usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number }> | null
}

/**
 * Merges the requested patch over the current line, the way the PUT route
 * expects a full configuration. The server prefers an explicit `endDate` over
 * `startDate + termMonths`, so when the term or the start changes without a
 * new `endDate`, the stored end date is dropped and the server recomputes it.
 */
export function mergeLinePatch(current: LineSnapshot, input: UpdateQuoteLineInput): LineSnapshot {
  const termOrStartChanged = input.termMonths !== undefined || input.startDate !== undefined
  return {
    configuration: input.configuration ? { ...current.configuration, ...input.configuration } : current.configuration,
    quantity: input.quantity ?? current.quantity,
    startDate: input.startDate ?? current.startDate,
    termMonths: input.termMonths ?? current.termMonths,
    endDate: input.endDate ?? (termOrStartChanged ? null : current.endDate),
    usageEstimates: current.usageEstimates,
  }
}

async function loadLine(tool: CpqAiToolDefinition, ctx: McpToolContext, quoteId: string, lineId: string) {
  const quote = await loadQuoteSnapshot(tool, ctx, quoteId)
  if (!quote) return null
  const line = (quote.lines ?? []).find((entry) => entry.lineId === lineId)
  if (!line) return null
  const snapshot: LineSnapshot = {
    configuration: line.configuration ?? {},
    quantity: line.quantity ?? null,
    startDate: line.startDate ?? null,
    termMonths: line.termMonths ?? null,
    endDate: line.endDate ?? null,
    usageEstimates: toUsageEstimateInputs(line.usageEstimates),
  }
  return { quote, line, snapshot }
}

let updateQuoteLineTool: CpqAiToolDefinition
updateQuoteLineTool = defineCpqApiTool<UpdateQuoteLineInput, Record<string, unknown>, { quote: Record<string, unknown> }>({
  name: 'cpq.update_quote_line',
  displayName: 'Update CPQ quote line',
  description:
    'Change the configuration, quantity or term of an existing CPQ quote line. Configuration values are merged over the current ones. The server re-prices the line and recalculates the quote. Goes through the operator approval card before anything is saved. Returns { quote } after the change.',
  inputSchema: updateQuoteLineInput,
  requiredFeatures: ['cpq.quotes.manage', 'cpq.quotes.view'],
  isMutation: true,
  // Overwrites the existing line configuration, quantity and term.
  isDestructive: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = updateQuoteLineInput.parse(rawInput)
    const loaded = await loadLine(updateQuoteLineTool, ctx, input.quoteId, input.lineId)
    if (!loaded) return null
    return {
      recordId: input.lineId,
      entityType: QUOTE_LINE_ENTITY,
      recordVersion: quoteRecordVersion(loaded.quote),
      before: { ...loaded.snapshot },
      after: { ...mergeLinePatch(loaded.snapshot, input) },
      display: {
        fieldLabels: {
          configuration: 'Configuration',
          quantity: 'Quantity',
          startDate: 'Start date',
          termMonths: 'Term (months)',
          endDate: 'End date',
          usageEstimates: 'Usage estimates',
        },
      },
    }
  },
  toOperation: async (input, ctx) => {
    const loaded = await loadLine(updateQuoteLineTool, ctx, input.quoteId, input.lineId)
    if (!loaded) {
      throw new Error(`Quote line "${input.lineId}" was not found on quote "${input.quoteId}".`)
    }
    const merged = mergeLinePatch(loaded.snapshot, input)
    const body: Record<string, unknown> = { configuration: merged.configuration }
    if (merged.quantity !== null) body.quantity = merged.quantity
    if (merged.startDate) body.startDate = merged.startDate
    if (merged.termMonths !== null) body.termMonths = merged.termMonths
    if (merged.endDate) body.endDate = merged.endDate
    // The service recomputes usage totals from the request and stores null when
    // `usageEstimates` is absent, so the current estimates must be sent back.
    if (merged.usageEstimates) body.usageEstimates = merged.usageEstimates
    return {
      method: 'PUT',
      path: `/cpq/quotes/${seg(input.quoteId)}/items/${seg(input.lineId)}`,
      body,
    }
  },
  mapResponse: (response) => ({ quote: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.submit_quote_for_approval  ->  POST /api/cpq/quotes/:quoteId/status    */
/* -------------------------------------------------------------------------- */

export const submitQuoteForApprovalInput = z.object({ quoteId: quoteIdField }).strict()
type SubmitQuoteForApprovalInput = z.infer<typeof submitQuoteForApprovalInput>

let submitQuoteForApprovalTool: CpqAiToolDefinition
submitQuoteForApprovalTool = defineCpqApiTool<
  SubmitQuoteForApprovalInput,
  Record<string, unknown>,
  { quote: Record<string, unknown> }
>({
  name: 'cpq.submit_quote_for_approval',
  displayName: 'Submit CPQ quote for approval',
  description:
    'Move a CPQ quote to status "in_approval" so approvers can review it. Only valid from new, incomplete or ready. Project approval rules (mutation guards) still apply and may reject the change. Goes through the operator approval card first. Returns { quote } with its new status.',
  inputSchema: submitQuoteForApprovalInput,
  requiredFeatures: ['cpq.quotes.manage', 'cpq.quotes.view'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = submitQuoteForApprovalInput.parse(rawInput)
    const quote = await loadQuoteSnapshot(submitQuoteForApprovalTool, ctx, input.quoteId)
    if (!quote) return null
    return {
      recordId: quote.id,
      entityType: QUOTE_ENTITY,
      recordVersion: quoteRecordVersion(quote),
      before: { cpqStatus: quote.cpqStatus ?? null },
      after: { cpqStatus: 'in_approval' },
      display: { fieldLabels: { cpqStatus: 'Status' } },
    }
  },
  toOperation: async (input, ctx) => {
    const quote = await loadQuoteSnapshot(submitQuoteForApprovalTool, ctx, input.quoteId)
    if (!quote) throw new Error(`Quote "${input.quoteId}" was not found.`)
    if (!quote.cpqStatus || !SUBMIT_FOR_APPROVAL_FROM_STATUSES.includes(quote.cpqStatus as CpqStatus)) {
      throw new Error(
        `Quote "${input.quoteId}" is in status "${quote.cpqStatus ?? 'unknown'}"; only ${SUBMIT_FOR_APPROVAL_FROM_STATUSES.join(', ')} quotes can be submitted for approval.`,
      )
    }
    return {
      method: 'POST',
      path: `/cpq/quotes/${seg(input.quoteId)}/status`,
      body: { targetStatus: 'in_approval' },
    }
  },
  mapResponse: (response) => ({ quote: responseRecord(response) }),
})

export const quotesAiTools: CpqAiToolDefinition[] = [
  listQuotesTool,
  getQuoteTool,
  createQuoteTool,
  addQuoteLineTool,
  updateQuoteLineTool,
  submitQuoteForApprovalTool,
]

/** Names of the write tools (the ones gated by the approval card). */
export const CPQ_QUOTE_MUTATION_TOOL_NAMES: readonly string[] = quotesAiTools
  .filter((tool) => tool.isMutation === true)
  .map((tool) => tool.name)

export default quotesAiTools
