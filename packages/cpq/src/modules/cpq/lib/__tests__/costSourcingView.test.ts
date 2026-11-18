import {
  answerFormIssues,
  applyConfirmation,
  attributePairs,
  buildAnswerBody,
  buildCostRequestParams,
  buildDeclineBody,
  classifySourcingError,
  declineIssues,
  emptyAnswerForm,
  formatCostAmount,
  historyRows,
  isSourcingClosed,
  queueRowActions,
  sourcingActions,
  sourcingBadges,
  sourcingPermissions,
  type AnswerForm,
  type SourcingPermissions,
} from '../costSourcingView'

const SUPPLIER = '11111111-1111-4111-8111-111111111111'
const QUOTE = '22222222-2222-4222-8222-222222222222'
const params = (values: Record<string, unknown>) => { const p = new URLSearchParams(); buildCostRequestParams(values, p); return Object.fromEntries(p) }

describe('buildCostRequestParams', () => {
  it('defaults to the open queue', () => {
    expect(params({})).toEqual({ status: 'requested' })
  })
  it('maps the Closed by conversion preset to cancelled + quote_closed', () => {
    expect(params({ status: 'closed_by_conversion', cancelReason: 'reconfigured' })).toEqual({ status: 'cancelled', cancelReason: 'quote_closed' })
  })
  it('sends the cancel reason only for Cancelled', () => {
    expect(params({ status: 'cancelled', cancelReason: 'reconfigured' })).toEqual({ status: 'cancelled', cancelReason: 'reconfigured' })
    expect(params({ status: 'declined', cancelReason: 'reconfigured' })).toEqual({ status: 'declined' })
  })
  it('the Overdue toggle pins the status to open requests', () => {
    expect(params({ status: 'answered', overdue: true })).toEqual({ status: 'requested', overdue: 'true' })
    expect(params({ overdue: 'true' })).toEqual({ status: 'requested', overdue: 'true' })
    expect(params({ overdue: false })).toEqual({ status: 'requested' })
  })
  it('drops unknown statuses and ids that are not UUIDs', () => {
    expect(params({ status: 'bogus', supplierId: 'x', quoteId: 'y' })).toEqual({ status: 'requested' })
    expect(params({ status: 'all', supplierId: SUPPLIER, quoteId: QUOTE })).toEqual({ status: 'all', supplierId: SUPPLIER, quoteId: QUOTE })
  })
})

describe('queue row actions and closed quotes', () => {
  it('offers Answer / Decline on open requests of live quotes only', () => {
    expect(queueRowActions({ sourcingStatus: 'requested', cpqStatus: 'ready', orderId: null })).toEqual(['answer', 'decline'])
    expect(queueRowActions({ sourcingStatus: 'requested', cpqStatus: 'accepted', orderId: null })).toEqual(['answer', 'decline'])
    expect(queueRowActions({ sourcingStatus: 'answered', cpqStatus: 'ready', orderId: null })).toEqual([])
    expect(queueRowActions({ sourcingStatus: 'requested', cpqStatus: 'rejected', orderId: null })).toEqual([])
    expect(queueRowActions({ sourcingStatus: 'requested', cpqStatus: 'ready', orderId: 'o1' })).toEqual([])
  })
  it('isSourcingClosed', () => {
    expect(isSourcingClosed('cancelled')).toBe(true)
    expect(isSourcingClosed('rejected')).toBe(true)
    expect(isSourcingClosed('ready', 'order')).toBe(true)
    expect(isSourcingClosed('accepted')).toBe(false)
  })
})

describe('sourcingBadges', () => {
  it('derives requested, overdue, declined and answer pending in a stable order', () => {
    expect(sourcingBadges([{ sourcingStatus: 'not_requested' }])).toEqual([])
    expect(sourcingBadges([{ sourcingStatus: 'requested' }])).toEqual(['requested'])
    expect(sourcingBadges([{ sourcingStatus: 'requested', overdue: true }])).toEqual(['requested', 'overdue'])
    expect(sourcingBadges([{ sourcingStatus: 'declined' }, { sourcingStatus: 'answered', hasAnswerPending: true }])).toEqual(['declined', 'answerPending'])
    expect(sourcingBadges([{ sourcingStatus: 'answered', overdue: true }])).toEqual([])
    expect(sourcingBadges([{}])).toEqual([])
  })
})

describe('sourcingActions', () => {
  const all: SourcingPermissions = { request: true, answer: true, apply: true }
  const none: SourcingPermissions = { request: false, answer: false, apply: false }
  const rep: SourcingPermissions = { request: true, answer: false, apply: false }
  const open = (permissions: SourcingPermissions, cost = {}) => sourcingActions({ sourcingStatus: 'requested', ...cost }, { closed: false, permissions })

  it('an open request offers re-request, cancel, answer and decline to a holder of everything', () => {
    expect(open(all)).toEqual(['rerequest', 'cancel', 'answer', 'decline'])
  })
  it('reps request but cannot answer, decline or apply', () => {
    expect(open(rep)).toEqual(['rerequest', 'cancel'])
    expect(sourcingActions({ sourcingStatus: 'not_requested' }, { closed: false, permissions: rep })).toEqual(['request'])
    expect(sourcingActions({ sourcingStatus: 'answered', hasAnswerPending: true }, { closed: false, permissions: rep })).toEqual(['rerequest'])
  })
  it('a user without any permission gets nothing', () => {
    expect(open(none, { hasAnswerPending: true })).toEqual([])
  })
  it('re-request after a closed request; apply only with a pending answer', () => {
    for (const status of ['answered', 'declined', 'cancelled']) {
      expect(sourcingActions({ sourcingStatus: status }, { closed: false, permissions: all })).toEqual(['rerequest'])
    }
    expect(sourcingActions({ sourcingStatus: 'answered', hasAnswerPending: true }, { closed: false, permissions: all })).toEqual(['rerequest', 'apply'])
    expect(sourcingActions({ sourcingStatus: 'answered', hasAnswerPending: true }, { closed: false, permissions: { ...none, apply: true } })).toEqual(['apply'])
  })
  it('never on a Cancel / frozen-unpriceable line (requestEligible false) and never on a closed quote', () => {
    expect(open(all, { requestEligible: false })).toEqual([])
    expect(sourcingActions({ sourcingStatus: 'requested', hasAnswerPending: true }, { closed: true, permissions: all })).toEqual([])
    expect(open(all, { requestEligible: true })).toContain('answer')
  })
})

describe('apply confirmation', () => {
  it('formats the new and previous cost with their currency', () => {
    expect(formatCostAmount('276', 'EUR')).toBe('276.00 EUR')
    expect(formatCostAmount(310.125, 'EUR')).toBe('310.125 EUR')
    expect(formatCostAmount(null, 'EUR')).toBe('—')
    expect(applyConfirmation({ unitAmount: '276.0000', currencyCode: 'EUR' }, { unitAmount: 310, currencyCode: 'EUR' }))
      .toEqual({ newCost: '310.00 EUR', previousCost: '276.00 EUR', differentCurrency: false })
  })
  it('flags another currency', () => {
    expect(applyConfirmation({ unitAmount: '276', currencyCode: 'EUR' }, { unitAmount: 330, currencyCode: 'USD' }))
      .toEqual({ newCost: '330.00 USD', previousCost: '276.00 EUR', differentCurrency: true })
  })
  it('tolerates a missing proposal or value', () => {
    expect(applyConfirmation({ unitAmount: null, currencyCode: null }, null)).toEqual({ newCost: '—', previousCost: '—', differentCurrency: false })
  })
})

describe('answer form', () => {
  const valid = (patch: Partial<AnswerForm> = {}): AnswerForm => ({ ...emptyAnswerForm('EUR'), unitAmount: '12.5', supplierQuoteRef: 'Q-1', ...patch })
  it('starts confirmed with the default currency and supplier', () => {
    expect(emptyAnswerForm('EUR', 'Acme')).toMatchObject({ currencyCode: 'EUR', valueStatus: 'confirmed', supplierName: 'Acme', unitAmount: '' })
  })
  it('accepts a minimal valid form', () => {
    expect(answerFormIssues(valid(), '2026-11-15')).toEqual([])
  })
  it('requires amount, currency format and supplier reference (1-100)', () => {
    expect(answerFormIssues(valid({ unitAmount: '' }), '2026-11-15')).toEqual(['AMOUNT_REQUIRED'])
    expect(answerFormIssues(valid({ unitAmount: '-1' }), '2026-11-15')).toEqual(['AMOUNT_INVALID'])
    expect(answerFormIssues(valid({ unitAmount: '1.23456' }), '2026-11-15')).toEqual(['AMOUNT_INVALID'])
    expect(answerFormIssues(valid({ currencyCode: 'eur' }), '2026-11-15')).toEqual(['CURRENCY_INVALID'])
    expect(answerFormIssues(valid({ supplierQuoteRef: '  ' }), '2026-11-15')).toEqual(['REF_REQUIRED'])
    expect(answerFormIssues(valid({ supplierQuoteRef: 'x'.repeat(101) }), '2026-11-15')).toEqual(['REF_TOO_LONG'])
  })
  it('validates dates, a past validity, the term and the note length', () => {
    expect(answerFormIssues(valid({ validUntil: '2026-11-14' }), '2026-11-15')).toEqual(['VALID_UNTIL_IN_PAST'])
    expect(answerFormIssues(valid({ validUntil: '2026-11-15' }), '2026-11-15')).toEqual([])
    expect(answerFormIssues(valid({ supplierTermEnd: '15/11/2026' }), '2026-11-15')).toEqual(['DATE_INVALID'])
    expect(answerFormIssues(valid({ supplierMinTermMonths: '1.5' }), '2026-11-15')).toEqual(['TERM_INVALID'])
    expect(answerFormIssues(valid({ note: 'n'.repeat(501) }), '2026-11-15')).toEqual(['NOTE_TOO_LONG'])
  })
  it('builds the body with the request id and only the filled optionals', () => {
    expect(buildAnswerBody(valid(), 'req-1')).toEqual({ costRequestId: 'req-1', unitAmount: 12.5, currencyCode: 'EUR', valueStatus: 'confirmed', supplierQuoteRef: 'Q-1' })
    expect(buildAnswerBody(valid({ supplierName: ' Acme ', validUntil: '2027-01-01', supplierMinTermMonths: '12', valueStatus: 'estimated', note: ' n ' }), 'req-1', SUPPLIER)).toEqual({
      costRequestId: 'req-1', unitAmount: 12.5, currencyCode: 'EUR', valueStatus: 'estimated', supplierQuoteRef: 'Q-1',
      supplierId: SUPPLIER, supplierName: 'Acme', validUntil: '2027-01-01', supplierMinTermMonths: 12, note: 'n',
    })
  })
})

describe('decline form', () => {
  it('requires a reason up to 500 characters', () => {
    expect(declineIssues('')).toEqual(['REASON_REQUIRED'])
    expect(declineIssues('   ')).toEqual(['REASON_REQUIRED'])
    expect(declineIssues('x'.repeat(501))).toEqual(['REASON_TOO_LONG'])
    expect(declineIssues('No capacity')).toEqual([])
    expect(buildDeclineBody(' No capacity ', 'req-1')).toEqual({ costRequestId: 'req-1', reason: 'No capacity' })
  })
})

describe('classifySourcingError', () => {
  it('maps each known error code to an effect', () => {
    expect(classifySourcingError(409, { error: 'COST_REQUEST_SUPERSEDED' })).toEqual({ code: 'COST_REQUEST_SUPERSEDED', effect: 'refresh', orderId: null })
    expect(classifySourcingError(409, { error: 'STALE_REVISION' }).effect).toBe('refresh')
    expect(classifySourcingError(409, { error: 'REQUEST_NOT_OPEN' }).effect).toBe('refresh')
    expect(classifySourcingError(409, { error: 'NO_PENDING_ANSWER' }).effect).toBe('refresh')
    expect(classifySourcingError(409, { error: 'QUOTE_CLOSED' }).effect).toBe('remove')
    expect(classifySourcingError(409, { error: 'SUPPLIER_QUOTE_REF_CONFLICT' }).effect).toBe('stay')
    expect(classifySourcingError(422, { error: 'VALID_UNTIL_IN_PAST' })).toMatchObject({ code: 'VALID_UNTIL_IN_PAST', effect: 'stay' })
    expect(classifySourcingError(422, { error: 'INVALID_CURRENCY_CODE' }).effect).toBe('stay')
  })
  it('a converted quote stays open with the order link, or drops the row without one', () => {
    expect(classifySourcingError(409, { error: 'QUOTE_CONVERTED', orderId: 'o1' })).toEqual({ code: 'QUOTE_CONVERTED', effect: 'stay', orderId: 'o1' })
    expect(classifySourcingError(409, { error: 'QUOTE_CONVERTED' })).toEqual({ code: 'QUOTE_CONVERTED', effect: 'remove', orderId: null })
  })
  it('falls back on the status for bodies without a code', () => {
    expect(classifySourcingError(403, {})).toMatchObject({ code: 'FORBIDDEN', effect: 'stay' })
    expect(classifySourcingError(400, null)).toMatchObject({ code: 'VALIDATION', effect: 'stay' })
  })
})

describe('expansion helpers', () => {
  it('shapes the request history without amounts', () => {
    expect(historyRows([
      { requestSeq: 1, requestedAt: '2026-11-01T10:00:00.000Z', closedAt: '2026-11-03T10:00:00.000Z', outcome: 'answered', supplierQuoteRef: 'Q-9' },
      { requestSeq: 2, requestedAt: null, closedAt: '2026-11-04T10:00:00.000Z', outcome: 'declined', declineReason: 'No capacity' },
    ])).toEqual([
      { seq: '#1', requested: '2026-11-01', closed: '2026-11-03', outcome: 'answered', reason: '—', ref: 'Q-9' },
      { seq: '#2', requested: '—', closed: '2026-11-04', outcome: 'declined', reason: 'No capacity', ref: '—' },
    ])
    expect(historyRows(undefined)).toEqual([])
  })
  it('lists attributes, showing empty values as a dash', () => {
    expect(attributePairs({ bandwidth: 100, site: null, tags: ['a'] })).toEqual([['bandwidth', '100'], ['site', '—'], ['tags', '["a"]']])
    expect(attributePairs(null)).toEqual([])
  })
})

describe('sourcingPermissions', () => {
  it('maps granted features to the three action groups', () => {
    expect(sourcingPermissions(['cpq.quotes.view', 'cpq.costs.view', 'cpq.quotes.manage'])).toEqual({ request: true, answer: false, apply: false })
    expect(sourcingPermissions(['cpq.costs.view', 'cpq.costs.manage'])).toEqual({ request: false, answer: true, apply: false })
    expect(sourcingPermissions(['cpq.costs.view', 'cpq.costs.manage', 'cpq.quotes.manage'])).toEqual({ request: true, answer: true, apply: true })
    expect(sourcingPermissions(['cpq.costs.manage', 'cpq.quotes.manage'])).toEqual({ request: true, answer: false, apply: false })
    expect(sourcingPermissions([])).toEqual({ request: false, answer: false, apply: false })
  })
})
