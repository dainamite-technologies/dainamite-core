import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CpqQuoteLineCost, CpqQuoteMarkupOverride } from '../entities'
import { COST_LINE_ORIGINS, COST_SOURCING_STATUSES, COST_VALUE_ORIGINS, COST_VALUE_STATUSES } from '../costs'

describe('quote line cost schema', () => {
  it('declares the value sets for this feature', () => {
    expect([...COST_LINE_ORIGINS]).toEqual(['catalog', 'manual'])
    expect([...COST_VALUE_STATUSES]).toEqual(['none', 'estimated', 'confirmed'])
    expect([...COST_VALUE_ORIGINS]).toEqual(['catalog', 'manual'])
    expect(COST_SOURCING_STATUSES[0]).toBe('not_requested')
  })

  it('defaults sourcing to not_requested and leaves later-feature columns empty', () => {
    const cost = new CpqQuoteLineCost()
    expect(cost.sourcingStatus).toBe('not_requested')
    expect([cost.costRequestId, cost.fxRate, cost.indexSnapshot, cost.carriedFromHash, cost.proposedAmount, cost.deletedAt]).toEqual(
      [null, null, null, null, null, null],
    )
    expect(new CpqQuoteMarkupOverride().deletedAt).toBeNull()
  })

  it('migration enforces the partial uniques and value-set checks', () => {
    const dir = path.join(__dirname, '..', '..', 'migrations')
    const sql = readFileSync(path.join(dir, 'Migration20261113091043.ts'), 'utf8')
    expect(sql).toContain('"quote_line_id", "cost_key") where "deleted_at" is null')
    expect(sql).toContain('"quote_line_id", "charge_code") where "deleted_at" is null')
    for (const status of COST_VALUE_STATUSES) expect(sql).toContain(`'${status}'`)
  })
})
