import { lineAmountsFromGross, lineAmountsFromNet, type VatAmounts } from './vat'

/**
 * Basis-aware line VAT — the single entry point for every billing line
 * (Spec F, P-D3): invoice drafts, dry / test previews and prepaid debits.
 *
 * An item price is stored as typed, on its `price_basis`:
 *   - `net`:   tax = round2(net × rate), gross = net + tax
 *   - `gross`: net = round2(gross / (1 + rate)), tax = gross − net
 * so a gross the operator typed is exactly the gross on the document.
 * Rounding happens once per line, on the extended amount
 * (unit × quantity × proration), never per unit.
 */

export type PriceBasis = 'net' | 'gross'

export type LineVatInput = {
  /** Extended line amount on `priceBasis` (unit × quantity × proration). */
  amount: number | string
  priceBasis: PriceBasis
  /** VAT rate in percent. */
  taxRate: number | string
}

function toNumber(value: number | string): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

export function lineVat(input: LineVatInput): VatAmounts {
  const amount = toNumber(input.amount)
  const rate = toNumber(input.taxRate)
  return input.priceBasis === 'gross' ? lineAmountsFromGross(amount, rate) : lineAmountsFromNet(amount, rate)
}

/** Resolve a stored basis value (anything but `gross` reads as `net`). */
export function priceBasisOf(value: unknown): PriceBasis {
  return value === 'gross' ? 'gross' : 'net'
}

/**
 * Net unit price for `billing_invoice_lines.unit_price_net` (display only,
 * 4 dp). Net basis keeps the typed unit price; gross basis derives it.
 */
export function unitPriceNetOf(unitPrice: number | string, priceBasis: PriceBasis, taxRate: number | string): string {
  const unit = toNumber(unitPrice)
  if (priceBasis !== 'gross') return unit.toFixed(4)
  const rate = toNumber(taxRate)
  const net = rate > 0 ? unit / (1 + rate / 100) : unit
  const sign = net < 0 ? -1 : 1
  return ((sign * Math.round((Math.abs(net) + Number.EPSILON) * 10000)) / 10000).toFixed(4)
}

/**
 * The counterpart of a typed unit price, for the ItemForm preview: the gross
 * of a net price or the net of a gross price (2 dp, same rule as the lines).
 */
export function counterpartAmount(amount: number | string, priceBasis: PriceBasis, taxRate: number | string): number {
  const vat = lineVat({ amount, priceBasis, taxRate })
  return priceBasis === 'gross' ? vat.net : vat.gross
}
