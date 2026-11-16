import { z } from 'zod'
import { isoDate } from './quote-costs'

/**
 * Cost indices and their append-only values (index-costs spec §Data Model / §API Contracts). Pure schemas and
 * constants shared by the service, commands and routes.
 */

/** Read: index catalogue and values. Write adds `cpq.pricing.manage` (spec Q13; index values are cost data, I-4). */
export const COST_INDEX_READ_FEATURES = ['cpq.pricing.view', 'cpq.costs.view'] as const
export const COST_INDEX_WRITE_FEATURES = ['cpq.pricing.manage', 'cpq.costs.view'] as const

export const COST_INDEX_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/
export const COST_INDEX_IMPORT_MAX_ROWS = 1000
export const COST_INDEX_ROW_ERROR_CODES = ['UNKNOWN_INDEX', 'INDEX_INACTIVE', 'INVALID_VALUE', 'DUPLICATE_ROW'] as const
export type CostIndexRowErrorCode = (typeof COST_INDEX_ROW_ERROR_CODES)[number]

// numeric(18,6), strictly positive (DB CHECK `value > 0` mirrors this).
export const costIndexValueAmount = z.number().finite().gt(0).max(999_999_999_999).multipleOf(0.000001)

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, upper case')
const code = z.string().regex(COST_INDEX_CODE_PATTERN, 'A-Z, 0-9, _ or -, 2 to 40 characters')

export const cpqCostIndexCreateSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40),
  currencyCode,
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
}).strict()

/** `code` is immutable: sending it is a validation error here and `CODE_IMMUTABLE` at the route when it differs. */
export const cpqCostIndexUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  currencyCode: currencyCode.optional(),
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
  code: code.optional(),
}).strict()

export const cpqCostIndexValueCreateSchema = z.object({
  effectiveDate: isoDate,
  value: costIndexValueAmount,
  sourceNote: z.string().trim().max(500).nullish(),
}).strict()

export const cpqCostIndexImportRowSchema = z.object({
  indexCode: z.string().trim().min(1).max(40),
  effectiveDate: isoDate,
  value: costIndexValueAmount,
  sourceNote: z.string().trim().max(500).nullish(),
}).strict()

/**
 * Import body. Rows are validated one by one by the service (per-row errors, nothing written), so the item shape here
 * is only the envelope: 1..1000 loosely typed rows.
 */
export const cpqCostIndexImportSchema = z.object({
  items: z.array(z.unknown()).min(1).max(COST_INDEX_IMPORT_MAX_ROWS),
  dryRun: z.boolean().optional(),
}).strict()

export const cpqCostIndexListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sortField: z.enum(['code', 'name', 'currencyCode', 'createdAt']).default('code'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

export const cpqCostIndexValuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  from: isoDate.optional(),
  to: isoDate.optional(),
  includeSuperseded: z.enum(['true', 'false']).transform((v) => v === 'true').default(false),
})

export type CostIndexCreateInput = z.infer<typeof cpqCostIndexCreateSchema>
export type CostIndexUpdateInput = z.infer<typeof cpqCostIndexUpdateSchema>
export type CostIndexValueInput = z.infer<typeof cpqCostIndexValueCreateSchema>
export type CostIndexImportRow = z.infer<typeof cpqCostIndexImportRowSchema>
