import { Migration20261110213052 } from '../../migrations/Migration20261110213052'

it('generates a rollback that removes the new table before it can be recreated', () => {
  const up: string[] = [], down: string[] = []
  Migration20261110213052.prototype.up.call({ addSql: (sql: string) => up.push(sql) } as never)
  Migration20261110213052.prototype.down.call({ addSql: (sql: string) => down.push(sql) } as never)
  expect(up.join('\n')).toContain('create table "cpq_quote_price_adjustments"')
  expect(down.join('\n')).toContain('drop table if exists "cpq_quote_price_adjustments"')
  expect(up.join('\n')).toContain('add "pricing_revision"')
  expect(down.join('\n')).toContain('drop column "pricing_revision"')
})
