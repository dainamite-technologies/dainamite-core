---
'@dainamite/cpq': patch
---

Declare the customer inventory features in `acl.ts`: `cpq.inventory.view` and `cpq.inventory.manage`. Routes and the admin and employee roles already used them, but they were never declared, so they could not be assigned to other roles in the RBAC UI.

`GET /api/cpq/inventory/subscriptions/expiring` now requires `cpq.inventory.view`. It used to require `cpq.inventory.expiring.view`, a feature that was retired, so no role could call the endpoint.

For existing tenants, run `yarn mercato auth sync-role-acls --tenant <id>` after the upgrade.
