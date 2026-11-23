/**
 * CPQ catalog write tools (#128): create an offering, add or remove a bundle
 * component. They are allowlisted only on `cpq.catalog_assistant`, never on the
 * quoting assistant, so sales operators can't change the catalog from a quote
 * chat. Like every CPQ write (see `_shared.ts`), they run only from an approved
 * pending action: the operator confirms each change on the approval card, and
 * MCP clients, which execute tools directly, are refused.
 */
import { z } from 'zod'
import {
  defineCpqApiTool,
  responseRecord,
  runAsTool,
  type CpqAiToolDefinition,
} from './_shared'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const SPEC_ENTITY = 'cpq:cpq_product_specification'
const OFFERING_ENTITY = 'cpq:cpq_product_offering'

type OfferingDetail = {
  id: string
  code?: string
  name?: string
  specId?: string
  offeringType?: string
  isSellable?: boolean
  components?: Array<{
    id: string
    slotId?: string
    slot?: { name?: string; componentGroup?: string } | null
    childOfferingId?: string
    childOffering?: { name?: string; code?: string } | null
    isDefault?: boolean
  }>
}

type SpecDetail = { id: string; code?: string; name?: string; specType?: string; defaultOfferingSellable?: boolean }
type SlotDetail = { id: string; name?: string; componentGroup?: string; specId?: string }

async function readOffering(tool: CpqAiToolDefinition, ctx: McpToolContext, id: string): Promise<OfferingDetail | null> {
  const response = await runAsTool<OfferingDetail>(tool, ctx, { method: 'GET', path: '/cpq/product-offerings', query: { id } })
  return response.success && response.data ? response.data : null
}

function offeringLabel(offering: OfferingDetail | null, fallbackId: string): string {
  return offering?.name ? `${offering.name} (${offering.code ?? fallbackId})` : fallbackId
}

/* -------------------------------------------------------------------------- */
/*  cpq.create_offering  ->  POST /api/cpq/product-offerings (mutation)        */
/* -------------------------------------------------------------------------- */

export const createOfferingInput = z
  .object({
    specId: z.string().uuid().describe('Product specification id (UUID) the offering is built on.'),
    code: z.string().trim().min(1).max(200).describe('Unique offering code, e.g. "fiber-300".'),
    name: z.string().trim().min(1).max(200).describe('Display name of the offering.'),
    description: z.string().trim().max(2000).optional().describe('Optional description.'),
    lifecycleStatus: z
      .enum(['draft', 'active', 'deprecated'])
      .optional()
      .describe('Lifecycle status (default draft). Only active offerings can be quoted.'),
    isSellable: z
      .boolean()
      .optional()
      .describe('false = component-only: can only be quoted inside a bundle. Omit to use the specification default.'),
    designTimeValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Fixed attribute values of this offering, keyed by attribute code.'),
  })
  .strict()
type CreateOfferingInput = z.infer<typeof createOfferingInput>

let createOfferingTool: CpqAiToolDefinition
createOfferingTool = defineCpqApiTool<CreateOfferingInput, Record<string, unknown>, { offering: Record<string, unknown> }>({
  name: 'cpq.create_offering',
  displayName: 'Create CPQ offering',
  description:
    'Create a CPQ product offering on a specification. Its type (simple or bundle) follows the specification. Goes through the operator approval card before anything is saved. Returns { offering } with the new id. Charges and bundle components are added separately.',
  inputSchema: createOfferingInput,
  requiredFeatures: ['cpq.offerings.manage', 'cpq.specifications.view'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = createOfferingInput.parse(rawInput)
    const response = await runAsTool<SpecDetail>(createOfferingTool, ctx, {
      method: 'GET',
      path: '/cpq/product-specifications',
      query: { id: input.specId },
    })
    const spec = response.success && response.data ? response.data : null
    if (!spec) return null
    const after: Record<string, unknown> = {
      specification: spec.name ? `${spec.name} (${spec.code ?? spec.id})` : spec.id,
      offeringType: spec.specType === 'bundle' ? 'bundle' : 'simple',
      code: input.code,
      name: input.name,
      lifecycleStatus: input.lifecycleStatus ?? 'draft',
      isSellable: input.isSellable ?? spec.defaultOfferingSellable ?? true,
    }
    if (input.description) after.description = input.description
    if (input.designTimeValues && Object.keys(input.designTimeValues).length > 0) after.designTimeValues = input.designTimeValues
    return {
      recordId: input.specId,
      entityType: SPEC_ENTITY,
      recordVersion: null,
      before: Object.fromEntries(Object.keys(after).map((key) => [key, null])),
      after,
      display: {
        fieldLabels: {
          specification: 'Specification',
          offeringType: 'Type',
          code: 'Code',
          name: 'Name',
          lifecycleStatus: 'Lifecycle status',
          isSellable: 'Sellable on its own',
          description: 'Description',
          designTimeValues: 'Design-time values',
        },
      },
    }
  },
  toOperation: (input) => {
    const body: Record<string, unknown> = { specId: input.specId, code: input.code, name: input.name }
    if (input.description) body.description = input.description
    if (input.lifecycleStatus) body.lifecycleStatus = input.lifecycleStatus
    if (input.isSellable !== undefined) body.isSellable = input.isSellable
    if (input.designTimeValues) body.designTimeValues = input.designTimeValues
    return { method: 'POST', path: '/cpq/product-offerings', body }
  },
  mapResponse: (response) => ({ offering: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.add_bundle_component  ->  POST /api/cpq/offering-components (mutation) */
/* -------------------------------------------------------------------------- */

export const addBundleComponentInput = z
  .object({
    offeringId: z.string().uuid().describe('Bundle offering id (UUID).'),
    slotId: z.string().uuid().describe('Slot id (UUID) of the bundle specification, from cpq.get_bundle_tree or cpq.get_specification.'),
    childOfferingId: z.string().uuid().describe('Offering id (UUID) to add to the slot. It must be built on the slot target specification.'),
    isDefault: z.boolean().optional().describe('true = added automatically when the bundle is added to a quote (default false).'),
  })
  .strict()
type AddBundleComponentInput = z.infer<typeof addBundleComponentInput>

let addBundleComponentTool: CpqAiToolDefinition
addBundleComponentTool = defineCpqApiTool<AddBundleComponentInput, Record<string, unknown>, { component: Record<string, unknown> }>({
  name: 'cpq.add_bundle_component',
  displayName: 'Add bundle component',
  description:
    'Add a child offering to a slot of a bundle offering. The server checks the bundle rules (V-COMP codes). Goes through the operator approval card before anything is saved. Returns { component }.',
  inputSchema: addBundleComponentInput,
  requiredFeatures: ['cpq.offerings.manage', 'cpq.offerings.view', 'cpq.specifications.view'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = addBundleComponentInput.parse(rawInput)
    const [bundle, child, slotResponse] = await Promise.all([
      readOffering(addBundleComponentTool, ctx, input.offeringId),
      readOffering(addBundleComponentTool, ctx, input.childOfferingId),
      runAsTool<SlotDetail>(addBundleComponentTool, ctx, { method: 'GET', path: '/cpq/bundle-slots', query: { id: input.slotId } }),
    ])
    if (!bundle) return null
    const slot = slotResponse.success && slotResponse.data ? slotResponse.data : null
    return {
      recordId: input.offeringId,
      entityType: OFFERING_ENTITY,
      recordVersion: null,
      before: { bundle: offeringLabel(bundle, input.offeringId), slot: null, childOffering: null, isDefault: null },
      after: {
        bundle: offeringLabel(bundle, input.offeringId),
        slot: slot?.name ?? input.slotId,
        childOffering: offeringLabel(child, input.childOfferingId),
        isDefault: input.isDefault ?? false,
      },
      display: { fieldLabels: { bundle: 'Bundle', slot: 'Slot', childOffering: 'Component', isDefault: 'Default' } },
    }
  },
  toOperation: (input) => ({
    method: 'POST',
    path: '/cpq/offering-components',
    body: {
      offeringId: input.offeringId,
      slotId: input.slotId,
      childOfferingId: input.childOfferingId,
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    },
  }),
  mapResponse: (response) => ({ component: responseRecord(response) }),
})

/* -------------------------------------------------------------------------- */
/*  cpq.remove_bundle_component -> DELETE /api/cpq/offering-components         */
/* -------------------------------------------------------------------------- */

export const removeBundleComponentInput = z
  .object({
    offeringId: z.string().uuid().describe('Bundle offering id (UUID) the component belongs to.'),
    componentId: z.string().uuid().describe('Component id (UUID), from cpq.get_offering components[].id.'),
  })
  .strict()
type RemoveBundleComponentInput = z.infer<typeof removeBundleComponentInput>

async function findComponent(tool: CpqAiToolDefinition, ctx: McpToolContext, input: RemoveBundleComponentInput) {
  const bundle = await readOffering(tool, ctx, input.offeringId)
  const component = bundle?.components?.find((candidate) => candidate.id === input.componentId) ?? null
  return { bundle, component }
}

let removeBundleComponentTool: CpqAiToolDefinition
removeBundleComponentTool = defineCpqApiTool<RemoveBundleComponentInput, Record<string, unknown>, { removed: true; componentId: string }>({
  name: 'cpq.remove_bundle_component',
  displayName: 'Remove bundle component',
  description:
    'Remove a component (child offering) from a bundle offering. Quotes already priced keep their lines; new quotes no longer offer it. Goes through the operator approval card before anything is saved. Returns { removed, componentId }.',
  inputSchema: removeBundleComponentInput,
  requiredFeatures: ['cpq.offerings.manage', 'cpq.offerings.view'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const input = removeBundleComponentInput.parse(rawInput)
    const { bundle, component } = await findComponent(removeBundleComponentTool, ctx, input)
    if (!bundle || !component) return null
    return {
      recordId: input.componentId,
      entityType: OFFERING_ENTITY,
      recordVersion: null,
      before: {
        bundle: offeringLabel(bundle, input.offeringId),
        slot: component.slot?.name ?? component.slotId ?? null,
        childOffering: component.childOffering?.name ?? component.childOfferingId ?? null,
        isDefault: component.isDefault ?? false,
      },
      after: { bundle: offeringLabel(bundle, input.offeringId), slot: null, childOffering: null, isDefault: null },
      display: { fieldLabels: { bundle: 'Bundle', slot: 'Slot', childOffering: 'Component', isDefault: 'Default' } },
    }
  },
  toOperation: async (input, ctx) => {
    // Refuse a component id that does not belong to the named bundle, so a
    // wrong id can't remove a component from another bundle.
    const { component } = await findComponent(removeBundleComponentTool, ctx, input)
    if (!component) {
      throw new Error(`Component "${input.componentId}" was not found on bundle offering "${input.offeringId}".`)
    }
    return { method: 'DELETE', path: '/cpq/offering-components', body: { id: input.componentId } }
  },
  mapResponse: (_response, input) => ({ removed: true, componentId: input.componentId }),
})

export const catalogWriteAiTools: CpqAiToolDefinition[] = [
  createOfferingTool,
  addBundleComponentTool,
  removeBundleComponentTool,
]

/** Names of the catalog write tools (only on `cpq.catalog_assistant`). */
export const CPQ_CATALOG_WRITE_TOOL_NAMES: readonly string[] = catalogWriteAiTools.map((tool) => tool.name)

export default catalogWriteAiTools
