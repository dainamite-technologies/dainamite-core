# Checkpoint 2 — Steps B.6–B.9 (+ 7 test fix, 8-review-fix) verified; Phase B closed

- **Checkpoint:** 2
- **Steps covered:** B.6, B.7 (+ bb1d7a8 test fix), B.8, B.9, 8-review-fix (e7ed015..b97faf7)
- **Recorded:** 2026-11-14
- **Touched areas:** `packages/cpq` — snapshot `items[].costs` / `assets[].costs` (omitted when empty, Q10); `cpq.subscription.cost_changed` (non-broadcast, no amounts) emitted after commit; cost read routes for orders, subscriptions, assets (status-only vs full projection, 404 toggle off); change-log redaction (`stripSnapshotCosts`); `itemMargin.ts`; usage `liveSubscriptions`; confidentiality sweep extended to order / subscription / asset / change-log / lifecycle-event channels.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | new routes + event registered |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean |
| `yarn test` (full) | ✅ pass | 134 suites, 1992 tests; pricing golden + subscription event payload golden unchanged |
| Confidentiality sweep (I-4) | ✅ pass | sentinel 7777.77, supplier names and amount / supplier / margin keys absent for non-holders on every new channel |
| Review of Steps 6–9 | ✅ 1 minor fixed | `liveSubscriptions` ignored owner liveness (Q6) → 8-review-fix; event payload matches the spec contract (no amounts) |
| UI / integration | ⏭️ skipped | no UI in this window; app not runnable here (no Postgres/Docker) |

## Decisions accepted

- Per-item / per-asset margin is `null` for a non-live owner and excluded from the roll-up (avoids showing a terminated item's full price as margin).
- Item margin coverage computed over MRC + NRC × quantity with no term horizon (items carry no term).
- Ended inventory costs stay in snapshots with `status: 'ended'` and `endedAt`.
