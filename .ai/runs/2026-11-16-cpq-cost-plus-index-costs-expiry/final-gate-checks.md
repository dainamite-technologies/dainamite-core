# Final gate — PR #105 (CPQ cost-plus: index costs and supplier cost expiry warnings)

- **Recorded:** 2026-11-17
- **Head:** 4a4e36c (all 18 steps)

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| Unit tests (CI) | ✅ pass | 3315 tests (CI run 43857008747) |
| Integration tests (CI, Postgres) | ✅ pass | 69 passed, 2 skipped (`test.fixme`: PR #95 recipe; `TC-CPQ-COST-EXPIRY-001` — the harness cannot invoke a CLI) incl. `TC-CPQ-COST-INDEX-001` / `-002`; Migration20261116054402, …060621, …105841 applied |
| CI trigger | ⚠️ manual | `ci.yml` runs only on PRs into `main` |
| Golden tests | ✅ | pricing golden + I-9 payload golden byte-identical |
| Confidentiality (I-4) | ✅ | Phase A / B / C sweeps: index values, factor, offset, snapshot holder-only; calculate-price exposes none; expiry event / notification carry no amount or supplier |
| Review pass | ⚠️ partial | the read-only reviewer agent hit the provider's weekly limit before recording findings; the main session reviewed the highest-risk paths instead (below) |
| Browser QA | ⚠️ owed | index pages, dialogs, cost element index fields and Costs panel snapshot line never rendered in a browser |

## Main-session review (highest-risk paths)

| Area | Result |
|---|---|
| Expiry candidate paging | ✅ keyset over (`valid_until`, `id`) with a strict `>` cursor — no skipped / duplicated rows; already-warned lines filtered per batch |
| Expiry dedupe | ✅ unique `(quote_line_cost_id, valid_until)` + `ON CONFLICT DO NOTHING … RETURNING`; emit → notify → stamp; unstamped rows re-emitted after 10 min |
| Worker scope | ✅ only the envelope `tenantId` / `organizationId` |
| Schedule | ✅ registration has no `isEnabled` key (an admin-disabled schedule stays disabled on re-seed) |
| Value in force | ✅ latest `effective_date ≤ asOfDate`, then highest revision, chosen deterministically; future values ignored |
| Follow-up (minor, perf) | `loadValuesInForce` reads every past value of the quote's indices per recalculation (bounded by index history); a `DISTINCT ON (cost_index_id)` query would make it O(indices) |

## Decisions accepted (see NOTIFY.md)

- One PR for the spec's three PRs; each phase has its own close-out.
- Index demo on a dedicated offering (the partner-tail charge is the worked example of earlier demos).
- `notifications` optional; expiry service built from DI only when notification + RBAC services exist.
