import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderBillingSetupWidget from './widget.client'

/**
 * "Billing" tab on the CPQ order detail page (`cpq.order.detail:tabs`).
 * Spec `2026-11-15-cpq-billing-connector-order-billing-setup`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, unknown> = {
  metadata: {
    id: 'cpq_billing_connector.injection.order-billing-setup',
    title: 'Billing',
    description: 'Billing account and bill start dates of a CPQ order',
    features: ['cpq_billing_connector.order_setup.view'],
    priority: 50,
    enabled: true,
  },
  Widget: OrderBillingSetupWidget as InjectionWidgetModule<Record<string, unknown>, unknown>['Widget'],
}

export default widget
