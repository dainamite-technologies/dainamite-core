import {
  buildPostpaidCreditCrossingEvents,
  getBalanceSnapshot,
  getCreditSnapshot,
} from '../../lib/accountStatus'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const TENANT = 'ten-1'
const ORG = 'org-1'
const ACCT = 'acct-1'

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCT,
    tenantId: TENANT,
    organizationId: ORG,
    currencyCode: 'EUR',
    billingMode: 'prepaid',
    creditLimit: '0',
    ...overrides,
  }
}

describe('getBalanceSnapshot', () => {
  it('reports balance + resolved threshold + status', async () => {
    const em = createPrepaidMockEm({
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '7.0000', lowBalanceThreshold: '10.0000' },
    })
    const snap = await getBalanceSnapshot(em as never, account() as never)
    expect(snap.balance).toBe('7.0000')
    expect(snap.lowBalanceThreshold).toBe('10.0000')
    expect(snap.balanceStatus).toBe('low')
  })
})

describe('getCreditSnapshot — both modes', () => {
  it('prepaid: credit_used = max(0,−balance)', async () => {
    const em = createPrepaidMockEm({
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-30.0000' },
    })
    const snap = await getCreditSnapshot(em as never, account({ creditLimit: '50.0000' }) as never)
    expect(snap.mode).toBe('prepaid')
    expect(snap.creditUsed).toBe('30.0000')
    expect(snap.availableCredit).toBe('20.0000')
    expect(snap.creditStatus).toBe('within_limit')
  })

  it('postpaid: credit_used = Σ posted-unpaid outstanding', async () => {
    const em = createPrepaidMockEm({ postpaidOutstanding: '4200.0000' })
    const snap = await getCreditSnapshot(
      em as never,
      account({ billingMode: 'postpaid', creditLimit: '5000.0000' }) as never,
    )
    expect(snap.mode).toBe('postpaid')
    expect(snap.creditUsed).toBe('4200.0000')
    expect(snap.availableCredit).toBe('800.0000')
    expect(snap.creditStatus).toBe('within_limit')
  })
})

describe('buildPostpaidCreditCrossingEvents', () => {
  it('emits over_limit when a posted invoice pushes outstanding past the limit', async () => {
    // After posting, total outstanding 5200; this invoice contributed 300 →
    // before 4900 (under 5000), after 5200 (over) → crossing.
    const em = createPrepaidMockEm({ postpaidOutstanding: '5200.0000' })
    const events = await buildPostpaidCreditCrossingEvents(
      em as never,
      account({ billingMode: 'postpaid', creditLimit: '5000.0000' }) as never,
      '300.0000',
    )
    expect(events.map((e) => e.id)).toContain('billing.credit.over_limit')
  })

  it('no event when still under the limit', async () => {
    const em = createPrepaidMockEm({ postpaidOutstanding: '4800.0000' })
    const events = await buildPostpaidCreditCrossingEvents(
      em as never,
      account({ billingMode: 'postpaid', creditLimit: '5000.0000' }) as never,
      '300.0000',
    )
    expect(events).toHaveLength(0)
  })

  it('no event for a prepaid account (handled on the consume path)', async () => {
    const em = createPrepaidMockEm({ postpaidOutstanding: '9999.0000' })
    const events = await buildPostpaidCreditCrossingEvents(
      em as never,
      account({ billingMode: 'prepaid', creditLimit: '5000.0000' }) as never,
      '300.0000',
    )
    expect(events).toHaveLength(0)
  })
})
