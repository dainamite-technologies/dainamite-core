import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CpqQuoteLineCost, CpqQuoteMarkupOverride } from '../entities'
import { cpqQuoteLineCostCreateSchema, cpqQuoteLineCostUpdateSchema } from '../quote-costs'
import { COST_LINE_ORIGINS, COST_SOURCING_STATUSES, COST_VALUE_ORIGINS, COST_VALUE_STATUSES } from '../costs'

describe('quote line cost schema', () => {
  it('declares the value sets for this feature', () => {
    expect([...COST_LINE_ORIGINS]).toEqual(['catalog', 'manual', 'carried'])
    expect([...COST_VALUE_STATUSES]).toEqual(['none', 'estimated', 'confirmed'])
    expect([...COST_VALUE_ORIGINS]).toEqual(['catalog', 'manual', 'supplier', 'carried'])
    expect(COST_SOURCING_STATUSES[0]).toBe('not_requested')
  })

  it('defaults sourcing to not_requested and leaves later-feature columns empty', () => {
    const cost = new CpqQuoteLineCost()
    expect(cost.sourcingStatus).toBe('not_requested')
    expect([cost.costRequestId, cost.fxRate, cost.indexSnapshot, cost.carriedFromHash, cost.proposedAmount, cost.deletedAt]).toEqual(
      [null, null, null, null, null, null],
    )
    expect(cost.renegotiationDue).toBe(false)
    expect(new CpqQuoteMarkupOverride().deletedAt).toBeNull()
  })

  it('migration enforces the partial uniques and value-set checks', () => {
    const dir = path.join(__dirname, '..', '..', 'migrations')
    const sql = readFileSync(path.join(dir, 'Migration20261113091043.ts'), 'utf8')
    expect(sql).toContain('"quote_line_id", "cost_key") where "deleted_at" is null')
    expect(sql).toContain('"quote_line_id", "charge_code") where "deleted_at" is null')
    for (const status of COST_VALUE_STATUSES) expect(sql).toContain(`'${status}'`)
  })

  it('the ARC migration widens both origin checks (keeping supplier), adds the column and the partial index, and down() narrows safely', () => {
    const dir = path.join(__dirname, '..', '..', 'migrations')
    const sql = readFileSync(path.join(dir, 'Migration20261115151709.ts'), 'utf8')
    const [up, down] = sql.split('override down()')
    expect(up).toContain(`check ("origin" in ('catalog', 'manual', 'carried'))`)
    expect(up).toContain(`"value_origin" in ('catalog', 'manual', 'supplier', 'carried')`)
    expect(up).toContain('add "renegotiation_due" boolean not null default false')
    expect(up).toContain('("organization_id", "tenant_id", "carried_from_item_cost_id") where "deleted_at" is null and "carried_from_item_cost_id" is not null')
    expect(down).toContain(`set "origin" = 'manual' where "origin" = 'carried'`)
    expect(down).toContain(`set "value_origin" = 'manual' where "value_origin" = 'carried'`)
    expect(down).toContain(`"value_origin" in ('catalog', 'manual', 'supplier')`)
    expect(down).toContain(`check ("origin" in ('catalog', 'manual'))`)
  })
})

describe('carried origin is server-side only (validator matrix)', () => {
  const base = { quoteLineId: '11111111-1111-4111-8111-111111111111', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat' }
  it.each([
    ['create origin carried', () => cpqQuoteLineCostCreateSchema.safeParse({ ...base, origin: 'carried' })],
    ['create valueOrigin carried', () => cpqQuoteLineCostCreateSchema.safeParse({ ...base, valueOrigin: 'carried' })],
    ['create carriedFromItemCostId', () => cpqQuoteLineCostCreateSchema.safeParse({ ...base, carriedFromItemCostId: '11111111-1111-4111-8111-111111111111' })],
    ['create renegotiationDue', () => cpqQuoteLineCostCreateSchema.safeParse({ ...base, renegotiationDue: true })],
    ['update origin carried', () => cpqQuoteLineCostUpdateSchema.safeParse({ origin: 'carried' })],
    ['update valueOrigin carried', () => cpqQuoteLineCostUpdateSchema.safeParse({ valueOrigin: 'carried' })],
    ['update renegotiationDue', () => cpqQuoteLineCostUpdateSchema.safeParse({ renegotiationDue: false })],
  ])('rejects %s', (_label, parse) => {
    expect(parse().success).toBe(false)
  })
  it('still accepts a plain manual cost and an unchanged value write', () => {
    expect(cpqQuoteLineCostCreateSchema.safeParse(base).success).toBe(true)
    expect(cpqQuoteLineCostUpdateSchema.safeParse({ unitAmount: 12, valueStatus: 'confirmed', note: 'renegotiated' }).success).toBe(true)
  })
})
