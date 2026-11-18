// Cost-plus demo data for the GIX use case: the "IP Transit with partner tail"
// offering (App Spec §1, worked example 300 + 100 at 25 % markup = 500.00).

export const IP_TRANSIT = {
  sku: 'GIX-IP-TRANSIT',
  title: 'GIX IP Transit with partner tail',
  description: 'IP transit delivered over a partner carrier tail plus a cross-connect at the data centre',
  specCode: 'SPEC-GIX-IP-TRANSIT',
  offerCode: 'OFFER-GIX-IP-TRANSIT',
  chargeCode: 'transit_fee',
  currency: 'USD',
  /** Markup applied on the price-basis costs: (300 + 100) x 1.25 = 500.00. */
  markupPercent: 25,
  /** Indicative price shown while a cost is still pending (R5). */
  fallbackPrice: 1500,
} as const

/** Cross-connect COST table (`purpose = cost`): monthly cost per data centre. */
export const CROSS_CONNECT_COST_TABLE = {
  code: 'gix_cross_connect_cost',
  name: 'GIX Cross-connect Cost',
  column: 'mrc',
  // equinix-sg1 is deliberately absent: a quote there has no cost match (pending).
  entries: { 'equinix-am1': 300, 'equinix-ld5': 280, 'equinix-fr5': 320, 'equinix-md2': 260, 'equinix-dc3': 290, 'digital-realty-ams11': 310 } as Record<string, number>,
} as const

export const COST_ELEMENTS = {
  crossConnect: 'cross_connect',
  partnerTail: 'partner_tail',
  monitoring: 'noc_monitoring',
} as const

export const PARTNER_TAIL_ESTIMATE = 100
export const PARTNER_SUPPLIER = 'Partner Carrier Ltd.'

/** Demo quotes, one per cost state (keyed by `quoteContext.scenario`). */
export const COST_PLUS_SCENARIOS = {
  pending: { scenario: 'cost-plus-pending', label: 'Demo — IP Transit, cost pending', dataCentre: 'equinix-sg1' },
  estimated: { scenario: 'cost-plus-estimated', label: 'Demo — IP Transit, cost estimated', dataCentre: 'equinix-am1' },
  confirmed: { scenario: 'cost-plus-confirmed', label: 'Demo — IP Transit, cost confirmed', dataCentre: 'equinix-ld5', partnerTail: 110, validDays: 60 },
  expired: { scenario: 'cost-plus-expired', label: 'Demo — IP Transit, supplier quote expired', dataCentre: 'equinix-fr5', partnerTail: 105, validDays: -10 },
} as const

/** Working days the overdue demo request has been open (above the default overdue threshold). */
export const OVERDUE_WORKING_DAYS = 8

/** Supplier cost sourcing demo quotes (keyed by `quoteContext.scenario`), one per sourcing state. */
export const COST_SOURCING_SCENARIOS = {
  requestedOverdue: { scenario: 'cost-sourcing-requested-overdue', label: 'Demo — IP Transit, partner tail requested (overdue)', dataCentre: 'equinix-md2' },
  declined: { scenario: 'cost-sourcing-declined', label: 'Demo — IP Transit, partner tail declined', dataCentre: 'equinix-dc3', reason: 'No coverage at site' },
  answeredProposal: {
    scenario: 'cost-sourcing-answered-proposal', label: 'Demo — IP Transit, supplier answer pending (with customer)',
    dataCentre: 'digital-realty-ams11', answerAmount: 130, validDays: 30, supplierQuoteRef: 'PCL-cost-sourcing-proposal',
  },
} as const

/**
 * Foreign-currency cost demo: a EUR quote whose partner tail is a fixed 300 USD, converted with the demo USD→EUR
 * rates (source `Manual`, stored at UTC midnight, one per day for the last three days). 300 x 0.92 x 1.25 = 345.00.
 */
export const FX_DEMO = {
  sku: 'GIX-IP-TRANSIT-EUR',
  title: 'GIX IP Transit with USD partner tail (EUR)',
  description: 'IP transit priced in EUR from a partner tail that the carrier quotes in USD',
  specCode: 'SPEC-GIX-IP-TRANSIT-EUR',
  offerCode: 'OFFER-GIX-IP-TRANSIT-EUR',
  chargeCode: 'transit_fee_eur',
  quoteCurrency: 'EUR',
  costCurrency: 'USD',
  markupPercent: 25,
  tailElementCode: 'partner_tail_usd',
  tailAmount: 300,
  rateSource: 'Manual',
  /** USD→EUR, newest first: index 0 is today (UTC). */
  rates: ['0.92000000', '0.91500000', '0.91000000'],
  scenario: 'cost-fx-converted-tail',
  label: 'Demo — IP Transit, USD partner tail converted to EUR',
} as const

/**
 * ARC costs demo: one LIVE subscription (activated through quote → order → activation, so its item cost is real) whose
 * partner tail (a fixed 270 USD) has a supplier term that ends before the subscription renews. A Renew of it flags the
 * tail "renegotiation due"; an Amend carries it. 270 x 1.25 = 337.50.
 */
export const ARC_COST_DEMO = {
  sku: 'GIX-IP-TRANSIT-ARC',
  title: 'GIX IP Transit with partner tail (supplier term ending)',
  description: 'IP transit whose partner tail is contracted only until before the subscription renews',
  specCode: 'SPEC-GIX-IP-TRANSIT-ARC',
  offerCode: 'OFFER-GIX-IP-TRANSIT-ARC',
  chargeCode: 'transit_fee_arc',
  currency: 'USD',
  markupPercent: 25,
  tailElementCode: 'partner_tail_arc',
  tailAmount: 270,
  supplierName: PARTNER_SUPPLIER,
  /** Days from today: the subscription renews 90 days out; the supplier term ends 45 days out, i.e. before the renewal. */
  subscriptionTermEndDays: 90,
  supplierTermEndDays: 45,
  scenario: 'cost-arc-supplier-term-ending',
  label: 'Demo — IP Transit, partner tail supplier term ends before renewal',
} as const

/**
 * Index cost demo: a EUR cost-plus charge whose only price-basis cost is an `index` element (factor 0.5 of the demo
 * data-centre power index, EUR/MWh). Value dates are offsets in days from the seed run (negative = past). The value in
 * force today is 100.00 (-7 days), so the unit cost is 50.00 and the list price 62.50 EUR at 25 % markup. The future
 * value only takes effect at `futureDays`: unlocked quotes re-price then (R4), the sent quote never does.
 *
 * It lives on its own offering rather than on "IP Transit with partner tail": that charge is a USD worked example
 * (300 + 100 at 25 % = 500.00) that the cost-state demos rely on, and a second price-basis element in EUR would
 * change it and drag the EUR index through the FX path.
 */
export const INDEX_DEMO = {
  indexCode: 'DEMO-DC-POWER',
  indexName: 'Demo data-centre power, EUR/MWh',
  unit: 'EUR/MWh',
  currency: 'EUR',
  /** Past values, oldest first; `correctedValue` is appended afterwards as revision 2 of the same date. */
  values: [
    { days: -90, value: 92 },
    { days: -60, value: 97.5 },
    { days: -30, value: 98, correctedValue: 99.5 },
    { days: -7, value: 100 },
  ],
  /** A value that is not in force yet: must stay > today. */
  future: { days: 45, value: 120 },
  sku: 'GIX-IP-TRANSIT-INDEX',
  title: 'GIX IP Transit with indexed power (EUR)',
  description: 'IP transit whose price follows a data-centre power index',
  specCode: 'SPEC-GIX-IP-TRANSIT-INDEX',
  offerCode: 'OFFER-GIX-IP-TRANSIT-INDEX',
  chargeCode: 'transit_fee_index',
  markupPercent: 25,
  elementCode: 'power_index',
  factor: '0.5',
  offset: '0',
  readyScenario: 'cost-index-ready',
  readyLabel: 'Demo — IP Transit, index cost (ready: refreshes on save)',
  sentScenario: 'cost-index-sent',
  sentLabel: 'Demo — IP Transit, index cost (with customer: frozen)',
} as const
