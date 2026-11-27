/**
 * Spread `amount` over charges in proportion to `weights` (spec F-D3).
 *
 * Pure and currency-agnostic: works in cents (2 decimals), so the returned
 * shares always add up to `amount` rounded to the cent.
 *
 * - Each share is floored to the cent; the rounding remainder goes to the
 *   charge with the largest weight (the first one on a tie).
 * - When every weight is 0 (or negative / non-finite), the whole amount goes
 *   to the first charge.
 * - A negative or non-finite amount is treated as 0: a price never goes
 *   below zero.
 */
export function spreadAmount(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return []
  const totalCents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const sum = safe.reduce((acc, weight) => acc + weight, 0)
  const cents = new Array<number>(weights.length).fill(0)
  if (sum <= 0) {
    cents[0] = totalCents
    return cents.map((value) => value / 100)
  }
  let allocated = 0
  let largest = 0
  for (let index = 0; index < safe.length; index++) {
    // The epsilon keeps exact proportions (e.g. 1/4 of 100.00) from flooring a cent low.
    cents[index] = Math.floor((totalCents * safe[index]) / sum + 1e-9)
    allocated += cents[index]
    if (safe[index] > safe[largest]) largest = index
  }
  cents[largest] += totalCents - allocated
  return cents.map((value) => value / 100)
}
