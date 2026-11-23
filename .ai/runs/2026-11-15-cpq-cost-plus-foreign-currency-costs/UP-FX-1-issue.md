# UP-FX-1 — upstream issue draft (NOT filed; a human files it)

Target repository: `open-mercato/open-mercato` (package `@open-mercato/core`, module `currencies`, observed on 0.9.0).

## Title

`currencies`: rates fetched by the built-in NBP / Raiffeisen providers are never returned by `exchangeRateService.getRate`, and no non-PLN pair (e.g. USD→EUR) exists

## Problem

`exchangeRateService.getRate` finds a rate by an **exact match on the stored `date`, normalized to UTC midnight**, trying one day at a time up to `maxDaysBack`. The built-in providers store their rows under a **different timestamp** and only for **PLN pairs**, so a consumer that asks for "the USD→EUR rate of today" (or any pair, for the date the provider just fetched) gets an empty result, with or without `autoFetch`.

1. **Timestamp mismatch.**
   - `getRate` normalizes the requested date to UTC midnight (`setUTCHours(0, 0, 0, 0)`) and queries `ExchangeRate.date` with equality.
   - NBP parses its effective date as midnight **Europe/Warsaw** and converts to UTC, so rows land at 22:00 / 23:00 UTC of the previous day (DST dependent). They are never equal to a UTC-midnight value.
   - Raiffeisen combines the published date **and time** and parses it as Europe/Warsaw, so its rows land at an arbitrary time of day.
2. **Pair coverage.** Both providers store only `PLN→XXX` and `XXX→PLN`. There is no direct pair between two non-PLN currencies (USD→EUR, GBP→EUR, ...), and `getRate` does not triangulate.
3. **Bid / ask semantics.** The two PLN directions are different rate types (`PLN→XXX` is `1/ask`, `XXX→PLN` is `bid`). A consumer that inverts one direction does not obtain the quoted opposite rate. This is a documentation point, not a bug, but it matters once (1) is fixed.

Rows entered manually through `POST /api/currencies/exchange-rates` at UTC midnight, or by a custom provider that stores UTC-midnight dates, are found correctly. That is the only working path today.

## Evidence (installed `@open-mercato/core` 0.9.0, paths relative to `node_modules/@open-mercato/core/src/modules/currencies/`)

- `services/exchangeRateService.ts:49-77` `getRate` (look-back, `autoFetch`, same-currency throw).
- `services/exchangeRateService.ts:120-160` `findRateWithFallback`: the day-by-day look-back that calls `findExactRates` with a normalized date.
- `services/exchangeRateService.ts:207-224` `findExactRates`: `date: normalizedDate` (equality), not a range.
- `services/exchangeRateService.ts:246-250` `normalizeDate`: `setUTCHours(0, 0, 0, 0)`.
- `services/providers/nbp.ts:32` `providerBaseCurrency = 'PLN'`; `:76-80` effective date parsed with `fromZonedTime(..., 'Europe/Warsaw')`; `:84-106` only `PLN→XXX` (1/ask) and `XXX→PLN` (bid) rows are produced.
- `services/providers/raiffeisen.ts:40` `providerBaseCurrency = 'PLN'`; `:95-98` date + time parsed as Europe/Warsaw; `:106-125` PLN pairs only.
- `data/validators.ts:67-86` the create schema truncates `date` to the minute only, so a manual row keeps whatever instant the caller sends.

## Proposed fix

1. **Date handling.** Make the stored and queried instants agree. Either:
   - normalize the provider-effective date to the UTC calendar day of the *published* date (store `YYYY-MM-DDT00:00:00Z`), or
   - have `findExactRates` match a half-open range for the UTC day (`date >= dayStart AND date < dayStart + 1 day`) so any intra-day timestamp counts, ordering by `date desc` within the day.
   Prefer the first (rows stay unique per pair / day / source and the unique constraint `exchange_rates_pair_datetime_source_unique` keeps meaning); a migration should re-normalize existing provider rows.
2. **Cross pairs.** Optional: let `getRate` triangulate through the provider base currency (USD→PLN→EUR) and report `derivation` / the legs, so non-PLN pairs work for tenants whose only source is NBP / Raiffeisen. At minimum document that only PLN pairs are produced.
3. **Rate type.** Return `type` (`buy` / `sell`) in `RateResult` rows consistently and document that the inverse of one direction is not the other direction's quoted rate.
4. **Tests.** A `getRate` test with a row stored through the NBP provider path (Warsaw midnight, both DST offsets) that must be found for the same calendar day.

## Impact on Dainamite CPQ (`@dainamite/cpq`, cost-plus foreign-currency costs)

CPQ converts foreign-currency cost lines with `exchangeRateService.getRate({ autoFetch: false, maxDaysBack })` (direct pair first, inverse only when no source has a direct rate). It deliberately does not work around the framework (no date-range queries, no own provider). Consequences until this issue is fixed:

- FX works with **manually maintained rates** (UTC midnight) and custom UTC-midnight providers only.
- A tenant that relies on the built-in NBP / Raiffeisen fetch gets `CURRENCY_NO_RATE` on every foreign cost (safe: never a wrong or 1:1 rate). The pair appears in `GET /api/cpq/cost-plus/usage` as `missingFxPairs` and in the cost dialog.
- After a fix, PLN pairs (direct and inverse) work with **no CPQ change**; non-PLN pairs additionally need triangulation (point 2) or manual rates.
