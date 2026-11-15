import { join } from 'path'
import { MODULE_ROOT, UI_DIRS, collectHardcodedStrings, listSourceFiles } from './sourceScan'

/**
 * No user-facing English literal may bypass `t()` in CPQ UI code
 * (spec 2026-11-15-cpq-multi-language). Data (product / charge / customer
 * names) is never a literal, so it is not affected.
 *
 * ALLOWLIST is for literals that are intentionally not translated; every
 * entry carries a reason. Keyed by `<file>:<text>` so a moved line does not
 * break it.
 */
const ALLOWLIST: Record<string, string> = {
  // Injection-widget metadata has no `titleKey` in the framework's widget
  // contract; the host renders `metadata.title`. Tracked as a framework gap.
  'widgets/injection/order-cpq-tab/widget.ts:CPQ Order': 'framework: widget metadata has no titleKey',
  'widgets/injection/customer-inventory/widget.ts:Customer Inventory': 'framework: widget metadata has no titleKey',
  'widgets/injection/quote-configurator/widget.ts:CPQ Configuration': 'framework: widget metadata has no titleKey',
  'widgets/injection/order-cpq-tab/widget.ts:View the CPQ order associated with this sales order':
    'framework: widget metadata has no descriptionKey',
  'widgets/injection/customer-inventory/widget.ts:Products and services purchased by this customer':
    'framework: widget metadata has no descriptionKey',
  'widgets/injection/quote-configurator/widget.ts:Configure, price, and manage quote offerings':
    'framework: widget metadata has no descriptionKey',
}

describe('cpq UI has no hard-coded user-facing strings', () => {
  it('routes every UI literal through t()', () => {
    const files = UI_DIRS.flatMap((dir) => listSourceFiles(join(MODULE_ROOT, dir)))
    const offenders = collectHardcodedStrings(files)
      .filter((hit) => !(`${hit.file}:${hit.text}` in ALLOWLIST))
      .map((hit) => `${hit.file}:${hit.line}  ${hit.text}`)
    expect(offenders).toEqual([])
  })
})
