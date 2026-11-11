import 'reflect-metadata'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../../data/entities'
import { withQuotePricingWrite } from '../priceAdjustments/quotePricingWrite'

/** Real identity maps, no database: only transaction SQL/reads are stubbed. */
it.each([false, true])('keeps preloaded parent entities and pending writes isolated (failure=%s)', async (fail) => {
  const orm = await MikroORM.init({ entities: [CpqQuoteConfiguration, CpqQuoteLineConfiguration],
    dbName: 'cpq_isolation_probe', metadataProvider: ReflectMetadataProvider })
  const parent = orm.em.fork({ clear: true })
  const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
  const quoteId = '33333333-3333-4333-8333-333333333333'
  const lineId = '44444444-4444-4444-8444-444444444444'
  const quote = parent.create(CpqQuoteConfiguration, { id: quoteId, quoteId, customerId: quoteId, ...scope, pricingRevision: 4 })
  const line = parent.create(CpqQuoteLineConfiguration, { id: lineId, quoteLineId: lineId, quoteConfigurationId: quoteId, ...scope, mrcTotal: '100' })
  parent.persist([quote, line])
  const originalFork = parent.fork.bind(parent)
  let isolated: EntityManager | undefined
  jest.spyOn(parent, 'fork').mockImplementation((options) => {
    const fork = originalFork(options)
    isolated = fork
    expect(fork.getUnitOfWork().getIdentityMap().keys()).toEqual([])
    expect(fork.getUnitOfWork().getPersistStack().size).toBe(0)
    // Don't run SQL: execute against this real, newly forked identity map.
    jest.spyOn(fork, 'transactional').mockImplementation(async (execute) => execute(fork))
    jest.spyOn(fork, 'findOne').mockImplementation(async () => {
      const loaded = fork.getReference(CpqQuoteConfiguration, quoteId)
      Object.assign(loaded, { ...scope, quoteId, pricingRevision: 4 })
      return loaded as never
    })
    jest.spyOn(fork, 'flush').mockResolvedValue(undefined)
    return fork
  })
  try {
    const operation = withQuotePricingWrite(parent, quoteId, scope, async (transaction, locked) => {
      expect(transaction).toBe(isolated)
      expect(locked).not.toBe(quote)
      const loadedLine = transaction.getReference(CpqQuoteLineConfiguration, lineId)
      expect(loadedLine).not.toBe(line)
      loadedLine.mrcTotal = '80'
      if (fail) throw new Error('Rejected after repricing')
      return locked.pricingRevision
    }, (status, message) => Object.assign(new Error(message), { status }))
    if (fail) await expect(operation).rejects.toThrow('Rejected after repricing')
    else expect(await operation).toBe(5)
    expect(quote.pricingRevision).toBe(4)
    expect(line.mrcTotal).toBe('100')
    expect(parent.getUnitOfWork().getPersistStack().has(quote)).toBe(true)
    expect(parent.getUnitOfWork().getPersistStack().has(line)).toBe(true)
  } finally { await orm.close(true) }
})
