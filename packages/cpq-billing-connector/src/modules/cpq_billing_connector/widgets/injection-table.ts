import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * The Billing tab on CPQ's order detail page. CPQ owns the spot and knows
 * nothing about billing; without this connector the spot stays empty.
 */
export const injectionTable: ModuleInjectionTable = {
  'cpq.order.detail:tabs': [
    {
      widgetId: 'cpq_billing_connector.injection.order-billing-setup',
      kind: 'tab',
      groupLabel: 'cpq_billing_connector.orderSetup.tab',
      groupDescription: 'Billing account and bill start dates of this order',
      priority: 50,
    },
  ],
}

export default injectionTable
