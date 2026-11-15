/**
 * The lifecycle subscribers act on the system's authority, not a user's,
 * so they need no feature. The order billing setup (spec
 * `2026-11-15-cpq-billing-connector-order-billing-setup`) is operator-facing:
 *   - `order_setup.view`   — see the Billing tab on a CPQ order
 *   - `order_setup.manage` — choose the account / set bill start dates
 */
export const features = [
  {
    id: 'cpq_billing_connector.order_setup.view',
    title: 'View CPQ order billing setup',
    module: 'cpq_billing_connector',
  },
  {
    id: 'cpq_billing_connector.order_setup.manage',
    title: 'Manage CPQ order billing setup',
    module: 'cpq_billing_connector',
  },
]

export default features
