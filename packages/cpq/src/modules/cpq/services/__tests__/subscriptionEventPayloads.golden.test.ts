/**
 * I-9 billing-payload golden (feature 2, step 1 characterization).
 *
 * Drives `activateOrder` for each lifecycle branch with fixed fixtures and
 * compares the normalized payloads of the six `cpq.subscription.*` events
 * (activated, amended, renewed, cancelled, merged, superseded) with the
 * committed JSON fixture. The cost-plus carry-through (steps 3-14) must leave
 * every byte of these payloads unchanged: no cost keys, no amounts, same keys,
 * same order.
 *
 * Only `timestamp` (wall clock) and `activationDate` (today) are normalized.
 *
 * Deliberate regeneration (only when a billing-payload change is intended and
 * agreed with the billing connector owners):
 *   UPDATE_SUBSCRIPTION_EVENT_GOLDEN=1 yarn test packages/cpq/src/modules/cpq/services/__tests__/subscriptionEventPayloads.golden.test.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ACTIVATION_SCOPE, createActivationHarness } from './_helpers/activationHarness'

jest.mock('../../events', () => ({
  ...jest.requireActual('../../events'),
  emitCpqEvent: jest.fn(),
}))
// eslint-disable-next-line import/first
import { emitCpqEvent } from '../../events'

const FIXTURE = path.join(__dirname, '__fixtures__', 'subscriptionEventPayloads.golden.json')
const emit = emitCpqEvent as unknown as jest.Mock

type Emitted = { event: string; payload: Record<string, unknown> }

function emitted(): Emitted[] {
  return emit.mock.calls.map(([event, payload]) => ({
    event: event as string,
    payload: { ...(payload as Record<string, unknown>), timestamp: '<timestamp>', ...('activationDate' in (payload as object) ? { activationDate: '<today>' } : {}) },
  }))
}

const line = (over: Record<string, unknown>) => ({
  orderConfigurationId: 'oc-1', quantity: 1, configuration: {}, charges: [], parentLineId: null, startDate: null, termMonths: null,
  offeringId: null, productId: null, specId: null, sourceQuoteLineId: null, nrcTotal: '0', mrcTotal: '0', ...over,
})
const quoteLine = (over: Record<string, unknown>) => ({
  quoteLineId: 'ql-1', quantity: 1, configuration: {}, charges: [], parentLineId: null, offeringId: null, productId: null, specId: null,
  nrcTotal: '0', mrcTotal: '0', targetSubscriptionId: 'sub-1', sourceSubscriptionItemId: null, ...over,
})
const changeLog = (over: Record<string, unknown> = {}) => ({
  id: 'log-1', subscriptionId: 'sub-1', effectiveAt: new Date('2026-06-01T10:00:00.000Z'),
  afterSnapshot: { items: [{ id: 'item-new', name: 'Added item' }, { id: 'item-new-2', name: '' }] },
  lineChanges: [
    { action: 'add', itemId: 'item-new', quoteLineId: 'ql-1', mrcAmount: 120, nrcAmount: 30, quantity: 1 },
    { action: 'add', itemId: 'item-new-2', quoteLineId: 'ql-2', mrcAmount: 0, nrcAmount: 15, quantity: 1 },
    { action: 'modify', itemId: 'item-mod', quoteLineId: 'ql-3', mrcDelta: 5 },
    { action: 'cancel', itemId: 'item-gone', quoteLineId: 'ql-4', mrcDelta: -40 },
  ],
  ...over,
})
const subscription = { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01T00:00:00.000Z'), currentTermEnd: new Date('2028-01-01T00:00:00.000Z') }

async function activate(fixture: Parameters<typeof createActivationHarness>[0]) {
  emit.mockReset()
  const h = createActivationHarness(fixture)
  await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
  return emitted()
}

describe('cpq.subscription.* event payloads (I-9 billing golden)', () => {
  it('matches the committed fixture byte for byte', async () => {
    const actual: Record<string, Emitted[]> = {}

    actual.activated = await activate({
      quoteType: 'new',
      orderLines: [
        line({ orderLineId: 'ol-1', mrcTotal: '100', nrcTotal: '10', configuration: { offeringName: 'Hosting' } }),
        line({ orderLineId: 'ol-2', mrcTotal: '0', nrcTotal: '0', configuration: { offeringName: 'Free add-on' } }),
        line({ orderLineId: 'ol-3', mrcTotal: '0', nrcTotal: '25', configuration: { offeringName: 'Setup' } }),
        line({ orderLineId: 'ol-4', specId: 'spec-asset', nrcTotal: '500', parentLineId: 'ol-1', configuration: { offeringName: 'Server' } }),
      ],
      specs: [{ id: 'spec-asset', isAssetizable: true }],
      subscriptionItems: [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }],
      inventory: { createSubscription: { id: 'sub-1' } },
    })

    actual.amended = await activate({
      quoteType: 'amend',
      targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone' }],
      quoteLines: [quoteLine({ action: 'add', mrcTotal: '120', nrcTotal: '30' })],
      inventory: { applyAmendment: { changeLog: changeLog(), subscription } },
    })

    actual.renewed = await activate({
      quoteType: 'renew',
      targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }],
      quoteLines: [quoteLine({ action: 'add', mrcTotal: '120', nrcTotal: '30' })],
      inventory: { applyRenewal: { changeLog: changeLog(), subscription } },
    })

    actual.cancelled = await activate({
      quoteType: 'cancel',
      targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone' }],
      quoteOver: { arcEtfAmount: '250', arcEtfCurrency: 'USD', arcReasonCode: 'churn', arcReasonText: 'Moved away' },
      inventory: { applyCancel: { changeLog: changeLog({ lineChanges: null }), subscription } },
    })

    // One run covers both `merged` (for M) and `superseded` (one per source).
    const merge = await activate({
      quoteType: 'renew',
      quoteOver: { arcMergeNewTermStart: '2027-01-01', arcMergeNewTermEnd: '2028-01-01', arcMergeNewTermMonths: 12 },
      targets: [{ subscriptionId: 'sub-a', mergeAction: 'absorb' }, { subscriptionId: 'sub-b', mergeAction: 'absorb' }],
      inventory: {
        applyMergeRenewal: {
          mergedSubscription: { id: 'sub-m', currentTermStart: new Date('2027-01-01T00:00:00.000Z') },
          mergeResultChangeLog: { id: 'log-m' },
          sourceChangeLogs: [{ id: 'log-a', subscriptionId: 'sub-a' }, { id: 'log-b', subscriptionId: 'sub-b' }],
        },
      },
    })
    actual.merged = merge.filter((e) => e.event === 'cpq.subscription.merged')
    actual.superseded = merge.filter((e) => e.event === 'cpq.subscription.superseded')

    // Every lifecycle event fired exactly as many times as the fixtures imply.
    expect(Object.fromEntries(Object.entries(actual).map(([key, events]) => [key, events.length]))).toEqual({
      activated: 1, amended: 1, renewed: 1, cancelled: 1, merged: 1, superseded: 2,
    })

    if (process.env.UPDATE_SUBSCRIPTION_EVENT_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
      fs.writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
    }
    const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    // Compare serialized so key ORDER and absent-vs-undefined keys are part of the contract.
    expect(JSON.stringify(actual, null, 2)).toBe(JSON.stringify(expected, null, 2))
  })

  it('carries no cost keys or amounts in any payload', async () => {
    const actual = JSON.stringify(
      JSON.parse(fs.readFileSync(FIXTURE, 'utf8')),
    )
    expect(actual).not.toMatch(/cost|margin/i)
  })
})
