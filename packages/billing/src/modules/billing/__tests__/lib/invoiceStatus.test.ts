import {
  __resetInvoiceStatusCacheForTests,
  resolveInvoiceStatusEntryId,
} from '../../lib/invoiceStatus'

type MockEm = {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
}

function createMockEm(): MockEm {
  return { findOne: jest.fn() }
}

const TENANT = 'tenant-1'
const ORG = 'org-1'

beforeEach(() => {
  __resetInvoiceStatusCacheForTests()
})

describe('resolveInvoiceStatusEntryId', () => {
  it('looks up dictionary then matching entry', async () => {
    const em = createMockEm()
    em.findOne
      .mockResolvedValueOnce({ id: 'dict-1' })
      .mockResolvedValueOnce({ id: 'entry-draft' })

    const result = await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'draft')

    expect(result).toBe('entry-draft')
    expect(em.findOne).toHaveBeenCalledTimes(2)
    const [, dictWhere] = em.findOne.mock.calls[0]
    expect((dictWhere as { key: string }).key).toBe('sales.invoice_status')
    const [, entryWhere] = em.findOne.mock.calls[1]
    expect((entryWhere as { value: string }).value).toBe('draft')
  })

  it('caches the resolved id per (tenant, org, status)', async () => {
    const em = createMockEm()
    em.findOne
      .mockResolvedValueOnce({ id: 'dict-1' })
      .mockResolvedValueOnce({ id: 'entry-paid' })

    const a = await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'paid')
    const b = await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'paid')

    expect(a).toBe('entry-paid')
    expect(b).toBe('entry-paid')
    // Second call hits cache — no extra findOne invocations.
    expect(em.findOne).toHaveBeenCalledTimes(2)
  })

  it('separate cache entries per status (draft vs posted vs paid vs void)', async () => {
    const em = createMockEm()
    em.findOne
      .mockResolvedValueOnce({ id: 'dict-1' })
      .mockResolvedValueOnce({ id: 'entry-draft' })
      .mockResolvedValueOnce({ id: 'dict-1' })
      .mockResolvedValueOnce({ id: 'entry-posted' })

    expect(await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'draft')).toBe(
      'entry-draft',
    )
    expect(await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'posted')).toBe(
      'entry-posted',
    )
  })

  it('returns null when the dictionary is missing', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)
    expect(await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'draft')).toBeNull()
  })

  it('returns null when the entry value is missing', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce({ id: 'dict-1' }).mockResolvedValueOnce(null)
    expect(await resolveInvoiceStatusEntryId(em as never, TENANT, ORG, 'void')).toBeNull()
  })

  it('separate cache entries per tenant', async () => {
    const em = createMockEm()
    em.findOne
      .mockResolvedValueOnce({ id: 'dict-A' })
      .mockResolvedValueOnce({ id: 'entry-A' })
      .mockResolvedValueOnce({ id: 'dict-B' })
      .mockResolvedValueOnce({ id: 'entry-B' })

    expect(await resolveInvoiceStatusEntryId(em as never, 't-A', ORG, 'draft')).toBe(
      'entry-A',
    )
    expect(await resolveInvoiceStatusEntryId(em as never, 't-B', ORG, 'draft')).toBe(
      'entry-B',
    )
    expect(em.findOne).toHaveBeenCalledTimes(4)
  })
})
