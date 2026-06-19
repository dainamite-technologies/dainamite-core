import {
  computeAvailableCredit,
  computeCreditSnapshot,
  computeCreditStatus,
  computeCreditUsed,
  detectCreditCrossing,
  prepaidCreditUsed,
} from '../../lib/creditStatus'

describe('creditStatus — credit_used per mode', () => {
  it('prepaid: max(0, −balance)', () => {
    expect(prepaidCreditUsed('100.0000')).toBe('0.0000')
    expect(prepaidCreditUsed('0.0000')).toBe('0.0000')
    expect(prepaidCreditUsed('-30.0000')).toBe('30.0000')
    expect(computeCreditUsed('prepaid', { balance: '-12.5000' })).toBe('12.5000')
  })

  it('postpaid: Σ outstanding', () => {
    expect(computeCreditUsed('postpaid', { outstanding: '4200.0000' })).toBe('4200.0000')
    expect(computeCreditUsed('postpaid', { outstanding: null })).toBe('0.0000')
  })

  it('available = limit − used (both modes)', () => {
    expect(computeAvailableCredit('5000.0000', '4200.0000')).toBe('800.0000')
    expect(computeAvailableCredit('50.0000', '53.0000')).toBe('-3.0000')
  })
})

describe('creditStatus — status thresholds', () => {
  it('within / near / over', () => {
    expect(computeCreditStatus('800.0000', '0')).toBe('within_limit')
    expect(computeCreditStatus('100.0000', '100.0000')).toBe('near_limit')
    expect(computeCreditStatus('50.0000', '100.0000')).toBe('near_limit')
    expect(computeCreditStatus('0.0000', '100.0000')).toBe('over_limit')
    expect(computeCreditStatus('-3.0000', '0')).toBe('over_limit')
  })

  it('prepaid snapshot: exhausted funds but within credit line', () => {
    // balance -3, credit_limit 50 → used 3, available 47, within_limit.
    const snap = computeCreditSnapshot({
      mode: 'prepaid',
      creditLimit: '50.0000',
      nearLimitBuffer: '0',
      balance: '-3.0000',
    })
    expect(snap).toEqual({
      mode: 'prepaid',
      creditLimit: '50.0000',
      creditUsed: '3.0000',
      availableCredit: '47.0000',
      creditStatus: 'within_limit',
    })
  })

  it('postpaid snapshot from outstanding', () => {
    const snap = computeCreditSnapshot({
      mode: 'postpaid',
      creditLimit: '5000.0000',
      nearLimitBuffer: '1000.0000',
      outstanding: '4200.0000',
    })
    expect(snap.creditUsed).toBe('4200.0000')
    expect(snap.availableCredit).toBe('800.0000')
    expect(snap.creditStatus).toBe('near_limit')
  })
})

describe('creditStatus — over_limit upward crossing', () => {
  it('fires once when used crosses the limit (prepaid balance below −limit)', () => {
    // limit 50: balance -45 → used 45 (under); balance -55 → used 55 (over).
    expect(
      detectCreditCrossing({
        creditLimit: '50.0000',
        nearLimitBuffer: '0',
        usedBefore: '45.0000',
        usedAfter: '55.0000',
      }).overLimitCrossedUp,
    ).toBe(true)
    // Already over — no re-fire.
    expect(
      detectCreditCrossing({
        creditLimit: '50.0000',
        nearLimitBuffer: '0',
        usedBefore: '55.0000',
        usedAfter: '60.0000',
      }).overLimitCrossedUp,
    ).toBe(false)
  })

  it('no crossing when there is no credit line (limit 0)', () => {
    expect(
      detectCreditCrossing({
        creditLimit: '0',
        nearLimitBuffer: '0',
        usedBefore: '0.0000',
        usedAfter: '5.0000',
      }),
    ).toEqual({ overLimitCrossedUp: false, nearLimitCrossedUp: false })
  })

  it('near_limit crossing into the buffer band', () => {
    expect(
      detectCreditCrossing({
        creditLimit: '100.0000',
        nearLimitBuffer: '20.0000',
        usedBefore: '70.0000', // available 30
        usedAfter: '85.0000', // available 15 → near
      }).nearLimitCrossedUp,
    ).toBe(true)
  })
})
