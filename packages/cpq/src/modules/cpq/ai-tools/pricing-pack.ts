/**
 * CPQ pricing tools: the calculate-price API (manuals/xd-187-calculate-price-api.md),
 * relationship validation of an offering combination, and price-rule lookup.
 *
 * `cpq.calculate_price` and `cpq.validate_configuration` call POST routes,
 * but both are pure computations that persist nothing, so the tools are not
 * mutations (`isMutation` stays unset and MCP advertises `readOnlyHint`).
 */
import { z } from 'zod'
import {
  compactQuery,
  configurationField,
  defineCpqApiTool,
  pageField,
  pageSizeField,
  toPagedOutput,
  type CpqAiToolDefinition,
  type CpqPagedApiResponse,
} from './_shared'

/* -------------------------------------------------------------------------- */
/*  cpq.calculate_price  ->  POST /api/cpq/quotes/price                        */
/* -------------------------------------------------------------------------- */

const priceItemInput = z.object({
  offeringId: z.string().uuid().describe('CPQ offering id (UUID) to price.'),
  configuration: configurationField,
})

export const calculatePriceInput = z.object({
  primaryItem: priceItemInput
    .optional()
    .describe('Main offering being configured. Omit only when pricing stand-alone child items.'),
  childItems: z
    .array(priceItemInput)
    .max(50)
    .optional()
    .describe('Additional offerings priced in the same call, for example bundle components or add-ons.'),
  currencyCode: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .optional()
    .describe('ISO 4217 currency, for example "EUR". Defaults to the tenant base currency.'),
  includeWaterfall: z
    .boolean()
    .optional()
    .describe('When true, every charge also carries list and standard prices so the discount path is visible.'),
})
type CalculatePriceInput = z.infer<typeof calculatePriceInput>

type CalculatePriceApi = {
  primaryCharges?: unknown[]
  childItems?: unknown[]
  totals?: { nrcTotal?: number; mrcTotal?: number; usageCharges?: unknown[] }
  currencyCode?: string
}

type CalculatePriceOutput = {
  currencyCode: string | null
  totals: { nrcTotal: number; mrcTotal: number; usageCharges: unknown[] }
  primaryCharges: unknown[]
  childItems: unknown[]
}

const calculatePriceTool = defineCpqApiTool<CalculatePriceInput, CalculatePriceApi, CalculatePriceOutput>({
  name: 'cpq.calculate_price',
  displayName: 'Calculate CPQ price',
  description:
    'Calculate the price of one or more configured offerings without saving anything: resolves pricing tables, tiers and active price rules. Returns { currencyCode, totals: { nrcTotal, mrcTotal, usageCharges }, primaryCharges, childItems } where each charge carries unitPrice, quantity, totalPrice and the applied rule adjustments. This is the only source of truth for prices; never estimate a price yourself.',
  inputSchema: calculatePriceInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => {
    const body: Record<string, unknown> = {
      childItems: (input.childItems ?? []).map((item) => ({
        offeringId: item.offeringId,
        configuration: item.configuration,
      })),
    }
    if (input.primaryItem) {
      body.primaryItem = {
        offeringId: input.primaryItem.offeringId,
        configuration: input.primaryItem.configuration,
      }
    }
    if (input.currencyCode) body.currencyCode = input.currencyCode.toUpperCase()
    if (input.includeWaterfall !== undefined) body.includeWaterfall = input.includeWaterfall
    return { method: 'POST', path: '/cpq/quotes/price', body }
  },
  mapResponse: (response) => {
    const data = response.data ?? {}
    return {
      currencyCode: typeof data.currencyCode === 'string' ? data.currencyCode : null,
      totals: {
        nrcTotal: typeof data.totals?.nrcTotal === 'number' ? data.totals.nrcTotal : 0,
        mrcTotal: typeof data.totals?.mrcTotal === 'number' ? data.totals.mrcTotal : 0,
        usageCharges: Array.isArray(data.totals?.usageCharges) ? data.totals!.usageCharges! : [],
      },
      primaryCharges: Array.isArray(data.primaryCharges) ? data.primaryCharges : [],
      childItems: Array.isArray(data.childItems) ? data.childItems : [],
    }
  },
})

/* -------------------------------------------------------------------------- */
/*  cpq.validate_configuration  ->  POST /api/cpq/quotes/validate-relationships */
/* -------------------------------------------------------------------------- */

export const validateConfigurationInput = z.object({
  offeringIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .describe('Every offering that would be on the quote together (UUIDs).'),
  parentChildPairs: z
    .array(
      z.object({
        parentOfferingId: z.string().uuid().describe('Offering acting as the parent line.'),
        childOfferingId: z.string().uuid().describe('Offering nested under that parent.'),
      }),
    )
    .max(100)
    .optional()
    .describe('Optional parent/child nesting between the listed offerings.'),
})
type ValidateConfigurationInput = z.infer<typeof validateConfigurationInput>

type ValidateConfigurationApi = { valid?: boolean; errors?: unknown[]; allowedChildSpecs?: unknown[] }

const validateConfigurationTool = defineCpqApiTool<
  ValidateConfigurationInput,
  ValidateConfigurationApi,
  { valid: boolean; errors: unknown[]; allowedChildSpecs: unknown[] }
>({
  name: 'cpq.validate_configuration',
  displayName: 'Validate CPQ offering combination',
  description:
    'Check a set of offerings against the product relationship rules (requires, excludes, parent-child cardinality) without saving. Returns { valid, errors, allowedChildSpecs }. Per-line attribute validation of a saved quote is reported by cpq.get_quote in validationResult and per line in validationErrors.',
  inputSchema: validateConfigurationInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => {
    const body: Record<string, unknown> = { offeringIds: input.offeringIds }
    if (input.parentChildPairs && input.parentChildPairs.length > 0) body.parentChildPairs = input.parentChildPairs
    return { method: 'POST', path: '/cpq/quotes/validate-relationships', body }
  },
  mapResponse: (response) => {
    const errors = Array.isArray(response.data?.errors) ? response.data!.errors! : []
    return {
      valid: typeof response.data?.valid === 'boolean' ? response.data.valid : errors.length === 0,
      errors,
      allowedChildSpecs: Array.isArray(response.data?.allowedChildSpecs) ? response.data!.allowedChildSpecs! : [],
    }
  },
})

/* -------------------------------------------------------------------------- */
/*  cpq.list_price_rules  ->  GET /api/cpq/price-rules                         */
/* -------------------------------------------------------------------------- */

export const listPriceRulesInput = z.object({
  search: z.string().trim().optional().describe('Free-text match on rule code, name or description.'),
  offeringId: z.string().uuid().optional().describe('Only rules scoped to this offering.'),
  globalOnly: z.boolean().optional().describe('When true (and offeringId is omitted), only rules that apply to every offering.'),
  ruleType: z
    .enum(['discount_percent', 'discount_absolute', 'surcharge_percent', 'surcharge_absolute', 'price_override'])
    .optional()
    .describe('Restrict to one rule type.'),
  isActive: z.boolean().optional().describe('Filter on the active flag.'),
  page: pageField,
  pageSize: pageSizeField,
})
type ListPriceRulesInput = z.infer<typeof listPriceRulesInput>

const listPriceRulesTool = defineCpqApiTool<ListPriceRulesInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_price_rules',
  displayName: 'List CPQ price rules',
  description:
    'List price rules (discounts, surcharges, overrides) with their scope, value, charge filters and applicability condition. Explains why cpq.calculate_price applied an adjustment. Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listPriceRulesInput,
  requiredFeatures: ['cpq.pricing.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/price-rules',
    query: compactQuery({
      search: input.search,
      productOfferingId: input.offeringId,
      globalOnly: input.globalOnly,
      ruleType: input.ruleType,
      isActive: input.isActive,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

export const pricingAiTools: CpqAiToolDefinition[] = [
  calculatePriceTool,
  validateConfigurationTool,
  listPriceRulesTool,
]

export default pricingAiTools
