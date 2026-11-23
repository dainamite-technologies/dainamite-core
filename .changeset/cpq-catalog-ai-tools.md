---
'@dainamite/cpq': minor
---

Catalog AI tools (#128): `cpq.create_offering`, `cpq.add_bundle_component` and `cpq.remove_bundle_component`, available only to the new `cpq.catalog_assistant` agent for catalog admins (`cpq.offerings.manage`). Every write goes through the approval card; the quoting assistant cannot change the catalog. Run `yarn generate` after upgrading.
