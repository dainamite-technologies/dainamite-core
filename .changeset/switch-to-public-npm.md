---
"@dainamite/cpq": patch
---

Switch publish target from GitHub Packages to public npm.js.

Initial publish attempts as `@dainamite/cpq` on GitHub Packages failed
with `403 Forbidden — installation does not exist`: scope `@dainamite`
on GitHub belongs to a different (unrelated) "DAInamite" organization
based in Berlin. Switching to public npm.js, where the `@dainamite`
scope is free, lets us keep the brand without renaming everything to
`@dainamite-technologies/cpq`.

Open Mercato itself publishes to public npm.js
(`@open-mercato/core`, etc.), so this is also more consistent with the
upstream ecosystem and matches the L2 model from SPEC-001.

For consumers: install with plain `yarn add @dainamite/cpq` — no
`.npmrc` auth setup needed.
