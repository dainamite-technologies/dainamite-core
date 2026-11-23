---
'@dainamite/cpq': minor
'@dainamite/cpq-billing-connector': minor
---

Devices on ARC quotes (#126). Amend, Renew and Cancel quotes show the subscription's devices (assets) as unpriced lines under their bundle, so they can be kept, returned or swapped; removed devices are returned at activation. A device added on an ARC quote creates only an asset, like a new sale. Billing now receives a device's own charges (new sale and ARC add), stops billing returned devices, and re-rates items whose recurring price changed on an Amend or Renew (`changedItems`).
