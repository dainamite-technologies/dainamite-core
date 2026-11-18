/**
 * IBAN / BIC helpers for the seller's payment instructions (Spec B). Pure.
 *
 * `normalizeIban` strips spaces and upper-cases; `isValidIban` checks the
 * structure (country code, check digits, 11–30 alphanumerics after) and the
 * ISO 13616 mod-97 checksum. Country-specific lengths are not enforced — the
 * checksum already rejects typos, and a missing country table never blocks a
 * legitimate account.
 */

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder === 1
}

/** Groups of 4 for display ("PL61 1090 1014 …"). */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim()
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.trim().toUpperCase())
}
