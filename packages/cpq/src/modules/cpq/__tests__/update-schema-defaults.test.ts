/**
 * Update schemas must never inject `.default()` values. A PUT that sends only
 * `{ id, isActive }` used to come back with sortOrder, offeringType,
 * lifecycleStatus, ... filled in, and the routes overwrote stored values.
 */
import { z } from 'zod'
import * as validators from '../data/validators'

const ID = '11111111-1111-4111-8111-111111111111'

const updateSchemas = (Object.entries(validators) as Array<[string, unknown]>)
  .filter(([name, schema]) => /UpdateSchema$/.test(name) && schema instanceof z.ZodObject)
  .map(([name, schema]) => [name, schema as z.ZodObject<z.ZodRawShape>] as [string, z.ZodObject<z.ZodRawShape>])

it('finds the CPQ update schemas', () => {
  expect(updateSchemas.length).toBeGreaterThanOrEqual(9)
})

it.each(updateSchemas)('%s adds no keys the caller did not send', (_name, schema) => {
  const required = Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
    .map(([key]) => key)
  // Only identity fields may be required on an update.
  expect(required.filter((key) => key !== 'id')).toEqual([])
  const parsed = schema.parse({ id: ID }) as Record<string, unknown>
  expect(Object.keys(parsed).filter((key) => parsed[key] !== undefined)).toEqual(['id'])
})

it('keeps a sent value', () => {
  const parsed = validators.cpqPriceRuleUpdateSchema.parse({ id: ID, isActive: false })
  expect(parsed).toEqual({ id: ID, isActive: false })
})
