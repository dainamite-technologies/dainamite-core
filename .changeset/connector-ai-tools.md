---
'@dainamite/cpq-billing-connector': minor
---

New read-only AI tool `cpq_billing_connector.get_order_setup`: shows how a CPQ order will be billed (account, bill start dates per line, whether the setup is applied). It calls `GET /api/cpq_billing_connector/order-setups/:orderId` and needs `cpq_billing_connector.order_setup.view`.

The connector adds this tool, a prompt hint and a starter suggestion to the billing package's `billing.operator_assistant` agent, so operators can ask the billing assistant about CPQ orders. Billing itself does not depend on the connector.

The package lists `@open-mercato/ai-assistant` `^0.9.0` as an **optional** peer dependency: the tool only imports its types at load time and loads the runner when it is called, so apps without the AI assistant keep working. After upgrading, run `yarn generate`.
