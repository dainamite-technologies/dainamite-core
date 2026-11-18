---
'@dainamite/billing': patch
---

Balance transaction lists (the prepaid panel on the account page and `/backend/billing/transactions`) and the transaction detail page show the service period of recurring charges under the description, in the viewer's locale (#130). Full-period charges used to show only the item name, so rows for different periods looked identical. The period comes from the transaction's stored `metadata.service_period_start/end`. Prorated and credit charges, whose description already contains the dates, are unchanged. No API change.
