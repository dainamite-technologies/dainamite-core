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
