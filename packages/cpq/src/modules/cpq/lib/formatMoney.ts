/** Currency amount as shown across CPQ detail pages, e.g. `$1,130.00`. */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
