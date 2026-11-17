import { Migration20261117120000_cpq_offering_components_partial_unique as M } from '../../migrations/Migration20261117120000_cpq_offering_components_partial_unique'

function sql(direction: 'up' | 'down'): string {
  const out: string[] = []
  M.prototype[direction].call({ addSql: (statement: string) => out.push(statement) } as never)
  return out.join('\n')
}

describe('cpq_off_comp_unique migration (#122)', () => {
  it('replaces the full unique constraint with a partial unique index over live rows', () => {
    const up = sql('up')
    expect(up).toContain('drop constraint if exists "cpq_off_comp_unique"')
    expect(up).toMatch(/create unique index if not exists "cpq_off_comp_unique"[^;]*where "deleted_at" is null/)
  })

  it('dedupes before restoring the full constraint on rollback', () => {
    const down = sql('down')
    expect(down.indexOf('drop index if exists "cpq_off_comp_unique"')).toBeGreaterThanOrEqual(0)
    expect(down.indexOf('delete from "cpq_offering_components"')).toBeLessThan(down.indexOf('add constraint "cpq_off_comp_unique"'))
  })
})
