---
"@dainamite/cpq": minor
"@dainamite/billing": minor
"@dainamite/cpq-billing-connector": minor
---

Require Open Mercato `0.6.7`. Peer ranges move from `^0.6.0` to `^0.6.7` for
`@open-mercato/core`, `shared`, `ui`, `events` and `queue`, and the MikroORM
peers from `^7.0.0` to `^7.1.5` (7.1 split the SQL layer into
`@mikro-orm/sql`, so a shared 7.1 instance is required).

No package source changes — this only narrows the supported framework range.
Consumers on Open Mercato `0.6.0`–`0.6.6` must upgrade before taking these
versions.

Note for consumers running commands with a system identity (`ctx.auth: null`):
`0.6.7` hardened `ensureTenantScope` / `ensureOrganizationScope`. Those calls
are still no-ops with `auth: null`, but an unscoped organization command now
logs a warning and will throw `403` if `OM_ENFORCE_ORG_SCOPE_STRICT=true`.
