---
"@dainamite/cpq": patch
"@dainamite/cpq-billing-connector": patch
---

Renewal billing: `cpq.subscription.renewed` now carries `removedSubscriptionItemIds`, and the billing connector ends the Billing Items of those items (and devices) the day before the new term starts. Before, items dropped at renewal kept billing. The renewal term extension now moves `bill_end_date` only for items that run to the old term end, so items ended earlier by an amendment, a cancellation or an operator are no longer revived.
