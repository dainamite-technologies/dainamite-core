import { z } from 'zod'
import {
  creditReasonInputFields,
  creditReasonText,
  parseCreditReason,
  refineCreditReasonInput,
  toCreditReason,
} from '../../lib/creditReason'

const identity = (_key: string, fallback: string) => fallback
const inputSchema = z.object(creditReasonInputFields).superRefine(refineCreditReasonInput)

describe('creditReason', () => {
  it('maps API input to the stored shape', () => {
    expect(toCreditReason({ creditReason: 'Goodwill' })).toEqual({ kind: 'text', text: 'Goodwill' })
    expect(
      toCreditReason({ creditReasonCode: 'subscription_amended', creditReasonParams: { effectiveDate: '2026-11-15' } }),
    ).toEqual({ kind: 'code', code: 'subscription_amended', params: { effectiveDate: '2026-11-15' } })
    expect(toCreditReason({})).toBeNull()
  })

  it('rejects text and code together, and a code without params', () => {
    expect(
      inputSchema.safeParse({
        creditReason: 'x',
        creditReasonCode: 'subscription_amended',
        creditReasonParams: { effectiveDate: '2026-11-15' },
      }).success,
    ).toBe(false)
    expect(inputSchema.safeParse({ creditReasonCode: 'subscription_amended' }).success).toBe(false)
    expect(inputSchema.safeParse({ creditReason: 'x'.repeat(501) }).success).toBe(false)
  })

  it('parses stored jsonb defensively', () => {
    expect(parseCreditReason({ kind: 'text', text: 'Goodwill' })).toEqual({ kind: 'text', text: 'Goodwill' })
    expect(parseCreditReason({ kind: 'code', code: 'nope', params: {} })).toBeNull()
    expect(parseCreditReason(null)).toBeNull()
  })

  it('renders operator text verbatim', () => {
    expect(creditReasonText({ kind: 'text', text: 'Goodwill' }, identity, (d) => d)).toBe('Goodwill')
  })

  it('renders a code through the given translator (invoice language) with params', () => {
    const es = (key: string, fallback: string) =>
      key === 'billing.credit_reason.subscription_amended'
        ? 'Suscripción modificada (pedido {reference}), con efecto {date}'
        : fallback
    expect(
      creditReasonText(
        { kind: 'code', code: 'subscription_amended', params: { reference: 'SO-1234', effectiveDate: '2026-11-15' } },
        es,
        () => '15/11/2026',
      ),
    ).toBe('Suscripción modificada (pedido SO-1234), con efecto 15/11/2026')
    expect(
      creditReasonText({ kind: 'code', code: 'subscription_cancelled', params: { effectiveDate: '2026-11-15' } }, identity, (d) => d),
    ).toBe('Subscription cancelled, effective 2026-11-15')
  })
})
