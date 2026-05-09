---
"@dainamite/cpq": patch
---

Fix `repository.url` in package.json to point at
`dainamite-technologies/dainamite-core` (was `dainamite/dainamite-core`).
GitHub Packages requires the URL to match the publishing repo;
mismatch returns `403 Forbidden — installation does not exist`.
This blocked the inaugural publish of 0.2.0.
