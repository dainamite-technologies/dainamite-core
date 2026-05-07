# XD-250 — CPQ Amend / Renew / Cancel (ARC) — Operator Manual

> **Spec**: [`specs/implementation/xd-250-arc-spec.md`](../specs/implementation/xd-250-arc-spec.md)

This manual is a **click-by-click walkthrough** for every ARC operator
scenario. Each step is one action; after each step there's a **Checkpoint**
describing exactly what you should see on screen before proceeding.

## What ARC does in one paragraph

ARC lets operators change a live subscription through the same Quote → Order
flow used for new sales. **Amend** edits items mid-term (no term change).
**Renew** extends the term, optionally with item edits — and when run on 2+
subscriptions at once it creates a single brand-new merged subscription.
**Cancel** terminates one or more subscriptions with a reason code and
optional early-termination fee. ARC works on `active` and `suspended`
subscriptions; terminal-status subs (`expired`, `terminated`, `superseded`)
are not eligible.

---

## Prerequisites

1. **Database seeded.** Run `yarn reinstall` once (or `yarn initialize` on
   a fresh DB). After it finishes you should see in the terminal:
   ```
   [cpq:arc-examples] Created 11 subscription(s) across 11 ARC scenario(s)
   ```
2. **Dev server running.** In a separate terminal: `yarn dev`. Wait for
   `Ready in Xs` (usually ~30 seconds).
3. **Browser open at** `http://localhost:3000/login`.

### Demo data — what's seeded

Customer: **Meridian Connectivity Sp. z o.o.** Subscriptions:

| Code | Status | Term ends | Used in scenario |
|---|---|---|---|
| `SUB-ARC-AMEND-1` | active | +180 days | 1 — Amend (single target) |
| `SUB-ARC-RENEW-SOON` | active | +20 days | 3 — Standalone renew |
| `SUB-ARC-CANCEL` | active | +90 days | 5 — Cancel with reason + ETF |
| `SUB-ARC-MULTI-A` | active | +60 days | 2 — Multi-target amend |
| `SUB-ARC-MULTI-B` | active | +60 days | 2 — Multi-target amend |
| `SUB-ARC-MERGE-1` | active | +25 days | 4 — Merge renewal source 1/3 |
| `SUB-ARC-MERGE-2` | active | +25 days | 4 — Merge renewal source 2/3 |
| `SUB-ARC-MERGE-3` | active | +25 days | 4 — Merge renewal source 3/3 |
| `SUB-ARC-SUSPENDED` | suspended | +120 days | 6 — ARC on suspended |
| `SUB-ARC-EXPIRED` | expired | -10 days | 7 — Terminal-status (negative) |
| `SUB-ARC-TERMINATED` | terminated | +60 days | 7 — Terminal-status (negative) |

---

# Scenario 0 — Log in and open the subscription list

1. **In the browser, go to** `http://localhost:3000/login`.
   - **Checkpoint**: a login form with two inputs (`Email`, `Password`) and a `Sign in` button.

2. **Click the `Email` field, type:** `admin@gix.com` (the GIX-tenant admin — XD-276 demo seed orchestration ships ARC fixtures as part of the GIX use case)
3. **Click the `Password` field, type:** `secret`
4. **Press Enter** (or click `Sign in`).
   - **Checkpoint**: redirect to `http://localhost:3000/backend`. Page header reads `Dashboard`. Left sidebar contains groups: `Customers`, `Catalog`, `Sales`, `CPQ`, ...

5. **In the left sidebar, click the `CPQ` group** (to expand it if collapsed).
   - **Checkpoint**: the `CPQ` group expands and reveals: `Product Specifications`, `Product Offerings`, `Pricing Tables`, `Price Rules`, `Wizards`, `CPQ Quotes`, `CPQ Orders`, `CPQ Subscriptions`, `Expiring Subscriptions`.

6. **Click `CPQ Subscriptions`.**
   - **Checkpoint**: URL = `/backend/cpq/inventory`. Page header `Customer Inventory`. The `Subscriptions` tab is active. The table has columns: `Code`, `Name`, `Status`, `MRC`, `Billing`, `Start Date`, `Term End`. Among the rows you should see all 11 codes prefixed with `SUB-ARC-...`.

---

# Scenario 1 — Amend (single target)

**Goal**: open an amend quote for one subscription. The new quote pre-fills lines from the source sub's items.

1. **In the subscription table, click the row `SUB-ARC-AMEND-1`** (any cell).
   - **Checkpoint**: URL = `/backend/cpq/inventory/subscriptions/<uuid>`. Header shows the subscription name `Amend Demo — Add / remove items` plus a green `active` status badge. To the right of the badge: three buttons — **`Amend`** (white), **`Renew`** (white with primary border on hover), **`Cancel`** (red outlined).

2. **Click the `Amend` button** in the header.
   - **Checkpoint**: URL changes to `/backend/cpq/quotes/<uuid>` (a fresh quote). The header shows `Quote QUOTE-...` plus a purple **`AMEND`** badge. Below the header is a purple banner: `AMEND • 1 target: SUB-ARC-AMEND-1`.

3. **Scroll to the line list at the bottom of the quote page.**
   - **Checkpoint**: 2 lines pre-filled with `Premium Support Tier` and `Extra Storage 100GB`, both with action `modify`. They mirror the source subscription's items.

✅ **Scenario 1 done.** The quote is configured but not yet activated. To see actual mutation on the subscription, run scenario 11.

---

# Scenario 2 — Multi-target Amend (drawer)

**Goal**: one quote modifies two subscriptions at once. Use the drawer to attach a second target.

1. **Click the `← Back` arrow** in the top-left of the quote page (or sidebar `CPQ Subscriptions`).
2. **In the subscription table, click the row `SUB-ARC-MULTI-A`.**
3. **Click `Amend`** in the header.
   - **Checkpoint**: ARC banner reads `AMEND • 1 target: SUB-ARC-MULTI-A`.

4. **In the quote header, click `Modify subscription`** (white outlined button).
   - **Checkpoint**: a right-side drawer slides in. Title `Modify subscription`. Subtitle shows `Meridian Connectivity Sp. z o.o. • USD`. Step indicator at the top reads `Step: pick-targets • amend • 1 target(s)`.

5. **In the drawer, scroll the eligible-subs list** until you see the row for `SUB-ARC-MULTI-B`.
6. **Click the checkbox** at the left of that row.
   - **Checkpoint**: the `SUB-ARC-MULTI-B` row gets a primary-coloured border. Step indicator updates to `Step: pick-targets • amend • 2 target(s)`.

7. **Click `Next`** in the drawer footer (bottom-right of drawer).
   - **Checkpoint**: step indicator changes to `Step: review • amend • 2 target(s)`. Drawer body shows a summary list with both target codes.

8. **Click `Submit`.**
   - **Checkpoint**: step briefly shows `submitting`, then `done`. Body reads `Done — close to return to the quote.`

9. **Click `Close`.**
   - **Checkpoint**: drawer disappears. The quote page banner now reads `AMEND • 2 targets: SUB-ARC-MULTI-A, SUB-ARC-MULTI-B`. The `Line Items` list now shows items from **both** subs — `Account A — Service` (modify, target=MULTI-A) and `Account B — Service` (modify, target=MULTI-B). Each line is independently editable; leaving them as-is means "no price change" on activation.

✅ **Scenario 2 done.** At Convert→Activate the order will run `applyAmendment` once per target subscription (so 2 separate `cpq.subscription.amended` events, 2 ChangeLog rows — one per sub). Lines unchanged at activation appear in the per-sub Change History as `~ Item Name no price change`.

---

# Scenario 3 — Standalone Renew (from Expiring view)

**Goal**: extend the term of a subscription via the operator triage view.

1. **In the left sidebar, click `Expiring Subscriptions`** (under the CPQ group).
   - **Checkpoint**: URL = `/backend/cpq/inventory/subscriptions/expiring`. Header `Expiring Subscriptions`. Filter bar at top has window presets `7d / 14d / 30d / 60d / 90d` (30d highlighted by default) and a `Billing Cycle` dropdown.
   - The table shows **4 rows**: `SUB-ARC-RENEW-SOON`, `SUB-ARC-MERGE-1`, `SUB-ARC-MERGE-2`, `SUB-ARC-MERGE-3`. Each row has a coloured chip in the `Term End` column (`in 20d`, `in 25d` — yellow). Each row has two action buttons: `Renew` and `Modify`.

2. **In the row `SUB-ARC-RENEW-SOON`, click the `Renew` button.**
   - **Checkpoint**: redirect to `/backend/cpq/quotes/<uuid>`. Banner reads `RENEW • 1 target: SUB-ARC-RENEW-SOON`. **The renewal term is already pre-filled** with "same length starting at the current term end" (so `currentTermEnd` → `currentTermEnd + termMonths`). For the seed sub that's `+20d → +20d + 12mo`.

✅ **Scenario 3 done if the default term works for you** — you can go straight to status transitions / Convert to Order.

### Override the term (optional)

If you want a different start date or length:

3. **Click `Modify subscription`** in the quote header.
   - **Checkpoint**: drawer opens at `Step: pick-targets`, target pre-checked.

4. **Click `Next`** → **Checkpoint**: `config-renew` step. The three inputs (`Start`, `End`, `Months`) are pre-filled from the defaults above.

5. **(a) Type a different value into `Months`** → the `End` date auto-shifts to `Start + Months`. **(b)** Or pick a new `Start` date — if `Months` is set, `End` slides too. **(c)** Or edit `End` directly.

6. **Click `Next`** → review → **`Submit`** → **`Close`**.
   - **Checkpoint**: banner unchanged. New term values are stored on the target row.

---

# Scenario 4 — Merge Renewal (3 → 1 new sub)

**Goal**: consolidate three subscriptions into one new contract. The drawer auto-detects merge mode when 2+ renew targets are picked.

1. **Sidebar → `Expiring Subscriptions`.**
2. **In the row `SUB-ARC-MERGE-1`, click `Renew`.**
   - **Checkpoint**: quote detail page. Banner `RENEW • 1 target: SUB-ARC-MERGE-1`.

3. **In the quote header, click `Modify subscription`** (drawer opens at `pick-targets`).
4. **Find `SUB-ARC-MERGE-2` in the drawer's eligible-subs list. Click its checkbox.**
   - **Checkpoint**: target count = 2. **An amber banner appears inside the drawer**: *"Merging 2 contracts into a new one — sources will be marked Merged at activation."*

5. **Find `SUB-ARC-MERGE-3`. Click its checkbox.**
   - **Checkpoint**: target count = 3. The amber banner now reads *"Merging 3 contracts..."*.

6. **Click `Next`.**
   - **Checkpoint**: step = `config-renew`. The drawer body shows a **different form** than in Scenario 3: still 3 date/number inputs (`Start`, `End`, `Months`), but **plus two text inputs**: `New contract code (optional — auto-generated if blank)` and `New contract name (optional)`.

7. **Fill `Start`** with a date 1 month out, **`End`** 13 months out.
8. **(Optional)** Type into `New contract name` something like `Consolidated NOC contract 2026`.
9. **Click `Next`** → **`Submit`** → **`Close`.**
   - **Checkpoint**: host quote banner reads `RENEW • 3 targets: SUB-ARC-MERGE-1, SUB-ARC-MERGE-2, SUB-ARC-MERGE-3 • Merging into a new contract` (the trailing amber phrase is the merge marker).

✅ **Scenario 4 done.** At order activation a brand-new subscription will be created with the merged items + chosen term; the three sources will transition to `superseded` (terminal).

---

# Scenario 5 — Cancel with reason + ETF

**Goal**: terminate a subscription with a reason code and an early-termination fee.

1. **Sidebar → `CPQ Subscriptions`.**
2. **Click the `SUB-ARC-CANCEL` row.**
   - **Checkpoint**: detail page. Status badge `active`. Three buttons in header: `Amend` / `Renew` / `Cancel`.

3. **Click the red `Cancel` button.**
   - **Checkpoint**: quote detail. Banner reads `CANCEL • 1 target: SUB-ARC-CANCEL`.

4. **In the quote header, click `Modify subscription`** to open the drawer.
   - **Checkpoint**: drawer opens at `pick-targets`. The sub is already checked.

5. **Click `Next`.**
   - **Checkpoint**: step = `config-cancel`. The drawer shows: a `Reason code` dropdown, a `Free text (optional)` input, an `ETF amount (optional)` input, and an `ETF currency` input (defaults to `USD`).

6. **Click the `Reason code` dropdown.** Choose `Non-payment`.
7. **Click the `Free text` field**, type: `Account 90+ days past due`.
8. **Click the `ETF amount` field**, type: `500.00`.
9. **Click `Next`** → **`Submit`** → **`Close`.**
   - **Checkpoint**: banner unchanged (`CANCEL • 1 target...`). The reason + ETF are now stamped on the quote and will surface on the `cpq.subscription.cancelled` event payload at activation.

✅ **Scenario 5 done.**

---

# Scenario 6 — ARC on a suspended subscription

**Goal**: prove ARC works on `suspended` subs without first reactivating them.

1. **Sidebar → `CPQ Subscriptions`.**
2. **Click `SUB-ARC-SUSPENDED`.**
   - **Checkpoint**: detail page. Status badge is **yellow `suspended`** (not green `active`). The three ARC buttons (`Amend` / `Renew` / `Cancel`) are still rendered in the header — spec says active+suspended are valid ARC targets.

3. **Click `Amend`.**
   - **Checkpoint**: quote detail. Banner `AMEND • 1 target: SUB-ARC-SUSPENDED`. Quote configured normally.

4. **Click the `← Back` arrow** to return to the subscription detail.
   - **Checkpoint**: status badge is **still `suspended`** (ARC quote configuration does not flip subscription status — only activation does, and even then only for `cancel`).

✅ **Scenario 6 done.**

---

# Scenario 7 — Terminal-status subs (ARC unavailable)

**Goal**: verify subs in `expired` or `terminated` do **not** show ARC buttons.

## 7a — Expired

1. **Sidebar → `CPQ Subscriptions`.**
2. **Click the row `SUB-ARC-EXPIRED`.**
   - **Checkpoint**: detail page. Status badge is **gray `expired`**. The header **does NOT** show `Amend / Renew / Cancel` buttons (the action row only renders for `active` or `suspended`). The status badge dropdown is empty (no transitions allowed from terminal states).

3. **Scroll down.**
   - **Checkpoint**: items still listed (read-only). Change History section is present.

## 7b — Terminated

1. **Click `← Back`** to the subscription list.
2. **Click `SUB-ARC-TERMINATED`.**
   - **Checkpoint**: detail page. Status badge is **red `terminated`**. Same as 7a — no ARC buttons visible.

✅ **Scenario 7 done.** This confirms the UI gate at line 794 of the spec.

---

# Scenario 8 — Concurrent ARC quote (rejection + redirect)

**Goal**: a subscription can have at most one non-terminal ARC quote at a time. The UI offers a redirect to the existing quote.

1. **Sidebar → `CPQ Subscriptions`.**
2. **Click `SUB-ARC-AMEND-1`.**
3. **Click `Amend`** in the header.
   - **Checkpoint**: quote detail page. **Note the URL** in the address bar (e.g. `/backend/cpq/quotes/abcd1234-...`). This is "Quote 1".

4. **Click `← Back`** in the top-left (back to subscription detail).
5. **Click `Amend` again** on the same subscription.
   - **Checkpoint**: a **browser confirm dialog** appears with text:
     ```
     Subscription has another ARC quote in progress (quoteId=abcd1234-...)

     Open the existing quote now?
     ```
     followed by `OK` and `Cancel` buttons.

6. **Click `OK`** in the confirm dialog.
   - **Checkpoint**: page navigates to **the same Quote 1 URL** you noted in step 3. No new quote was created.

(Alternative: clicking `Cancel` in the dialog leaves you on subscription detail; no navigation, no error.)

✅ **Scenario 8 done.**

---

# Scenario 9 — Expiring view filter window

**Goal**: prove that the window-preset filter narrows / widens the list correctly.

1. **Sidebar → `Expiring Subscriptions`.**
   - **Checkpoint**: 30d preset is highlighted. Table has 4 rows.

2. **Click the `7d` preset** at the top of the filter bar.
   - **Checkpoint**: table is empty. None of the seeded subs has a `currentTermEnd` within 7 days. Empty state message: *"No subscriptions expire within this window."*

3. **Click `90d`.**
   - **Checkpoint**: 6 rows now: `RENEW-SOON` (in 20d), `MERGE-1/2/3` (in 25d), `MULTI-A` (in 60d), `MULTI-B` (in 60d). All four chips show the relative-time labels.

4. **Click the `Billing Cycle` dropdown.** Choose `monthly`.
   - **Checkpoint**: same 6 rows (all seeded subs are monthly).

5. **Click `30d`** to reset to default.
   - **Checkpoint**: back to 4 rows.

✅ **Scenario 9 done.**

---

# Scenario 10 — Change History (audit)

**Goal**: see the audit-trail surface on a subscription. Empty for fresh seeded subs (no activation has happened yet); populated after Scenario 11.

1. **Sidebar → `CPQ Subscriptions`.**
2. **Click any subscription**, e.g. `SUB-ARC-AMEND-1`.
3. **Scroll to the bottom of the detail page.**
   - **Checkpoint**: a section labelled `Change History (0)` with body text *"No ARC changes yet."*

After running Scenario 11 (full activation), this section will list the operations:

> - Badge: `Amended` (blue) / `Renewed` (green) / `Cancelled` (red) / `Created from merging contracts` (purple) / `Merged into a new contract` (orange)
> - Timestamp
> - Link to source quote + source order
> - **Inline per-line breakdown** with `+` / `~` / `−` glyphs, item names,
>   and before/after MRC values (e.g. `~ Premium Support Tier $250.00 → $300.00/mo (+$50.00/mo)`)
> - "Term: <old> → <new>" (for renew)
> - "Reason: ... ETF: ..." (for cancel)
> - "Merged into ..." link (for merge sources)

---

# Scenario 11 — Full lifecycle: from quote to actual subscription mutation

**Goal**: drive an ARC quote through approval → order conversion → activation. After this, the subscription's items / term / status actually changes, the Change History gains an entry, and an event is emitted.

This is the longest scenario but it's the only way to see ARC's *effect*
(not just configuration). Steps 1-3 are the same as Scenario 1.

## 11.1 — Configure the amend quote

1. **Sidebar → `CPQ Subscriptions` → click `SUB-ARC-AMEND-1`.**
2. **Click `Amend`** in the header.
   - **Checkpoint**: quote detail page. Banner `AMEND • 1 target: SUB-ARC-AMEND-1`. Status badge `new`.

## 11.2 — Drive through the approval lifecycle

The quote status badge is **clickable** — clicking it opens a dropdown with allowed next statuses.

3. **Click the purple `new` status badge** in the quote header (next to the quote number).
   - **Checkpoint**: a dropdown appears below the badge with two options: `Incomplete`, `Ready`, `Cancelled`.

4. **Click `Ready`.**
   - **Checkpoint**: badge changes to `ready` (gray-blue). Dropdown closes.

5. **Click the `ready` badge.**
   - **Checkpoint**: dropdown options: `Incomplete`, `In approval`, `Pre-approved`, `With customer`, `Cancelled`.

6. **Click `In approval`.**
   - **Checkpoint**: badge `in_approval`.

7. **Click the badge → click `Approved`.**
   - **Checkpoint**: badge `approved`.

8. **Click the badge → click `With customer`.**
   - **Checkpoint**: badge `with_customer`.

9. **Click the badge → click `Accepted`.**
   - **Checkpoint**: badge `accepted` (green). The status menu is now empty (terminal status). **A new green button appears in the header**: `Convert to Order`.

## 11.3 — Convert to order

10. **Click `Convert to Order`** (green button, top-right).
    - **Checkpoint**: redirect to `/backend/cpq/orders/<uuid>`. Page header `Order ORDER-...`. Status badge `draft`. The order has the same items as the quote.

## 11.4 — Activate the order

11. **Click the green `Activate Order` button** in the top-right of the order header (next to `Cancel Order`).
    - **Checkpoint**: badge changes to `active` (green). A green success banner appears: *"Order activated on … Subscription created."* with a `View Subscription →` link. The activation runs `cpqInventoryService.applyAmendment()` for our target subscription — items are now mutated, ChangeLog row is written, an event is emitted.

> **Note**: the `draft` status badge is read-only for orders. Activation is a dedicated server-side action (it creates / mutates the subscription), not a free-form status transition — so it lives on its own button rather than the status dropdown.

## 11.5 — Verify the mutation

13. **Sidebar → `CPQ Subscriptions` → click `SUB-ARC-AMEND-1`.**
    - **Checkpoint**: detail page. Subscription status still `active` (amend doesn't change status — spec § DD-ARC). The `Subscription Items` section shows the same 2 items (Premium Support Tier, Extra Storage 100GB) — since we didn't actually edit lines in Scenario 1, mrcAmount is unchanged.

14. **Scroll to `Change History` section at the bottom.**
    - **Checkpoint**: section now reads `Change History (1)` with one entry:
      - Blue badge `Amended`
      - Timestamp (just now)
      - Link `Quote QUOTE-...` (clickable → goes to the source quote)
      - Link `Order ORDER-...` (clickable → goes to the source order)
      - **Per-line breakdown** in a muted box: one row per affected item, with
        a glyph (`+` added — green, `~` modified — blue, `−` removed — red),
        the item name, and the price change. For modified items: `$A.AA → $B.BB/mo`
        plus a colored delta `(+$X.XX/mo)` or `(−$X.XX/mo)`. For added/removed
        items: a single price tag (`$X.XX/mo` or `was $X.XX/mo`). Cancel
        entries also list every terminated item even though the underlying
        `lineChanges` array is null — derived from the `beforeSnapshot`.

15. **(Optional) Check the dev terminal** — you should see a placeholder log line:
    ```
    [cpq.arc] amended <subId> changeLog=<logId> order=<orderId>
    ```
    This is `subscribers/subscription-amended-log.ts` doing its thing. In a real
    customer deployment, billing / notifications subscribe to the same event.

✅ **Scenario 11 done.** The same end-to-end pattern applies to renew / cancel / merge — only step 3-9 differ slightly (cancel uses `Cancel` button, merge needs the drawer first, etc.).

### Repeat for cancel (variant)

If you want to see `cpq.subscription.cancelled` plus the cascade (sub → terminated, items → terminated, assets → cancelled):

1. **Pick a fresh sub** (e.g. `SUB-ARC-CANCEL`).
2. Run Scenario 5 (cancel quote with reason + ETF).
3. Run Scenario 11 steps 3-11 on **that** quote.
4. Verify: subscription status badge changes to **`terminated`** (red).
5. Change History shows entry **`Cancelled`** with reason + ETF amount.
6. Items section: every item now `terminated`.

### Repeat for merge (variant)

To see a brand-new merged subscription created:

1. Run Scenario 4 (merge of 3 sources).
2. Run Scenario 11 steps 3-11 on that quote.
3. Verify by going to **Sidebar → `CPQ Subscriptions`**:
   - **3 source subs** (`MERGE-1/2/3`) are now in status **`superseded`** (terminal — different from `terminated`).
   - **A new sub** appears with code `MERGED-...` (auto-generated) or your custom code from the drawer's `New contract code` field.
4. Click the new merged sub.
   - **Checkpoint**: items combined from all three sources. Change History shows entry **`Created from merging 3 contracts`** with the source IDs.

---

# Reset / cleanup

If the data gets messy and you want to start over:

```bash
# Stop the dev server first (Ctrl+C in its terminal)
yarn reinstall    # ~2 minutes — drops + re-creates all tables, runs all seeds
yarn dev          # restart
```

The 11 ARC subscriptions are re-created with the same codes but new
internal UUIDs, and `currentTermEnd` is recomputed relative to today.

---

# Reference (developer)

This section is for developers extending or debugging ARC. Operators don't need it for manual testing.

## ARC type cheat-sheet

| Action | What the quote does | What changes on the sub at activation |
|---|---|---|
| Amend | Adds / removes items on existing subscription(s). Term untouched. | Items added/removed; subscription status unchanged. ChangeLog row written. |
| Renew (standalone) | Extends term + optionally adds/removes items on a single subscription. | `currentTermStart` / `currentTermEnd` / `termMonths` updated; items mutated in place. |
| Renew (merge) | Consolidates 2+ subscriptions into one new sub with a new term. | A **new** subscription row is created with the new term + combined items. All input subs go to `superseded` with `mergedIntoSubscriptionId` → new sub. |
| Cancel | Terminates the subscription(s). | Subscription → `terminated`; items → `terminated`; assets → `cancelled`. |

## Concurrency safeguards

- **One ARC quote per subscription at a time.** `validateArcQuote` and the attach endpoint reject attaching a sub that is already on a non-terminal ARC quote. Operators must resolve the existing quote first (accept, reject, or cancel). UI surfaces this via a confirm dialog (Scenario 8).
- **Optimistic locking on `subscription.version`.** Concurrent activations of two ARC orders touching the same sub: the second activation fails with 409, the order stays in `pending_activation`, retryable. Surfaced as `Concurrent modification detected`.

## ETF (Early Termination Fee)

V1 stores ETF as an operator-entered amount (`arcEtfAmount` + `arcEtfCurrency`) on the cancel quote, surfaced on the `cpq.subscription.cancelled` event. There is no formula engine — billing computes the actual delta from the event payload. Customers wanting policy-driven ETF can override `cpqQuotingService.createQuoteFromSubscription` via DI to pre-populate ETF lines from a `CpqEtfPolicy` entity (extension point EP-ARC-1).

## ACL features

| Feature | What it gates |
|---|---|
| `cpq.arc.amend.manage` | Create / edit a quote with `type='amend'` |
| `cpq.arc.renew.manage` | Create / edit a quote with `type='renew'` (incl. merge) |
| `cpq.arc.cancel.manage` | Create / edit a quote with `type='cancel'` |
| `cpq.arc.changelog.view` | Read `CpqSubscriptionChangeLog` per subscription |
| `cpq.inventory.expiring.view` | View the Expiring Subscriptions list |

ARC quote approval (status transitions through the lifecycle) uses the existing `cpq.quotes.manage` feature — no new approval feature.

## Spec sections relevant to each scenario

- Scenarios 1, 2, 11 — spec § Process 1 (Amend) + § Services / `applyAmendment`
- Scenarios 3, 11 — spec § Process 2 (Renew, standalone) + § Services / `applyRenewal`
- Scenario 4 — spec § Process 2 (merge variant) + § Services / `applyMergeRenewal`
- Scenarios 5, 11 — spec § Process 3 (Cancel) + § Services / `applyCancel`
- Scenario 6 — spec § DD-ARC ("Suspended subs admitted as ARC targets")
- Scenario 7 — spec § UI Integration line 794 (action row gated by status)
- Scenario 8 — spec § UI Integration "Existing-quote redirect" + § Validation
- Scenario 9 — spec § Process 4 (Expiring Subscriptions list view)
- Scenario 10 — spec § Data Models (`CpqSubscriptionChangeLog`)
