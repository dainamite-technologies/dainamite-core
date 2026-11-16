import { runBillRun, type RunBillRunParams } from '../../lib/billRunEngine'
import { __resetInvoiceWriterCacheForTests } from '../../lib/invoiceWriter'
import {
  BillingRun,
  BillingRunOutcome,
  BillingAccount,
  BillingAccountUsage,
  BillingItem,
  BillingInvoice,
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
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      // Usage aggregate: SELECT uom_code, SUM(quantity), COUNT(*) FROM
      // billing_account_usage WHERE ... GROUP BY uom_code. Buckets the
      // test fixture records by uom for the runner.
      if (sql.includes('billing_account_usage') && sql.includes('GROUP BY uom_code')) {
        const accountId = (params?.[2] ?? '') as string
        // Mirror the SQL bounds by calendar day: period_end <= ? [AND period_end > ?]
        const day = (v: unknown) => new Date(v as Date).toISOString().slice(0, 10)
        const upTo = params?.[3] ? day(params[3]) : null
        const after = params?.[4] ? day(params[4]) : null
        const recs = (options.usageByAccount?.get(accountId) ?? []).filter(
          (r) =>
            r.ratedInBillRunId === null &&
            (!upTo || day(r.periodEnd) <= upTo) &&
            (!after || day(r.periodEnd) > after),
        )
        const grouped = new Map<string, { sum: number; count: number }>()
        for (const r of recs) {
          const prev = grouped.get(r.uomCode) ?? { sum: 0, count: 0 }
          prev.sum += Number.parseFloat(r.quantity)
          prev.count += 1
          grouped.set(r.uomCode, prev)
        }
        return Array.from(grouped.entries()).map(([uom, agg]) => ({
          uom_code: uom,
          total_quantity: String(agg.sum),
          record_count: String(agg.count),
        })) as unknown
      }
      // Open-draft check: SELECT id FROM sales_invoices ... bill_account_id = ?
      if (sql.includes('sales_invoices') && params && Array.isArray(params) && params.length >= 3) {
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
    // Dedupe check: an existing billing invoice for (account, bill date).
    findOne: jest.fn(async (entity: unknown, where: unknown) => {
      if (entity === BillingInvoice) {
        const accountId = (where as { billAccountId?: string }).billAccountId
        const existing = accountId ? options.openDraftIds?.get(accountId) : undefined
        return existing ? { id: existing } : null
      }
      return null
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: unknown, data: unknown) => {
      if (entity === BillingAccountUsage) {
        // Predicate-based bulk update (post-Phase-4f refactor): the
        // engine now passes `{ billAccountId, uomCode: { $in: [...] },
        // ratedInBillRunId: null, periodEnd: { $lte: <date> }, ... }`
        // and we never see an explicit id list.
        const w = where as {
          billAccountId?: string
          uomCode?: { $in?: string[] }
          ratedInBillRunId?: null
        }
        const accountId = w.billAccountId
        const uoms = new Set(w.uomCode?.$in ?? [])
        if (!accountId || uoms.size === 0) return 0
        const records = options.usageByAccount?.get(accountId) ?? []
        let touched = 0
        for (const record of records) {
          if (record.ratedInBillRunId !== null) continue
          if (!uoms.has(record.uomCode)) continue
          record.ratedInBillRunId =
            (data as { ratedInBillRunId?: string }).ratedInBillRunId ?? null
          touched += 1
        }
        return touched
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
    billCycleInterval: overrides.billCycleInterval ?? 1,
    // Unpinned by default: the cycle follows `nextBillDate` (pre-cycle-day behaviour).
    billCycleDay: overrides.billCycleDay ?? null,
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

function makeRecurringItem(
  billAccountId: string,
  id = 'item-mrc',
  overrides: Partial<BillingItem> = {},
): BillingItem {
  return {
    id,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    billAccountId,
    type: 'recurring',
    // Starts on the account's bill date (Spec A default: billed in advance).
    billStartDate: new Date('2026-06-01T00:00:00Z'),
    chargeTiming: 'in_advance',
    prorate: true,
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
    ...overrides,
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
    // In advance: the June bill date bills June (Spec A).
    expect(item.billedToDate?.toISOString().slice(0, 10)).toBe('2026-06-30')
    // Persisted entities: BillingRun + SalesInvoice + 1 line + BillingAccountUsage advance + BillingRunOutcome
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
      return (p as { billingType?: string }).billingType === 'usage'
    })
    expect(usageLine).toBeDefined()
    expect((usageLine as { netAmount?: string }).netAmount).toBe('15.0000')

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
      return (p as { billingType?: string }).billingType === 'usage'
    }) as { unitPriceNet?: string; netAmount?: string; quantity?: string } | undefined
    expect(usageLine?.unitPriceNet).toBe('0.0010')
    expect(usageLine?.quantity).toBe('12000.0000')
    expect(usageLine?.netAmount).toBe('12.0000')
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
      const type = (p as { billingType?: string }).billingType
      return type === 'recurring' || type === 'usage'
    })
    expect(lines).toHaveLength(2)
    // Invoice header totalNet should be 49.99 (MRC) + 12.00 (usage) = 61.99
    const invoice = captured.persisted.find(
      (p) => (p as { documentType?: string }).documentType === 'invoice',
    ) as { subtotalNet?: string } | undefined
    expect(invoice?.subtotalNet).toBe('61.9900')
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

// ─── Spec A — cycle semantics ────────────────────────────────────

describe('runBillRun — Spec A cycles', () => {
  const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null)
  type Cycle = { bill_date: string; status: string; period_start: string | null; period_end: string | null; invoice_id: string | null }
  const cyclesOf = (outcome: { cycles?: unknown }) => (outcome.cycles ?? []) as Cycle[]
  const invoicesOf = (persisted: unknown[]) =>
    persisted.filter((p) => (p as { documentType?: string }).documentType === 'invoice') as Array<{
      number: string
      billDate: Date
      testRun: boolean
      metadata: Record<string, unknown>
    }>

  function operatorScenario() {
    const account = makeAccount({ nextBillDate: new Date('2026-11-14T00:00:00Z') })
    const item = makeRecurringItem(account.id, 'internet', {
      billStartDate: new Date('2026-11-14T00:00:00Z'),
      rateJson: { unit_price: 100 },
    })
    return { account, item }
  }
  const asOf = new Date('2027-02-01T00:00:00Z')

  it("real: the operator's test bills 3 cycles and advances the account", async () => {
    const { account, item } = operatorScenario()
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })

    const { billRun, outcomes } = await runBillRun(env.em as never, env.container as never, params({ asOfDate: asOf }))

    expect(cyclesOf(outcomes[0]).map((c) => [c.bill_date, c.period_start, c.period_end, c.status])).toEqual([
      ['2026-11-14', '2026-11-14', '2026-12-13', 'invoiced'],
      ['2026-12-14', '2026-12-14', '2027-01-13', 'invoiced'],
      ['2027-01-14', '2027-01-14', '2027-02-13', 'invoiced'],
    ])
    expect(invoicesOf(env.captured.persisted).map((i) => day(i.billDate))).toEqual([
      '2026-11-14',
      '2026-12-14',
      '2027-01-14',
    ])
    expect(day(account.nextBillDate)).toBe('2027-02-14')
    expect(day(item.billedToDate)).toBe('2027-02-13')
    expect(billRun.summary).toMatchObject({ drafts_created: 3, cycles_processed: 3 })
  })

  it('bill cycle day 31 re-pins every advance (31 Jan → 28 Feb → 31 Mar)', async () => {
    const account = makeAccount({ nextBillDate: new Date('2027-01-31T00:00:00Z'), billCycleDay: '31' })
    const item = makeRecurringItem(account.id, 'internet', {
      billStartDate: new Date('2027-01-31T00:00:00Z'),
      rateJson: { unit_price: 100 },
    })
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })
    const { outcomes } = await runBillRun(
      env.em as never,
      env.container as never,
      params({ asOfDate: new Date('2027-03-31T00:00:00Z') }),
    )
    expect(cyclesOf(outcomes[0]).map((c) => c.bill_date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(day(account.nextBillDate)).toBe('2027-04-30')
    expect(day(item.billedToDate)).toBe('2027-04-29')
  })

  it('a moved bill cycle day bills one short alignment period, then the new day', async () => {
    // Was billed on the 15th through 14 Nov (items paid ahead to 14 Dec); day changed to 1.
    const account = makeAccount({
      nextBillDate: new Date('2026-12-01T00:00:00Z'),
      lastBillDate: new Date('2026-11-14T00:00:00Z'),
      billCycleDay: '1',
    })
    const item = makeRecurringItem(account.id, 'internet', {
      billStartDate: new Date('2026-10-15T00:00:00Z'),
      billedToDate: new Date('2026-12-14T00:00:00Z'),
      rateJson: { unit_price: 100 },
    })
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })
    const { outcomes } = await runBillRun(
      env.em as never,
      env.container as never,
      params({ asOfDate: new Date('2027-01-01T00:00:00Z') }),
    )
    expect(cyclesOf(outcomes[0]).map((c) => c.bill_date)).toEqual(['2026-12-01', '2027-01-01'])
    expect(day(account.lastBillDate)).toBe('2026-12-31')
    expect(day(account.nextBillDate)).toBe('2027-02-01')
    expect(day(item.billedToDate)).toBe('2027-01-31')
    expect(invoicesOf(env.captured.persisted)).toHaveLength(2)
  })

  it('a scheduled run catches up exactly like a manual one', async () => {
    const { account, item } = operatorScenario()
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })
    const { outcomes } = await runBillRun(
      env.em as never,
      env.container as never,
      params({ asOfDate: asOf, triggeredBy: 'schedule' }),
    )
    expect(cyclesOf(outcomes[0])).toHaveLength(3)
  })

  it('test: writes a TEST draft per cycle and leaves the account untouched', async () => {
    const { account, item } = operatorScenario()
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })

    const { outcomes } = await runBillRun(env.em as never, env.container as never, params({ asOfDate: asOf, mode: 'test' }))

    expect(cyclesOf(outcomes[0]).map((c) => c.status)).toEqual(['invoiced', 'invoiced', 'invoiced'])
    const invoices = invoicesOf(env.captured.persisted)
    expect(invoices).toHaveLength(3)
    expect(invoices.every((i) => i.number.startsWith('TEST-') && i.testRun === true)).toBe(true)
    expect(day(account.nextBillDate)).toBe('2026-11-14')
    expect(item.billedToDate).toBeNull()
    expect(env.numberGenerator.generate).not.toHaveBeenCalled()
  })

  it('dry: previews every cycle and persists no invoice', async () => {
    const { account, item } = operatorScenario()
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })

    const { outcomes } = await runBillRun(env.em as never, env.container as never, params({ asOfDate: asOf, mode: 'dry' }))

    expect(cyclesOf(outcomes[0]).map((c) => [c.status, c.invoice_id])).toEqual([
      ['previewed', null],
      ['previewed', null],
      ['previewed', null],
    ])
    expect(invoicesOf(env.captured.persisted)).toHaveLength(0)
    expect(day(account.nextBillDate)).toBe('2026-11-14')
    expect(item.billedToDate).toBeNull()
  })

  it('test re-run: existing test drafts are skipped per cycle, simulation continues', async () => {
    const { account, item } = operatorScenario()
    const env = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [item]]]),
      openDraftIds: new Map([[account.id, 'test-draft']]),
    })
    const { outcomes } = await runBillRun(env.em as never, env.container as never, params({ asOfDate: asOf, mode: 'test' }))
    expect(outcomes[0].status).toBe('success')
    expect(cyclesOf(outcomes[0]).map((c) => c.status)).toEqual(['skipped_existing', 'skipped_existing', 'skipped_existing'])
    expect(invoicesOf(env.captured.persisted)).toHaveLength(0)
  })

  it('test mode never bills the same usage twice across simulated cycles', async () => {
    const account = makeAccount({ nextBillDate: new Date('2026-06-01T00:00:00Z') })
    const usageItem = {
      ...makeRecurringItem(account.id, 'usage-api'),
      type: 'usage',
      uomCode: 'api_request',
      rateJson: { unit_price: 0.01 },
    } as BillingItem
    const record = {
      id: 'u1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      billAccountId: account.id,
      uomCode: 'api_request',
      quantity: '100.0000',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      ratedInBillRunId: null,
      deletedAt: null,
    } as BillingAccountUsage
    const env = createEnvironment({
      accounts: [account],
      itemsByAccount: new Map([[account.id, [usageItem]]]),
      usageByAccount: new Map([[account.id, [record]]]),
    })

    const { outcomes } = await runBillRun(
      env.em as never,
      env.container as never,
      params({ asOfDate: new Date('2026-08-01T00:00:00Z'), mode: 'test' }),
    )

    expect(cyclesOf(outcomes[0]).map((c) => c.status)).toEqual(['invoiced', 'empty', 'empty'])
    expect(record.ratedInBillRunId).toBeNull()
  })

  it('in advance and in arrears items share one invoice with their own service periods', async () => {
    const account = makeAccount({})
    const advance = makeRecurringItem(account.id, 'adv')
    const arrears = makeRecurringItem(account.id, 'arr', {
      chargeTiming: 'in_arrears',
      billStartDate: new Date('2026-05-01T00:00:00Z'),
    })
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [advance, arrears]]]) })

    const { outcomes } = await runBillRun(env.em as never, env.container as never, params({}))

    const lines = env.captured.persisted.filter((p) => (p as { billingType?: string }).billingType === 'recurring') as Array<{ billingItemId: string; servicePeriodStart: Date; servicePeriodEnd: Date }>
    expect(lines.map((l) => [l.billingItemId, day(l.servicePeriodStart), day(l.servicePeriodEnd)])).toEqual([
      ['adv', '2026-06-01', '2026-06-30'],
      ['arr', '2026-05-01', '2026-05-31'],
    ])
    expect(cyclesOf(outcomes[0])[0]).toMatchObject({ period_start: '2026-05-01', period_end: '2026-06-30' })
  })

  it('an item ended after advance billing gets a credit line (negative total warning)', async () => {
    const account = makeAccount({ nextBillDate: new Date('2026-07-01T00:00:00Z') })
    const item = makeRecurringItem(account.id, 'cancelled', {
      billedToDate: new Date('2026-06-30T00:00:00Z'),
      billEndDate: new Date('2026-06-15T00:00:00Z'),
      rateJson: { unit_price: 30 },
    })
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, [item]]]) })

    const { outcomes } = await runBillRun(
      env.em as never,
      env.container as never,
      params({ asOfDate: new Date('2026-07-01T00:00:00Z') }),
    )

    const line = env.captured.persisted.find((p) => (p as { metadata?: { credit_for?: string } | null }).metadata?.credit_for) as { netAmount: string; description: string }
    expect(line.netAmount).toBe('-15.0000')
    expect(line.description).toBe('MRC · 2026-06-16 – 2026-06-30')
    expect(day(item.billedToDate)).toBe('2026-06-15')
    expect(outcomes[0].status).toBe('success_with_warnings')
    expect((outcomes[0].warnings as { negative_total_bill_dates?: string[] }).negative_total_bill_dates).toEqual(['2026-07-01'])
  })

  it('stops at the hard cap and warns', async () => {
    const account = makeAccount({ nextBillDate: new Date('2020-01-01T00:00:00Z') })
    const env = createEnvironment({ accounts: [account], itemsByAccount: new Map([[account.id, []]]) })
    const { outcomes } = await runBillRun(env.em as never, env.container as never, params({ mode: 'dry' }))
    expect(cyclesOf(outcomes[0])).toHaveLength(60)
    expect((outcomes[0].warnings as { catch_up_cap_reached?: boolean }).catch_up_cap_reached).toBe(true)
    expect(outcomes[0].status).toBe('success_with_warnings')
  })
})
