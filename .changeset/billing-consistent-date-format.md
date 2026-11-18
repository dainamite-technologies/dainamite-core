---
'@dainamite/billing': patch
---

Billing screens show every date in one format (#129).

- All billing pages and panels (transactions, top-ups, payments, invoices, statements, accounts, items, runs, the prepaid panel) format dates with the platform's `formatDisplayDate` / `formatDisplayDateTime` in the app locale, the same as `DataTable` date columns. `NEXT_PUBLIC_OM_DATE_FORMAT` / `NEXT_PUBLIC_OM_DATE_TIME_FORMAT` now apply to billing too. Before, some spots used the browser locale (`toLocaleString()`), so one screen could show three formats.
- The service period stored at the end of a prorated or credit line description (`Fee · 2026-11-16 – 2026-12-11`) is shown in the viewer's date format on the invoice page, transaction lists and the prepaid panel, and in the document locale on the invoice PDF. Stored data is unchanged.
- New helpers: `formatBillingDay` / `formatBillingDateTime` (`lib/displayDate`) and `localizeDescriptionPeriod` (`lib/linePeriod`). `formatDateOnly` is deprecated.
