---
"@dainamite/cpq-billing-connector": patch
---

Bump `@dainamite/billing` peer dependency to `^0.18.0` (prepaid billing,
SPEC-002 / XD-304). No connector code changes — the connector keeps emitting
the same command-bus calls; this only widens the supported billing range.
