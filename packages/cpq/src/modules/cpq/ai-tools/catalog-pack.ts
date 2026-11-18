/**
 * CPQ product catalog tools: offerings, specifications, bundles and the
 * run-time attributes an operator fills in when configuring an offering.
 *
 * All read-only and API-backed (see `_shared.ts`).
 */
import { z } from 'zod'
import {
  compactQuery,
  configurationField,
  defineCpqApiTool,
  pageField,
  pageSizeField,
  responseRecord,
  sortDirField,
  toPagedOutput,
  type CpqAiToolDefinition,
  type CpqPagedApiResponse,
} from './_shared'

/* -------------------------------------------------------------------------- */
/*  cpq.list_offerings  ->  GET /api/cpq/product-offerings                     */
/* -------------------------------------------------------------------------- */

export const listOfferingsInput = z.object({
  search: z.string().trim().optional().describe('Free-text match on offering code, name or description. Omit to list all.'),
  specId: z.string().uuid().optional().describe('Only offerings of this product specification.'),
  offeringType: z.enum(['simple', 'bundle']).optional().describe('Restrict to simple or bundle offerings.'),
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated']).optional().describe('Lifecycle status filter.'),
  isActive: z.boolean().optional().describe('Filter on the active flag.'),
  sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name', 'lifecycleStatus', 'offeringType']).optional().describe('Sort column (default createdAt).'),
  sortDir: sortDirField,
  page: pageField,
  pageSize: pageSizeField,
})
type ListOfferingsInput = z.infer<typeof listOfferingsInput>

const listOfferingsTool = defineCpqApiTool<ListOfferingsInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_offerings',
  displayName: 'List CPQ offerings',
  description:
    'List sellable CPQ product offerings (what goes on a quote line) with their charges (NRC / MRC / usage definitions, not resolved prices). Returns { items, total, page, pageSize, totalPages }. Use cpq.calculate_price to get actual prices.',
  inputSchema: listOfferingsInput,
  requiredFeatures: ['cpq.offerings.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/product-offerings',
    query: compactQuery({
      search: input.search,
      specId: input.specId,
      offeringType: input.offeringType,
      lifecycleStatus: input.lifecycleStatus,
      isActive: input.isActive,
      sortField: input.sortField,
      sortDir: input.sortDir,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_offering  ->  GET /api/cpq/product-offerings?id=                   */
/* -------------------------------------------------------------------------- */

export const getOfferingInput = z.object({
  offeringId: z.string().uuid().describe('CPQ offering id (UUID) from cpq.list_offerings.'),
})
type GetOfferingInput = z.infer<typeof getOfferingInput>

const getOfferingTool = defineCpqApiTool<GetOfferingInput, Record<string, unknown>, { offering: Record<string, unknown> }>({
  name: 'cpq.get_offering',
  displayName: 'Get CPQ offering',
  description:
    'Fetch one CPQ offering with its specification summary, charge definitions and, for bundles, its components per slot. Returns { offering }.',
  inputSchema: getOfferingInput,
  requiredFeatures: ['cpq.offerings.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/product-offerings',
    query: { id: input.offeringId },
  }),
  mapResponse: (response) => ({ offering: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_bundle_tree  ->  GET /api/cpq/bundle-tree?offeringId=              */
/* -------------------------------------------------------------------------- */

export const getBundleTreeInput = z.object({
  offeringId: z.string().uuid().describe('Bundle offering id (UUID).'),
})
type GetBundleTreeInput = z.infer<typeof getBundleTreeInput>

const getBundleTreeTool = defineCpqApiTool<GetBundleTreeInput, { tree?: unknown; validation?: unknown }, { tree: unknown; validation: unknown }>({
  name: 'cpq.get_bundle_tree',
  displayName: 'Get CPQ bundle tree',
  description:
    'Resolve the full component tree of a bundle offering (slots, cardinality, default and optional child offerings) plus the structural validation of that bundle definition. Returns { tree, validation }.',
  inputSchema: getBundleTreeInput,
  requiredFeatures: ['cpq.offerings.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/bundle-tree',
    query: { offeringId: input.offeringId },
  }),
  mapResponse: (response) => ({
    tree: response.data?.tree ?? null,
    validation: response.data?.validation ?? null,
  }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.list_specifications  ->  GET /api/cpq/product-specifications           */
/* -------------------------------------------------------------------------- */

export const listSpecificationsInput = z.object({
  search: z.string().trim().optional().describe('Free-text match on specification code, name or description.'),
  specType: z.enum(['simple', 'bundle']).optional().describe('Restrict to simple or bundle specifications.'),
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated']).optional().describe('Lifecycle status filter.'),
  isActive: z.boolean().optional().describe('Filter on the active flag.'),
  page: pageField,
  pageSize: pageSizeField,
})
type ListSpecificationsInput = z.infer<typeof listSpecificationsInput>

const listSpecificationsTool = defineCpqApiTool<ListSpecificationsInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_specifications',
  displayName: 'List CPQ product specifications',
  description:
    'List CPQ product specifications (the technical definition behind offerings: attribute schema, relationships, bundle slots). Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listSpecificationsInput,
  requiredFeatures: ['cpq.specifications.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/product-specifications',
    query: compactQuery({
      search: input.search,
      specType: input.specType,
      lifecycleStatus: input.lifecycleStatus,
      isActive: input.isActive,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_specification  ->  GET /api/cpq/product-specifications?id=         */
/* -------------------------------------------------------------------------- */

export const getSpecificationInput = z.object({
  specificationId: z.string().uuid().describe('Product specification id (UUID), for example an offering\'s specId.'),
})
type GetSpecificationInput = z.infer<typeof getSpecificationInput>

const getSpecificationTool = defineCpqApiTool<GetSpecificationInput, Record<string, unknown>, { specification: Record<string, unknown> }>({
  name: 'cpq.get_specification',
  displayName: 'Get CPQ product specification',
  description:
    'Fetch one product specification with its attributes (code, type, resolution time, options, constraints, dependsOn, defaults, required flag), offerings, requires/excludes/parent-child relationships and, for bundles, its slots. Returns { specification }.',
  inputSchema: getSpecificationInput,
  requiredFeatures: ['cpq.specifications.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/product-specifications',
    query: { id: input.specificationId },
  }),
  mapResponse: (response) => ({ specification: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_configurable_attributes  ->  GET /api/cpq/quotes/attributes        */
/* -------------------------------------------------------------------------- */

export const getConfigurableAttributesInput = z.object({
  offeringId: z.string().uuid().describe('CPQ offering id (UUID) being configured.'),
  configuration: configurationField
    .optional()
    .describe('Values chosen so far, keyed by attribute code. Dependent attributes narrow their allowed options based on these.'),
})
type GetConfigurableAttributesInput = z.infer<typeof getConfigurableAttributesInput>

const getConfigurableAttributesTool = defineCpqApiTool<
  GetConfigurableAttributesInput,
  { attributes?: unknown[] },
  { attributes: unknown[] }
>({
  name: 'cpq.get_configurable_attributes',
  displayName: 'Get configurable attributes',
  description:
    'List the run-time attributes an operator must or may set when configuring an offering, with the options still allowed given the values chosen so far. Returns { attributes }. Call it before cpq.calculate_price or cpq.add_quote_line so the configuration uses real attribute codes and values.',
  inputSchema: getConfigurableAttributesInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/quotes/attributes',
    query: compactQuery({
      offeringId: input.offeringId,
      configuration: input.configuration && Object.keys(input.configuration).length > 0
        ? JSON.stringify(input.configuration)
        : undefined,
    }),
  }),
  mapResponse: (response) => ({
    attributes: Array.isArray(response.data?.attributes) ? response.data!.attributes! : [],
  }),
})

export const catalogAiTools: CpqAiToolDefinition[] = [
  listOfferingsTool,
  getOfferingTool,
  getBundleTreeTool,
  listSpecificationsTool,
  getSpecificationTool,
  getConfigurableAttributesTool,
]

export default catalogAiTools
