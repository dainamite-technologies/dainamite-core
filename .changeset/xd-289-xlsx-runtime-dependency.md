---
"@dainamite/cpq": patch
---

XD-289: ship `xlsx` as a runtime dependency so the pricing-table detail page works out of the box on fresh `create-mercato-app` scaffolds.

`xlsx` was previously declared only in `peerDependencies` (alongside the rest of the React / MikroORM / `@open-mercato/*` peer set). That works in this monorepo because the root `package.json` already lists `xlsx`, but it broke for external consumers: installing `@dainamite/cpq` into a vanilla `create-mercato-app` project did not pull `xlsx` into `node_modules`, and the very first `yarn dev` after `yarn add @dainamite/cpq` crashed every page with

```
Module not found: Can't resolve 'xlsx'
> 1 | import * as XLSX from "xlsx";
    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
@dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxExport.js
@dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxImport.js
```

(The pricing-table `[id]/page.tsx` statically imports both files, so Next.js
bundles them for Client SSR and Client Browser regardless of which route the
visitor actually opens — a single broken import takes down `/login` and the
whole backend.)

The peer-dependency rule from SPEC-001 ("never `dependencies` for sibling
`@dainamite/*` / `@open-mercato/*`") exists to keep React, MikroORM, Next.js,
and the rest of the framework as a single shared instance. `xlsx` is a
CPQ-internal leaf library (used only by `pricing/[id]/xlsxExport.ts` and
`xlsxImport.ts`); it has no decorator/context/hook contract that breaks under
duplication, so promoting it to `dependencies` is safe and matches how leaf
libs are normally distributed on npm.

Consumers no longer need to `yarn add xlsx` after installing `@dainamite/cpq`.
The package-isolation test (`__tests__/package-isolation.test.ts`) was updated
in the same change so its allow-list comment mentions both `peerDependencies`
and `dependencies` instead of just peers.
