/**
 * In-memory mock EntityManager for the prepaid ledger libs (SPEC-002).
 *
 * Models the subset of operations `balanceLedger` / `prepaidConsume` /
 * `accountStatus` touch: the raw `INSERT … ON CONFLICT` + `UPDATE … RETURNING`
 * balance statements, the `SUM(amount)` reconciliation query, the postpaid
 * `SUM(outstanding_amount)` query, plus findOne/find/create/persist/flush.
 *
 * The balance math reuses the real `money` helpers so the mock's rounding
 * matches production exactly — that is the whole point of the reconciliation
 * tests.
 */

import { addMoney } from '../../lib/money'

type Row = Record<string, unknown>

export type MockEmOptions = {
  account?: Row | null
  /** Pre-seed the balance row: { tenantId, billAccountId, balance, lowBalanceThreshold? }. */
  balance?: Row | null
  /** The active type=usage item returned by findUsageItem (or null). */
  usageItem?: Row | null
  /** An existing usage record returned for a matching sourceRef (dedup tests). */
  existingUsage?: Row | null
  /** A BillingTopup returned by findOne (capture tests). */
  topup?: Row | null
  /** Billing items returned by find(BillingItem) (period-close tests). */
  items?: Row[]
  /** An existing BillingStatement for the SAME period returned by findOne (anti-dup tests). */
  existingStatement?: Row | null
  /** A PRIOR BillingStatement (periodEnd < periodStart) for opening-chaining tests. */
  priorStatement?: Row | null
  /** Module config values keyed by name (e.g. { 'prepaid.topup_tax_rate': 23 }). */
  configs?: Record<string, unknown>
  /** Postpaid outstanding total returned by the SUM(outstanding_amount) query. */
  postpaidOutstanding?: string | number
}

export type MockEm = {
  // stores
  transactions: Row[]
  usages: Row[]
  balances: Map<string, Row>
  persisted: Row[]
  // jest mocks
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  execute: jest.Mock
  nativeUpdate: jest.Mock
  transactional: jest.Mock
  fork: () => MockEm
}

function key(tenantId: unknown, billAccountId: unknown): string {
  return `${tenantId}:${billAccountId}`
}

export function createPrepaidMockEm(options: MockEmOptions = {}): MockEm {
  let idCounter = 0
  const transactions: Row[] = []
  const usages: Row[] = []
  const persisted: Row[] = []
  const balances = new Map<string, Row>()
  if (options.balance) {
    balances.set(key(options.balance.tenantId, options.balance.billAccountId), {
      balance: '0.0000',
      lowBalanceThreshold: null,
      lastMovementAt: null,
      ...options.balance,
    })
  }
  if (options.existingUsage) usages.push(options.existingUsage)

  const em = {
    transactions,
    usages,
    balances,
    persisted,
  } as MockEm

  em.create = jest.fn((entity: unknown, data: Row) => {
    const ctor = (entity as { name?: string }).name ?? ''
    idCounter += 1
    const created = { ...data, id: (data.id as string) ?? `gen-${ctor}-${idCounter}` }
    if (ctor === 'BillingAccountTransaction') transactions.push(created)
    else if (ctor === 'BillingAccountUsage') usages.push(created)
    else if (ctor === 'BillingAccountBalance') {
      balances.set(key(created.tenantId, created.billAccountId), created)
    }
    return created
  }) as never

  em.persist = jest.fn((entity: Row) => {
    persisted.push(entity)
  }) as never

  em.flush = jest.fn(async () => undefined) as never

  em.findOne = jest.fn(async (entity: unknown, where: Row, opts?: { orderBy?: Row }) => {
    const ctor = (entity as { name?: string }).name ?? ''
    if (ctor === 'BillingAccount') return options.account ?? null
    if (ctor === 'BillingAccountBalance') {
      return balances.get(key(where.tenantId, where.billAccountId)) ?? null
    }
    if (ctor === 'BillingAccountUsage') {
      return (
        usages.find(
          (u) =>
            (where.sourceRef === undefined || u.sourceRef === where.sourceRef) &&
            (where.id === undefined || u.id === where.id) &&
            (where.billAccountId === undefined || u.billAccountId === where.billAccountId),
        ) ?? null
      )
    }
    if (ctor === 'BillingAccountTransaction') {
      const matches = transactions.filter(
        (t) =>
          (where.sourceRef === undefined || t.sourceRef === where.sourceRef) &&
          (where.usageId === undefined || t.usageId === where.usageId) &&
          (where.billAccountId === undefined || t.billAccountId === where.billAccountId),
      )
      // Insertion order IS chronological in this mock, so the last inserted
      // matching row is the most recent — correct for both a key lookup and
      // an `orderBy: { createdAt: 'DESC' }` "latest transaction" query (real
      // millisecond timestamps can collide and break a createdAt sort).
      void opts
      return matches[matches.length - 1] ?? null
    }
    if (ctor === 'BillingItem') {
      const item = options.usageItem
      if (!item) return null
      if (where.uomCode !== undefined && item.uomCode !== where.uomCode) return null
      return item
    }
    if (ctor === 'BillingTopup') return options.topup ?? null
    if (ctor === 'BillingStatement') {
      // A `periodEnd: { $lt }` range query is the prior-statement (opening
      // chaining) lookup; an exact period match is the anti-duplicate check.
      const pe = where.periodEnd as { $lt?: unknown } | undefined
      if (pe && typeof pe === 'object' && '$lt' in pe) {
        return options.priorStatement ?? null
      }
      return options.existingStatement ?? null
    }
    // resolveInvoiceStatusEntryId looks up Dictionary then DictionaryEntry.
    if (ctor === 'Dictionary') return { id: 'dict-invoice-status' }
    if (ctor === 'DictionaryEntry') return { id: `status-${(where.value as string) ?? 'x'}` }
    if (ctor === 'ModuleConfig') {
      const name = where.name as string
      const configs = options.configs ?? {}
      if (name in configs) return { moduleId: 'billing', name, valueJson: configs[name] }
      return null
    }
    return null
  }) as never

  em.find = jest.fn(async (entity: unknown) => {
    const ctor = (entity as { name?: string }).name ?? ''
    if (ctor === 'BillingItem') return options.items ?? []
    return []
  }) as never

  em.execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO billing_account_balances')) {
      // params: [org, tenant, acct, ccy, now, now]
      const [organizationId, tenantId, billAccountId, currencyCode] = params as string[]
      const k = key(tenantId, billAccountId)
      if (!balances.has(k)) {
        balances.set(k, {
          organizationId,
          tenantId,
          billAccountId,
          currencyCode,
          balance: '0.0000',
          lowBalanceThreshold: null,
          lastMovementAt: null,
        })
      }
      return []
    }
    if (sql.includes('UPDATE billing_account_balances')) {
      // params: [amount, now, now, tenant, acct]
      const amount = params[0] as string
      const tenantId = params[3]
      const billAccountId = params[4]
      const k = key(tenantId, billAccountId)
      const row = balances.get(k)
      if (!row) return []
      row.balance = addMoney((row.balance as string) ?? '0', amount)
      row.lastMovementAt = params[1] as Date
      return [{ balance: row.balance }]
    }
    if (sql.includes('SUM(amount)') && sql.includes('billing_account_transactions')) {
      // sumByTypeInWindow: params [tenant, org, acct, type, from, to]
      if (sql.includes('type = ?') && sql.includes('created_at >= ?')) {
        const type = params[3] as string
        const from = new Date(params[4] as string).getTime()
        const to = new Date(params[5] as string).getTime()
        const total = transactions
          .filter((t) => {
            if (t.type !== type || !t.createdAt) return false
            const ts = new Date(t.createdAt as Date).getTime()
            return ts >= from && ts < to
          })
          .reduce((acc, t) => addMoney(acc, (t.amount as string) ?? '0'), '0')
        return [{ total }]
      }
      // sumAmountsBefore: params [tenant, org, acct, before]
      if (sql.includes('created_at < ?')) {
        const before = new Date(params[3] as string).getTime()
        const total = transactions
          .filter((t) => t.createdAt && new Date(t.createdAt as Date).getTime() < before)
          .reduce((acc, t) => addMoney(acc, (t.amount as string) ?? '0'), '0')
        return [{ total }]
      }
      // reconcile (whole ledger)
      const sum = transactions.reduce((acc, t) => addMoney(acc, (t.amount as string) ?? '0'), '0')
      return [{ sum_amount: sum }]
    }
    if (sql.includes('SUM(outstanding_amount)')) {
      return [{ total: String(options.postpaidOutstanding ?? '0') }]
    }
    return []
  }) as never

  em.nativeUpdate = jest.fn(async () => 0) as never
  em.transactional = jest.fn(async (cb: (tem: MockEm) => unknown) => cb(em)) as never
  em.fork = () => em

  return em
}
