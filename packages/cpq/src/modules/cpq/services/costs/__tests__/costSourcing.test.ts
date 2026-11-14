import {
  REQUEST_HISTORY_CAP, appendRequestHistory, buildHistoryEntry, classifyAnswer, costLineEligibility, declineEffect,
  formatAmount4, hashAnswer, isRequestOverdue, normalizeAnswer, shouldAutoOpenRequest, sourcingStateViolations,
  workingDaysBetween, type AnswerClassificationInput, type AutoOpenInput, type SupplierAnswer,
} from '../costSourcing'

const frozenAmend = { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true }
const reconfiguredMirror = { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true }
const frozenRenew = { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostPlusFrozen: true }

describe('costLineEligibility (Q14)', () => {
  const catalog = { origin: 'catalog', role: 'price_basis' }
  it.each([
    ['plain add line', { action: 'add', configuration: {} }, catalog, 'quote', true],
    ['Amend removal (Cancel line)', { action: 'cancel', configuration: frozenAmend }, catalog, 'amend', false],
    ['Renew removal', { action: 'cancel', configuration: frozenRenew }, catalog, 'renew', false],
    ['Cancel quote line', { action: 'cancel', configuration: frozenAmend }, catalog, 'cancel', false],
    ['frozen Amend mirror price-basis catalog cost', { action: 'modify', configuration: frozenAmend }, catalog, 'amend', false],
    ['frozen cost-plus Renew mirror price-basis manual cost', { action: 'modify', configuration: frozenRenew }, { origin: 'manual', role: 'price_basis' }, 'renew', false],
    ['frozen mirror margin-only cost', { action: 'modify', configuration: frozenAmend }, { origin: 'catalog', role: 'margin_only' }, 'amend', true],
    ['carried cost on a frozen Renew mirror (R13)', { action: 'modify', configuration: frozenRenew }, { origin: 'carried', role: 'price_basis' }, 'renew', true],
    ['carried cost on a frozen Amend mirror', { action: 'modify', configuration: frozenAmend }, { origin: 'carried', role: 'price_basis' }, 'amend', true],
    ['reconfigured mirror (no frozen flag)', { action: 'modify', configuration: reconfiguredMirror }, catalog, 'amend', true],
    ['Renew mirror without the cost-plus frozen marker', { action: 'modify', configuration: { _arcMirroredFromItemId: 'i', _arcPriceFrozen: true } }, catalog, 'renew', true],
  ])('%s', (_name, line, cost, quoteType, eligible) => {
    expect(costLineEligibility(line, cost, quoteType).eligible).toBe(eligible)
  })

  it('names the reason', () => {
    expect(costLineEligibility({ action: 'cancel' }, catalog, 'amend')).toEqual({ eligible: false, reason: 'CANCEL_LINE' })
    expect(costLineEligibility({ action: 'modify', configuration: frozenAmend }, catalog, 'amend')).toEqual({ eligible: false, reason: 'FROZEN_UNPRICEABLE' })
  })
})

describe('shouldAutoOpenRequest (Q12)', () => {
  const base: AutoOpenInput = {
    enabled: true, saved: true, locked: false, quoteType: 'quote', line: { action: 'add', configuration: {} },
    cost: { origin: 'catalog', role: 'price_basis', source: 'on_request', valueStatus: 'none', sourcingStatus: 'not_requested' },
    requiresSourcing: true,
  }
  const withCost = (cost: Partial<AutoOpenInput['cost']>): AutoOpenInput => ({ ...base, cost: { ...base.cost, ...cost } })
  it.each<[string, AutoOpenInput, boolean]>([
    ['happy path', base, true],
    ['estimated value still opens', withCost({ valueStatus: 'estimated' }), true],
    ['preview', { ...base, saved: false }, false],
    ['locked quote', { ...base, locked: true }, false],
    ['toggle off', { ...base, enabled: false }, false],
    ['element without requires_sourcing', { ...base, requiresSourcing: false }, false],
    ['fixed source', withCost({ source: 'fixed' }), false],
    ['confirmed value', withCost({ valueStatus: 'confirmed' }), false],
    ['already requested', withCost({ sourcingStatus: 'requested' }), false],
    ['answered earlier', withCost({ sourcingStatus: 'answered' }), false],
    ['declined earlier is never re-opened', withCost({ sourcingStatus: 'declined' }), false],
    ['cancelled earlier is never re-opened', withCost({ sourcingStatus: 'cancelled' }), false],
    ['just reset by R1b re-opens a requested line', { ...withCost({ sourcingStatus: 'requested' }), resetByReconfiguration: true }, true],
    ['just reset re-opens a cancelled line', { ...withCost({ sourcingStatus: 'cancelled' }), resetByReconfiguration: true }, true],
    ['unreconfigured mirror', { ...base, quoteType: 'amend', line: { action: 'modify', configuration: { _arcMirroredFromItemId: 'i' } } }, false],
    ['reconfigured mirror', { ...base, quoteType: 'amend', line: { action: 'modify', configuration: reconfiguredMirror } }, true],
    ['Cancel line', { ...base, quoteType: 'amend', line: { action: 'cancel', configuration: reconfiguredMirror } }, false],
    ['reset never overrides the locked quote', { ...base, locked: true, resetByReconfiguration: true }, false],
  ])('%s', (_name, input, expected) => {
    expect(shouldAutoOpenRequest(input)).toBe(expected)
  })
})

describe('answer normalization and hash (Q9)', () => {
  const answer: SupplierAnswer = {
    costRequestId: 'req-1', unitAmount: 280, currencyCode: 'eur', valueStatus: 'confirmed', supplierQuoteRef: ' CARR-889 ',
    supplierId: 's-1', supplierName: ' Carrier ', validUntil: '2026-12-31', supplierTermEnd: '2028-12-31', supplierMinTermMonths: 24, note: ' ok ',
  }
  it('normalizes strings, currency, amounts and dates', () => {
    expect(normalizeAnswer({ ...answer, validUntil: new Date('2026-12-31T10:00:00Z'), supplierTermEnd: '2028-12-31T00:00:00.000Z' })).toEqual({
      costRequestId: 'req-1', unitAmount: '280.0000', currencyCode: 'EUR', valueStatus: 'confirmed', supplierQuoteRef: 'CARR-889',
      supplierId: 's-1', supplierName: 'Carrier', validUntil: '2026-12-31', supplierTermEnd: '2028-12-31', supplierMinTermMonths: 24, note: 'ok',
    })
  })
  it('defaults the value status to confirmed and blanks to null', () => {
    expect(normalizeAnswer({ costRequestId: 'r', unitAmount: 1, currencyCode: 'EUR', supplierQuoteRef: 'x', note: '  ', supplierName: '' }))
      .toMatchObject({ valueStatus: 'confirmed', note: null, supplierName: null, supplierId: null, validUntil: null, supplierMinTermMonths: null })
  })
  it('hashes to 64 hex characters', () => {
    expect(hashAnswer(answer)).toMatch(/^[0-9a-f]{64}$/)
  })
  it.each([
    ['key order', Object.fromEntries(Object.entries(answer).reverse()) as unknown as SupplierAnswer],
    ['number formatting (string 4dp)', { ...answer, unitAmount: '280.0000' }],
    ['number formatting (string 1dp)', { ...answer, unitAmount: '280.0' }],
    ['currency case and whitespace', { ...answer, currencyCode: ' EUR ' }],
    ['date as Date', { ...answer, validUntil: new Date('2026-12-31T00:00:00Z') }],
    ['trimmed strings', { ...answer, supplierQuoteRef: 'CARR-889', supplierName: 'Carrier', note: 'ok' }],
    ['omitted status', { ...answer, valueStatus: undefined }],
  ])('is stable under %s', (_name, variant) => {
    expect(hashAnswer(variant)).toBe(hashAnswer(answer))
  })
  it.each([
    ['costRequestId', { costRequestId: 'req-2' }],
    ['amount', { unitAmount: 295 }],
    ['currency', { currencyCode: 'USD' }],
    ['status', { valueStatus: 'estimated' }],
    ['ref', { supplierQuoteRef: 'CARR-890' }],
    ['validity', { validUntil: '2027-01-01' }],
    ['min term', { supplierMinTermMonths: 12 }],
    ['note', { note: 'changed' }],
    ['supplier', { supplierId: 's-2' }],
  ])('changes with %s', (_name, patch) => {
    expect(hashAnswer({ ...answer, ...patch })).not.toBe(hashAnswer(answer))
  })
  it('formats amounts to 4 dp and rejects non-numbers', () => {
    expect(formatAmount4('1.23456')).toBe('1.2346')
    expect(formatAmount4(-0)).toBe('0.0000')
    expect(() => formatAmount4('abc')).toThrow('Invalid amount')
  })
})

describe('classifyAnswer (defined check order)', () => {
  const answer: SupplierAnswer = { costRequestId: 'req-1', unitAmount: 280, currencyCode: 'EUR', supplierQuoteRef: 'CARR-889' }
  const open = (over: Partial<AnswerClassificationInput['cost']> = {}): AnswerClassificationInput['cost'] => ({
    sourcingStatus: 'requested', costRequestId: 'req-1', lastAnswerHash: null, supplierQuoteRef: null, unitAmount: '276.0000', currencyCode: 'EUR', ...over,
  })
  const input = (over: Omit<Partial<AnswerClassificationInput>, 'cost'> & { cost?: Partial<AnswerClassificationInput['cost']> } = {}): AnswerClassificationInput => ({
    answer, elementActive: true, locked: false, ...over, cost: open(over.cost),
  })
  const stored = { lastAnswerHash: hashAnswer(answer), supplierQuoteRef: 'CARR-889', sourcingStatus: 'answered' }

  it.each<[string, AnswerClassificationInput, string]>([
    ['unlocked open request is applied', input(), 'applied'],
    ['locked with the same amount and currency confirms', input({ locked: true, cost: { unitAmount: '280.0000' } }), 'confirmed_unchanged'],
    ['locked with the same amount in another currency is a proposal', input({ locked: true, cost: { unitAmount: '280', currencyCode: 'USD' } }), 'proposed'],
    ['locked with a different amount is a proposal', input({ locked: true }), 'proposed'],
    ['locked without a value is a proposal', input({ locked: true, cost: { unitAmount: null, currencyCode: null } }), 'proposed'],
    ['locked margin-only cost is lock-exempt (R11): a different value is applied', input({ locked: true, cost: { role: 'margin_only' } }), 'applied'],
    ['locked price-basis cost with an explicit role is a proposal', input({ locked: true, cost: { role: 'price_basis' } }), 'proposed'],
    ['stale request id', input({ cost: { costRequestId: 'req-2' } }), 'superseded'],
    ['no request id at all', input({ cost: { costRequestId: null } }), 'superseded'],
    ['inactive element', input({ elementActive: false }), 'superseded'],
    ['stale id beats a same-ref same-hash retry (never 200)', input({ cost: { ...stored, costRequestId: 'req-2' } }), 'superseded'],
    ['inactive element beats the idempotent retry', input({ elementActive: false, cost: stored }), 'superseded'],
    ['same ref + same hash is a no-op', input({ cost: stored }), 'noop'],
    ['no-op also on a locked quote', input({ locked: true, cost: stored }), 'noop'],
    ['same ref + different hash conflicts', input({ answer: { ...answer, unitAmount: 295 }, cost: stored }), 'conflict'],
    ['conflict beats not_open', input({ answer: { ...answer, unitAmount: 295 }, cost: { ...stored, sourcingStatus: 'declined' } }), 'conflict'],
    ['stored proposal ref is compared (locked proposal)', input({ cost: { sourcingStatus: 'answered', lastAnswerHash: hashAnswer(answer), supplierQuoteRef: 'OLD', proposedAnswer: { supplierQuoteRef: 'CARR-889' } } }), 'noop'],
    ['declined request is not open', input({ cost: { sourcingStatus: 'declined' } }), 'not_open'],
    ['cancelled request is not open', input({ cost: { sourcingStatus: 'cancelled' } }), 'not_open'],
    ['answered request with a new ref is not open', input({ cost: { ...stored, supplierQuoteRef: 'OTHER' } }), 'not_open'],
    ['a ref reused after a re-request (hash cleared) is applied, not a conflict', input({ cost: { supplierQuoteRef: 'CARR-889', lastAnswerHash: null } }), 'applied'],
  ])('%s', (_name, value, expected) => {
    expect(classifyAnswer(value)).toBe(expected)
  })
})

describe('declineEffect (Q3)', () => {
  it('unlocked: clears the value and moves the estimate into the note', () => {
    expect(declineEffect({ unitAmount: '300.0000', valueStatus: 'estimated', note: null }, false))
      .toEqual({ valueStatus: 'none', clearAmount: true, note: 'estimate 300 discarded: declined' })
  })
  it('unlocked: appends to an existing note and caps at 500', () => {
    expect(declineEffect({ unitAmount: '300.5000', valueStatus: 'estimated', note: 'site A' }, false).note).toBe('site A | estimate 300.5 discarded: declined')
    expect(declineEffect({ unitAmount: '1', valueStatus: 'estimated', note: 'x'.repeat(600) }, false).note).toHaveLength(500)
  })
  it('unlocked without an estimate keeps the note', () => {
    expect(declineEffect({ unitAmount: null, valueStatus: 'none', note: 'n' }, false)).toEqual({ valueStatus: 'none', clearAmount: false, note: 'n' })
  })
  it('locked: keeps the amount and downgrades to estimated', () => {
    expect(declineEffect({ unitAmount: '276.0000', valueStatus: 'confirmed', note: 'n' }, true))
      .toEqual({ valueStatus: 'estimated', clearAmount: false, note: 'n' })
    expect(declineEffect({ unitAmount: null, valueStatus: 'none', note: null }, true).valueStatus).toBe('none')
  })
  it('locked margin-only cost is lock-exempt (R11): the unlocked rule applies', () => {
    expect(declineEffect({ unitAmount: '1500.0000', valueStatus: 'estimated', note: null, role: 'margin_only' }, true))
      .toEqual({ valueStatus: 'none', clearAmount: true, note: 'estimate 1500 discarded: declined' })
  })
})

describe('request history (Q1)', () => {
  const closedAt = new Date('2026-11-14T10:00:00Z')
  const cost = {
    costRequestId: 'req-1', requestSeq: 2, requestedAt: new Date('2026-11-10T09:00:00Z'), requestedByUserId: 'u1',
    requestSupplierId: 's-target', supplierId: 's-answer', supplierQuoteRef: 'CARR-889', declineReason: 'No coverage',
  }
  it('builds entries without amounts', () => {
    const answered = buildHistoryEntry({ cost, outcome: 'answered', closedAt, closedByUserId: 'u2' })!
    expect(answered).toEqual({
      costRequestId: 'req-1', requestSeq: 2, requestedAt: '2026-11-10T09:00:00.000Z', requestedByUserId: 'u1',
      closedAt: '2026-11-14T10:00:00.000Z', closedByUserId: 'u2', outcome: 'answered', supplierId: 's-answer', supplierQuoteRef: 'CARR-889',
    })
    expect(buildHistoryEntry({ cost, outcome: 'declined', closedAt, closedByUserId: 'u2' })).toMatchObject({ declineReason: 'No coverage', supplierId: 's-target' })
    expect(buildHistoryEntry({ cost, outcome: 'cancelled', closedAt, closedByUserId: null, reason: 're_requested' }))
      .toMatchObject({ outcome: 'cancelled', reason: 're_requested', closedByUserId: null })
    for (const outcome of ['answered', 'declined', 'cancelled'] as const) {
      expect(JSON.stringify(buildHistoryEntry({ cost: { ...cost, unitAmount: '7777.77' } as never, outcome, closedAt, closedByUserId: null }))).not.toContain('7777')
    }
  })
  it('returns null when there is no request to close', () => {
    expect(buildHistoryEntry({ cost: { ...cost, costRequestId: null }, outcome: 'cancelled', closedAt, closedByUserId: null })).toBeNull()
  })
  it('appends newest last without mutating, and drops the oldest beyond the cap', () => {
    const history = Array.from({ length: REQUEST_HISTORY_CAP }, (_, index) => ({ n: index }))
    const next = appendRequestHistory(history, { n: 50 })
    expect(history).toHaveLength(REQUEST_HISTORY_CAP)
    expect(next).toHaveLength(REQUEST_HISTORY_CAP)
    expect(next[0]).toEqual({ n: 1 })
    expect(next[next.length - 1]).toEqual({ n: 50 })
    expect(appendRequestHistory(null, { n: 0 })).toEqual([{ n: 0 }])
    expect(appendRequestHistory([{ n: 0 }], { n: 1 }, 1)).toEqual([{ n: 1 }])
  })
})

describe('working days (Q10)', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`)
  // 2026-11-09 is a Monday.
  it.each([
    ['Mon -> same day', '2026-11-09', '2026-11-09', 0],
    ['Mon -> Tue', '2026-11-09', '2026-11-10', 1],
    ['Mon -> next Monday', '2026-11-09', '2026-11-16', 5],
    ['Mon -> following Tuesday (6)', '2026-11-09', '2026-11-17', 6],
    ['Fri -> following Tuesday (2)', '2026-11-13', '2026-11-17', 2],
    ['Fri -> Sat', '2026-11-13', '2026-11-14', 0],
    ['Sat -> Sun', '2026-11-14', '2026-11-15', 0],
    ['Sat -> Mon', '2026-11-14', '2026-11-16', 1],
    ['clock goes backwards', '2026-11-16', '2026-11-09', 0],
  ])('%s', (_name, from, to, expected) => {
    expect(workingDaysBetween(day(from), day(to))).toBe(expected)
  })
  it('counts UTC calendar days regardless of time of day', () => {
    expect(workingDaysBetween(new Date('2026-11-09T23:59:00Z'), new Date('2026-11-10T00:01:00Z'))).toBe(1)
  })
  it('the spec scenario: Monday request overdue on the following Tuesday, Friday request not', () => {
    const tuesday = day('2026-11-17')
    expect(isRequestOverdue(workingDaysBetween(day('2026-11-09'), tuesday), 5)).toBe(true)
    expect(isRequestOverdue(workingDaysBetween(day('2026-11-13'), tuesday), 5)).toBe(false)
    expect(isRequestOverdue(5, 5)).toBe(false)
  })
})

describe('sourcingStateViolations', () => {
  const ok = { sourcingStatus: 'not_requested', costRequestId: null, requestedAt: null, answeredAt: null, declineReason: null, proposedAmount: null }
  it.each([
    ['clean idle', ok, []],
    ['requested ok', { ...ok, sourcingStatus: 'requested', costRequestId: 'r', requestedAt: new Date() }, []],
    ['requested without id', { ...ok, sourcingStatus: 'requested', requestedAt: new Date() }, ['requested_needs_request_id_and_requested_at']],
    ['answered without answeredAt', { ...ok, sourcingStatus: 'answered' }, ['closed_needs_answered_at']],
    ['declined without reason', { ...ok, sourcingStatus: 'declined', answeredAt: new Date() }, ['declined_needs_reason']],
    ['proposal on a requested line', { ...ok, sourcingStatus: 'requested', costRequestId: 'r', requestedAt: new Date(), proposedAmount: '1' }, ['proposal_needs_answered_status']],
    ['proposal on an answered line', { ...ok, sourcingStatus: 'answered', answeredAt: new Date(), proposedAmount: '1' }, []],
  ])('%s', (_name, cost, expected) => {
    expect(sourcingStateViolations(cost)).toEqual(expected)
  })
})
