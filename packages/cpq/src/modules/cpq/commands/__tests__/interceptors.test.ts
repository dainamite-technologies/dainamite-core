import { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../../data/entities'
import {
  interceptors,
  readDeletedSalesQuoteId,
  guardSalesDeleteOfTerminalCpqQuote,
  restoreCpqQuoteAfterSalesUndo,
  softDeleteCpqQuoteAfterSalesDelete,
} from '../interceptors'

const QUOTE = '11111111-1111-4111-8111-111111111111'
const scope = { tenantId: 'tenant', organizationId: 'org' }
const deletedAt = new Date('2026-11-16T10:00:00.000Z')

function setup(options: { live?: object | null; deleted?: Record<string, unknown> | null; lines?: Array<Record<string, unknown>> }) {
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CpqQuoteConfiguration) return null
      return where.deletedAt === null ? (options.live ?? null) : (options.deleted ?? null)
    }),
    find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? (options.lines ?? []) : [])),
    flush: jest.fn(),
  }
  const context = {
    commandId: 'sales.quotes.delete',
    auth: null,
    selectedOrganizationId: null,
    container: { resolve: () => ({ fork: () => em }) },
  } as never
  const undo = {
    input: { undo: { before: { quote: { id: QUOTE } } } },
    logEntry: { ...scope, resourceKind: 'sales.quote', resourceId: QUOTE },
    undoToken: 't',
  }
  return { em, context, undo }
}

describe('cpq sales.quotes.delete undo interceptor', () => {
  it('is registered for the sales delete command', () => {
    expect(interceptors.map((entry) => entry.targetCommand)).toEqual(['sales.quotes.delete'])
    expect(typeof interceptors[0].afterUndo).toBe('function')
    expect(typeof interceptors[0].afterExecute).toBe('function')
    expect(typeof interceptors[0].beforeExecute).toBe('function')
  })

  it('reads the quote id from the action log entry, then from the undo payload', () => {
    expect(readDeletedSalesQuoteId({ undo: { before: {} } }, { resourceKind: 'sales.quote', resourceId: QUOTE })).toBe(QUOTE)
    expect(readDeletedSalesQuoteId({ undo: { before: { quote: { id: QUOTE } } } })).toBe(QUOTE)
    expect(readDeletedSalesQuoteId({ undo: { before: {} } }, { resourceKind: 'catalog.product', resourceId: 'x' })).toBeNull()
    expect(readDeletedSalesQuoteId({ body: { id: QUOTE } })).toBe(QUOTE)
    expect(readDeletedSalesQuoteId({ id: QUOTE })).toBe(QUOTE)
    expect(readDeletedSalesQuoteId({})).toBeNull()
  })

  it('restores the configuration and only the lines deleted with it', async () => {
    const config = { id: 'cfg', deletedAt }
    const line = { id: 'line', deletedAt }
    const { em, context, undo } = setup({ deleted: config, lines: [line] })
    const result = await restoreCpqQuoteAfterSalesUndo(undo, context)
    expect(result).toEqual({ restoredConfigurationId: 'cfg', restoredLines: 1 })
    expect(config.deletedAt).toBeNull()
    expect(line.deletedAt).toBeNull()
    expect(em.find).toHaveBeenCalledWith(CpqQuoteLineConfiguration, { quoteConfigurationId: 'cfg', ...scope, deletedAt })
    expect(em.findOne).toHaveBeenCalledWith(
      CpqQuoteConfiguration,
      { quoteId: QUOTE, ...scope, deletedAt: { $ne: null } },
      { orderBy: { deletedAt: 'desc' } },
    )
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the configuration is still live or missing', async () => {
    const live = setup({ live: { id: 'cfg' } })
    expect(await restoreCpqQuoteAfterSalesUndo(live.undo, live.context)).toBeNull()
    expect(live.em.flush).not.toHaveBeenCalled()
    const none = setup({ deleted: null })
    expect(await restoreCpqQuoteAfterSalesUndo(none.undo, none.context)).toBeNull()
    expect(none.em.flush).not.toHaveBeenCalled()
  })

  it('does nothing without a tenant / organization scope', async () => {
    const { context, undo, em } = setup({ deleted: { id: 'cfg', deletedAt } })
    expect(await restoreCpqQuoteAfterSalesUndo({ ...undo, logEntry: { resourceKind: 'sales.quote', resourceId: QUOTE } }, context)).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  describe('afterExecute (redo, delete from the sales module)', () => {
    function deleteSetup(config: Record<string, unknown> | null, lines: Array<Record<string, unknown>> = []) {
      const em = {
        findOne: jest.fn(async () => config),
        find: jest.fn(async () => lines),
        flush: jest.fn(),
      }
      const context = {
        commandId: 'sales.quotes.delete',
        auth: { tenantId: 'tenant' },
        selectedOrganizationId: null,
        container: { resolve: () => ({ fork: () => em }) },
      } as never
      return { em, context }
    }

    it('soft-deletes the live CPQ configuration and its live lines with one timestamp', async () => {
      const config: Record<string, unknown> = { id: 'cfg', organizationId: 'org', deletedAt: null }
      const line: Record<string, unknown> = { id: 'line', deletedAt: null }
      const { em, context } = deleteSetup(config, [line])
      const result = await softDeleteCpqQuoteAfterSalesDelete({ body: { id: QUOTE } }, context)
      expect(result).toEqual({ deletedConfigurationId: 'cfg', deletedLines: 1 })
      expect(config.deletedAt).toBeInstanceOf(Date)
      expect(line.deletedAt).toBe(config.deletedAt)
      expect(em.findOne).toHaveBeenCalledWith(CpqQuoteConfiguration, { quoteId: QUOTE, tenantId: 'tenant', deletedAt: null })
      expect(em.flush).toHaveBeenCalledTimes(1)
    })

    it.each(['accepted', 'rejected', 'cancelled'])('never soft-deletes a %s quote', async (cpqStatus) => {
      const config: Record<string, unknown> = { id: 'cfg', organizationId: 'org', deletedAt: null, cpqStatus }
      const { em, context } = deleteSetup(config)
      expect(await softDeleteCpqQuoteAfterSalesDelete({ body: { id: QUOTE } }, context)).toBeNull()
      expect(config.deletedAt).toBeNull()
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('does nothing when CPQ already deleted the configuration or the quote is not a CPQ quote', async () => {
      const { em, context } = deleteSetup(null)
      expect(await softDeleteCpqQuoteAfterSalesDelete({ body: { id: QUOTE } }, context)).toBeNull()
      expect(em.flush).not.toHaveBeenCalled()
    })
  })

  describe('beforeExecute guard', () => {
    function guardSetup(config: Record<string, unknown> | null) {
      const em = { findOne: jest.fn(async () => config) }
      return {
        commandId: 'sales.quotes.delete',
        auth: { tenantId: 'tenant' },
        selectedOrganizationId: null,
        container: { resolve: () => ({ fork: () => em }) },
      } as never
    }

    it.each(['accepted', 'rejected', 'cancelled'])('blocks deleting a %s CPQ quote with 409', async (cpqStatus) => {
      const result = await guardSalesDeleteOfTerminalCpqQuote({ body: { id: QUOTE } }, guardSetup({ id: 'cfg', cpqStatus }))
      expect(result).toEqual({
        ok: false,
        status: 409,
        message: `Cannot delete a quote in '${cpqStatus}' status`,
        body: { error: `Cannot delete a quote in '${cpqStatus}' status` },
      })
    })

    it('lets open CPQ quotes and plain sales quotes through', async () => {
      expect(await guardSalesDeleteOfTerminalCpqQuote({ body: { id: QUOTE } }, guardSetup({ id: 'cfg', cpqStatus: 'ready' }))).toBeUndefined()
      expect(await guardSalesDeleteOfTerminalCpqQuote({ body: { id: QUOTE } }, guardSetup(null))).toBeUndefined()
    })
  })
})
