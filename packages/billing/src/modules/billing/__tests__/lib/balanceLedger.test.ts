import {
  applyBalanceMovement,
  reconcileAccountBalance,
} from '../../lib/balanceLedger'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const SCOPE = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '11111111-1111-4111-8111-111111111111',
  billAccountId: '33333333-3333-4333-8333-333333333333',
  currencyCode: 'EUR',
}

function newEm() {
  return createPrepaidMockEm({
    balance: { tenantId: SCOPE.tenantId, billAccountId: SCOPE.billAccountId, balance: '0.0000' },
  })
}

describe('balanceLedger — applyBalanceMovement', () => {
  it('credits and debits, snapshotting balance_after', async () => {
    const em = newEm()
    const credit = await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'topup',
      amount: '100.0000',
      description: 'Top-up',
    })
    expect(credit.balanceBefore).toBe('0.0000')
    expect(credit.balanceAfter).toBe('100.0000')
    expect(credit.transaction.balanceAfter).toBe('100.0000')

    const debit = await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'usage',
      amount: '-12.3400',
      description: 'API requests',
    })
    expect(debit.balanceBefore).toBe('100.0000')
    expect(debit.balanceAfter).toBe('87.6600')
    expect(em.transactions).toHaveLength(2)
  })

  it('allows the balance to go negative (usage is never rejected)', async () => {
    const em = newEm()
    await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'topup',
      amount: '5.0000',
      description: 'Top-up',
    })
    const debit = await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'usage',
      amount: '-8.0000',
      description: 'Overspend',
    })
    expect(debit.balanceAfter).toBe('-3.0000')
  })

  it('is idempotent on sourceRef — no double-move', async () => {
    const em = newEm()
    const first = await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'recurring',
      amount: '-20.0000',
      description: 'Platform fee',
      sourceRef: 'recurring-item-2026-05-31',
    })
    expect(first.deduplicated).toBe(false)
    expect(first.balanceAfter).toBe('-20.0000')

    const retry = await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'recurring',
      amount: '-20.0000',
      description: 'Platform fee',
      sourceRef: 'recurring-item-2026-05-31',
    })
    expect(retry.deduplicated).toBe(true)
    expect(retry.balanceAfter).toBe('-20.0000') // unchanged
    expect(em.transactions).toHaveLength(1) // no second transaction
  })
})

describe('balanceLedger — reconciliation invariant', () => {
  it('balance == SUM(amount) == latest.balance_after after a sequence', async () => {
    const em = newEm()
    const moves: Array<{ type: 'topup' | 'usage' | 'recurring'; amount: string }> = [
      { type: 'topup', amount: '100.0000' },
      { type: 'usage', amount: '-5.0000' },
      { type: 'usage', amount: '-3.0000' },
      { type: 'recurring', amount: '-20.0000' },
    ]
    for (const m of moves) {
      await applyBalanceMovement(em as never, { ...SCOPE, ...m, description: m.type })
    }
    const recon = await reconcileAccountBalance(em as never, SCOPE)
    expect(recon.cachedBalance).toBe('72.0000')
    expect(recon.sumOfAmounts).toBe('72.0000')
    expect(recon.latestBalanceAfter).toBe('72.0000')
    expect(recon.reconciled).toBe(true)
  })

  it('holds across many small sub-cent debits (no FP drift)', async () => {
    const em = newEm()
    await applyBalanceMovement(em as never, {
      ...SCOPE,
      type: 'topup',
      amount: '1.0000',
      description: 'Top-up',
    })
    for (let i = 0; i < 100; i++) {
      await applyBalanceMovement(em as never, {
        ...SCOPE,
        type: 'usage',
        amount: '-0.0010',
        description: 'micro',
      })
    }
    const recon = await reconcileAccountBalance(em as never, SCOPE)
    expect(recon.cachedBalance).toBe('0.9000')
    expect(recon.reconciled).toBe(true)
  })
})
