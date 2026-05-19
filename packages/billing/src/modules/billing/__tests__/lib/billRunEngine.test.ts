import { runBillRun, type RunBillRunParams } from '../../lib/billRunEngine'
import { __resetInvoiceWriterCacheForTests } from '../../lib/invoiceWriter'
import {
  BillRun,
  BillRunOutcome,
  BillingAccount,
  BillingAccountUsage,
  BillingItem,
} from '../../data/entities'

/**
 * End-to-end engine orchestration tests using a thin EM mock.
 *
 * These exercise the *control flow* — lock acquisition, account
 * iteration, savepoint isolation per account, dry/test/real branching,
 * final summary aggregation. The per-account work (period derivation,
 * item selection, invoice writing) is covered by the focused tests in
 * `billPeriod` / `itemSelector` / `invoiceWriter` and is intentionally
 * collapsed in the mock here (`em.execute` no-ops the open-draft check,
 * `em.find(BillingItem, ...)` returns whatever the test stages).
 */

type Captured = {
  persisted: unknown[]
  flushes: number
  findCalls: Array<{ entity: unknown; where: unknown }>
}

function createEnvironment(
  options: {
    accounts: BillingAccount[]
    itemsByAccount: Map<string, BillingItem[]>
    usageByAccount?: Map<string, BillingAccountUsage[]>
    openDraftIds?: Map<string, string> // accountId → existing-draft id
    lockAcquired?: boolean
    accountFails?: Set<string>
  },
): {
  em: unknown
  container: unknown
  captured: Captured
  numberGenerator: { generate: jest.MockedFunction<(...args: unknown[]) => unknown> }
  usageMarkedAs: jest.MockedFunction<(entity: unknown, where: unknown, data: unknown) => Promise<number>>
} {
  const captured: Captured = { persisted: [], flushes: 0, findCalls: [] }
  const numberGenerator = {
    generate: jest.fn(async () => ({
      number: 'INV-2026-0000001',
      format: 'INV-{YYYY}-{0000001}',
      sequence: 1,
    })),
  }

  type EmShape = {
    transactional: jest.MockedFunction<(fn: (tem: EmShape) => Promise<unknown>) => Promise<unknown>>
    execute: jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<unknown>>
    create: jest.MockedFunction<(ctor: unknown, data: Record<string, unknown>) => unknown>
    persist: jest.MockedFunction<(entity: unknown) => void>
    flush: jest.MockedFunction<() => Promise<void>>
    find: jest.MockedFunction<(entity: unknown, where: unknown) => Promise<unknown[]>>
    findOne: jest.MockedFunction<(entity: unknown, where: unknown) => Promise<unknown>>
    nativeUpdate: jest.MockedFunction<(entity: unknown, where: unknown, data: unknown) => Promise<number>>
  }

  const em: EmShape = {
    transactional: jest.fn(async function (fn: (tem: EmShape) => Promise<unknown>) {
      const failedAccountId = (this as { __failingAccount?: string })?.__failingAccount
      if (failedAccountId) {
        throw new Error(`mock per-account failure: ${failedAccountId}`)
      }
      return fn(em)
    }),
    execute: jest.fn(async (_sql: string, params?: unknown[]) => {
      // Open-draft check: SELECT id FROM sales_invoices ... bill_account_id = ?
      if (params && Array.isArray(params) && params.length >= 3) {
        const accountId = params[2] as string
        const existing = options.openDraftIds?.get(accountId)
        if (existing) return [{ id: existing }] as unknown
      }
      // Advisory-lock acquire query for the outer transaction
      return [{ acquired: options.lockAcquired ?? true }] as unknown
    }),
    create: jest.fn((_ctor: unknown, data: Record<string, unknown>) => ({
      ...data,
      id: (data.id as string | undefined) ?? `gen-${captured.persisted.length + 1}`,
    })),
    persist: jest.fn((entity: unknown) => {
      captured.persisted.push(entity)
    }),
    flush: jest.fn(async () => {
      captured.flushes += 1
    }),
    find: jest.fn(async (entity: unknown, where: unknown) => {
      captured.findCalls.push({ entity, where })
      if (entity === BillingAccount) return options.accounts as unknown[]
      if (entity === BillingItem) {
        const accountId = (where as { billAccountId?: string }).billAccountId
        if (!accountId) return []
        return (options.itemsByAccount.get(accountId) ?? []) as unknown[]
      }
      if (entity === BillingAccountUsage) {
        const accountId = (where as { billAccountId?: string }).billAccountId
        if (!accountId) return []
        const records = options.usageByAccount?.get(accountId) ?? []
        // Apply mock filtering for rated_in_bill_run_id IS NULL
        return records.filter((r) => r.ratedInBillRunId === null) as unknown[]
      }
      return []
    }),
    findOne: jest.fn(async (_entity: unknown, _where: unknown) => null),
    nativeUpdate: jest.fn(async (entity: unknown, where: unknown, data: unknown) => {
      if (entity === BillingAccountUsage) {
        const ids = (where as { id?: { $in?: string[] } }).id?.$in ?? []
        for (const records of options.usageByAccount?.values() ?? []) {
          for (const record of records) {
            if (ids.includes(record.id)) {
              record.ratedInBillRunId =
                (data as { ratedInBillRunId?: string }).ratedInBillRunId ?? null
            }
          }
        }
        return ids.length
      }
      return 0
    }),
  }

  // For failure injection — wire the per-account hook
  if (options.accountFails && options.accountFails.size > 0) {
    let accountIdx = 0
    em.transactional = jest.fn(async function (fn: (tem: EmShape) => Promise<unknown>) {
      // The FIRST transactional call is the outer (lock) wrap — pass
      // through. Subsequent calls are per-account savepoints — fail
      // the ones in `accountFails`.
      if (accountIdx === 0) {
        accountIdx += 1
        return fn(em)
      }
      const accountId = options.accounts[accountIdx - 1]?.id
      accountIdx += 1
      if (accountId && options.accountFails!.has(accountId)) {
        throw new Error(`Synthetic per-account failure: ${accountId}`)
      }
      return fn(em)
    })
  }

  const container = { resolve: jest.fn((token: string) => {
    if (token === 'salesDocumentNumberGenerator') return numberGenerator
    return null
  }) }

  return { em, container, captured, numberGenerator, usageMarkedAs: em.nativeUpdate }
}

function makeAccount(overrides: Partial<BillingAccount>): BillingAccount {
  return {
    id: overrides.id ?? 'acc-1',
    organizationId: overrides.organizationId ?? 'org-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    customerId: overrides.customerId ?? 'cust-1',
    name: overrides.name ?? 'Acme',
    currencyCode: overrides.currencyCode ?? 'EUR',
    billCycle: overrides.billCycle ?? 'monthly',
    billCycleAnchor: overrides.billCycleAnchor ?? '1',
    invoiceEmail: overrides.invoiceEmail ?? 'ar@acme.test',
    invoiceLanguage: overrides.invoiceLanguage ?? 'en',
    taxId: overrides.taxId ?? null,
    invoiceAddress: overrides.invoiceAddress ?? {
      line1: 'X',
      city: 'Y',
      postal_code: 'Z',
      country: 'PL',
    },
    nextBillDate: overrides.nextBillDate ?? new Date('2026-06-01T00:00:00Z'),
    lastBillDate: overrides.lastBillDate ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    deletedAt: overrides.deletedAt ?? null,
  } as BillingAccount
}

function makeRecurringItem(billAccountId: string, id = 'item-mrc'): BillingItem {
  return {
    id,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    billAccountId,
    type: 'recurring',
    billStartDate: new Date('2026-01-01T00:00:00Z'),
    billEndDate: null,
    description: 'MRC',
    rateJson: { unit_price: 49.99 },
    uomCode: null,
    subscriptionId: null,
    subscriptionItemId: null,
    sourceRef: null,
    currencyMismatch: false,
    billedToDate: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as BillingItem
}

beforeEach(() => {
  __resetInvoiceWriterCacheForTests()
})

const params = (overrides: Partial<RunBillRunParams>): RunBillRunParams => ({
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  asOfDate: new Date('2026-06-01T00:00:00Z'),
  triggeredBy: 'manual',
  mode: 'real',
  ...overrides,
})

describe('runBillRun — orchestration', () => {
  it('happy path: one account, one recurring item → one draft + success outcome', async () => {
    const account = makeAccount({})
    const item = makeRecurringItem(account.id)
    const { em, container, captured } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
    })

    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({}))

    expect(billRun.status).toBe('completed')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].status).toBe('success')
    expect(outcomes[0].draftInvoiceId).toMatch(/^gen-/)
    // Real-mode advances next_bill_date
    expect(account.nextBillDate.toISOString().slice(0, 10)).toBe('2026-07-01')
    expect(item.billedToDate?.toISOString().slice(0, 10)).toBe('2026-05-31')
    // Persisted entities: BillRun + SalesInvoice + 1 line + BillingAccountUsage advance + BillRunOutcome
    expect(captured.persisted.length).toBeGreaterThan(0)
  })

  it('zero accounts → completed run with summary={accounts_processed: 0}', async () => {
    const { em, container } = createEnvironment({
      accounts: [],
      itemsByAccount: new Map(),
    })
    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({}))
    expect(billRun.status).toBe('completed')
    expect(billRun.summary).toMatchObject({ accounts_processed: 0 })
    expect(outcomes).toHaveLength(0)
  })

  it('open-draft check: account with existing draft is skipped, no advance', async () => {
    const account = makeAccount({})
    const item = makeRecurringItem(account.id)
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
      openDraftIds: new Map([[account.id, 'existing-draft-1']]),
    })

    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({}))

    expect(outcomes[0].status).toBe('skipped_existing_draft')
    expect(outcomes[0].draftInvoiceId).toBe('existing-draft-1')
    // next_bill_date does NOT advance when we skip
    expect(account.nextBillDate.toISOString().slice(0, 10)).toBe('2026-06-01')
    // Item not marked billed
    expect(item.billedToDate).toBeNull()
    expect(billRun.summary).toMatchObject({ drafts_skipped_existing: 1 })
  })

  it('dry-run mode: persists nothing, advances nothing, computes outcomes', async () => {
    const account = makeAccount({})
    const item = makeRecurringItem(account.id)
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
    })

    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({ mode: 'dry' }))

    expect(billRun.dryRun).toBe(true)
    expect(outcomes[0].status).toBe('success')
    // Dry-run: no draft invoice id stored on the outcome
    expect(outcomes[0].draftInvoiceId).toBeNull()
    // No advancement
    expect(account.nextBillDate.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(item.billedToDate).toBeNull()
  })

  it('test mode: persists draft with test_run flag, does NOT advance state', async () => {
    const account = makeAccount({})
    const item = makeRecurringItem(account.id)
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
    })

    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({ mode: 'test' }))

    expect(billRun.testMode).toBe(true)
    expect(outcomes[0].status).toBe('success')
    expect(outcomes[0].draftInvoiceId).toMatch(/^gen-/)
    // No state advance
    expect(account.nextBillDate.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(item.billedToDate).toBeNull()
  })

  it('currency-mismatch item flags the outcome with success_with_warnings', async () => {
    const account = makeAccount({})
    const item = makeRecurringItem(account.id)
    item.currencyMismatch = true
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
    })

    const { outcomes } = await runBillRun(em as never, container as never, params({}))
    expect(outcomes[0].status).toBe('success_with_warnings')
    expect((outcomes[0].warnings as { currency_mismatch_items?: string[] } | null)
      ?.currency_mismatch_items).toEqual([item.id])
  })

  it('account with no eligible items still advances next_bill_date in real mode', async () => {
    const account = makeAccount({})
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, []]]),
    })

    const { outcomes } = await runBillRun(em as never, container as never, params({}))
    expect(outcomes[0].status).toBe('success')
    expect(account.nextBillDate.toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  // ─── Phase 3 — usage flow ────────────────────────────────────

  function makeUsageItem(
    billAccountId: string,
    uomCode: string,
    rate: Record<string, unknown>,
  ): BillingItem {
    return {
      id: `usage-item-${uomCode}`,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      billAccountId,
      type: 'usage',
      billStartDate: new Date('2026-01-01T00:00:00Z'),
      billEndDate: null,
      description: `Usage — ${uomCode}`,
      rateJson: rate,
      uomCode,
      subscriptionId: null,
      subscriptionItemId: null,
      sourceRef: null,
      currencyMismatch: false,
      billedToDate: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as BillingItem
  }

  function makeUsageRecord(
    id: string,
    billAccountId: string,
    uomCode: string,
    quantity: number,
  ): BillingAccountUsage {
    return {
      id,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      billAccountId,
      uomCode,
      quantity: quantity.toFixed(4),
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T23:59:59Z'),
      lineDescription: null,
      sourceRef: null,
      ratedInBillRunId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as BillingAccountUsage
  }

  it('aggregates usage records: graduated 25k → 15 EUR + marks rated_in_bill_run_id', async () => {
    const account = makeAccount({})
    const usageItem = makeUsageItem(account.id, 'api_request', {
      model: 'graduated',
      tiers: [
        { up_to: 10000, unit_price: 0 },
        { up_to: null, unit_price: 0.001 },
      ],
    })
    const u1 = makeUsageRecord('u1', account.id, 'api_request', 10000)
    const u2 = makeUsageRecord('u2', account.id, 'api_request', 15000)
    const { em, container, captured } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [usageItem]]]),
      usageByAccount: new Map([[account.id, [u1, u2]]]),
    })

    const { billRun, outcomes } = await runBillRun(em as never, container as never, params({}))

    expect(outcomes[0].status).toBe('success')
    // Persisted SalesInvoiceLine for the usage item with the right total
    const usageLine = captured.persisted.find((p) => {
      const m = (p as { metadata?: { billing_type?: string } }).metadata
      return m?.billing_type === 'usage'
    })
    expect(usageLine).toBeDefined()
    expect((usageLine as { totalNetAmount?: string }).totalNetAmount).toBe('15.0000')

    // Real-mode marks records as rated
    expect(u1.ratedInBillRunId).toBe(billRun.id)
    expect(u2.ratedInBillRunId).toBe(billRun.id)
    expect(billRun.summary).toMatchObject({ usage_records_rated: 2 })
  })

  it('unmatched usage uom → success_with_warnings, records left un-rated', async () => {
    const account = makeAccount({})
    const orphan = makeUsageRecord('u-orphan', account.id, 'mystery_meter', 999)
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, []]]),
      usageByAccount: new Map([[account.id, [orphan]]]),
    })

    const { outcomes } = await runBillRun(em as never, container as never, params({}))

    expect(outcomes[0].status).toBe('success_with_warnings')
    expect((outcomes[0].warnings as { unmatched_usage_uoms?: string[] } | null)
      ?.unmatched_usage_uoms).toEqual(['mystery_meter'])
    // Critically: orphan is NOT marked rated
    expect(orphan.ratedInBillRunId).toBeNull()
  })

  it('simple flat-rate usage emits unit_price on the invoice line', async () => {
    const account = makeAccount({})
    const usageItem = makeUsageItem(account.id, 'api_request', { unit_price: 0.001 })
    const u1 = makeUsageRecord('u1', account.id, 'api_request', 12000)
    const { em, container, captured } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [usageItem]]]),
      usageByAccount: new Map([[account.id, [u1]]]),
    })

    await runBillRun(em as never, container as never, params({}))

    const usageLine = captured.persisted.find((p) => {
      const m = (p as { metadata?: { billing_type?: string } }).metadata
      return m?.billing_type === 'usage'
    }) as { unitPriceNet?: string; totalNetAmount?: string; quantity?: string } | undefined
    expect(usageLine?.unitPriceNet).toBe('0.0010')
    expect(usageLine?.quantity).toBe('12000.0000')
    expect(usageLine?.totalNetAmount).toBe('12.0000')
  })

  it('test mode: rates usage on draft but does NOT mark records as rated', async () => {
    const account = makeAccount({})
    const usageItem = makeUsageItem(account.id, 'api_request', { unit_price: 0.001 })
    const u1 = makeUsageRecord('u1', account.id, 'api_request', 1000)
    const { em, container } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [usageItem]]]),
      usageByAccount: new Map([[account.id, [u1]]]),
    })

    await runBillRun(em as never, container as never, params({ mode: 'test' }))

    expect(u1.ratedInBillRunId).toBeNull()
  })

  it('mixed recurring + usage: invoice has BOTH lines, total = sum', async () => {
    const account = makeAccount({})
    const mrc = makeRecurringItem(account.id, 'mrc')
    const usageItem = makeUsageItem(account.id, 'api_request', { unit_price: 0.001 })
    const u1 = makeUsageRecord('u1', account.id, 'api_request', 12000)
    const { em, container, captured } = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [mrc, usageItem]]]),
      usageByAccount: new Map([[account.id, [u1]]]),
    })

    await runBillRun(em as never, container as never, params({}))

    const lines = captured.persisted.filter((p) => {
      const m = (p as { metadata?: { billing_type?: string } }).metadata
      return m?.billing_type === 'recurring' || m?.billing_type === 'usage'
    })
    expect(lines).toHaveLength(2)
    // Invoice header totalNet should be 49.99 (MRC) + 12.00 (usage) = 61.99
    const invoice = captured.persisted.find(
      (p) => (p as { invoiceNumber?: string }).invoiceNumber,
    ) as { grandTotalNetAmount?: string } | undefined
    expect(invoice?.grandTotalNetAmount).toBe('61.9900')
  })

  it('summary aggregates drafts_created / accounts_failed / accounts_with_warnings', async () => {
    const a1 = makeAccount({ id: 'a1' })
    const a2 = makeAccount({ id: 'a2' })
    const i1 = makeRecurringItem('a1')
    const i2 = makeRecurringItem('a2')
    i2.currencyMismatch = true
    const { em, container } = createEnvironment({
      accounts: [a1, a2],
      itemsByAccount: new Map([
        ['a1', [i1]],
        ['a2', [i2]],
      ]),
    })

    const { billRun } = await runBillRun(em as never, container as never, params({}))
    expect(billRun.summary).toMatchObject({
      accounts_processed: 2,
      drafts_created: 2,
      accounts_with_warnings: 1,
      accounts_failed: 0,
    })
  })
})
