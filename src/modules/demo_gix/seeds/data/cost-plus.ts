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
