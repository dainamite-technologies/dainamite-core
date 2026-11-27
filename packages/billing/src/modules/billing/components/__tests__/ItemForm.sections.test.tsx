/**
 * @jest-environment node
 *
 * Item form layout (2026-11-27 UX spec §4.4): Rate section (price, VAT,
 * phases) + Billing settings section (recurring only). Layout only — the
 * submitted payload is unchanged. Rendered with react-dom/server and light
 * primitive stubs; the save button's onClick is captured to run the real
 * submit handler.
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let captured: Array<{ label: string; onClick?: () => void }> = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))
jest.mock('next/link', () => ({ __esModule: true, default: (p: { children: React.ReactNode }) => <a>{p.children}</a> }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: () => new Promise(() => {}),
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: (p: { children: React.ReactNode; onClick?: () => void }) => {
    captured.push({ label: String(p.children), onClick: p.onClick })
    return <button>{p.children}</button>
  },
}))
jest.mock('@open-mercato/ui/primitives/input', () => ({ Input: () => <input /> }))
jest.mock('@open-mercato/ui/primitives/textarea', () => ({ Textarea: () => <textarea /> }))
jest.mock('@open-mercato/ui/primitives/switch', () => ({ Switch: () => <input type="checkbox" /> }))
jest.mock('@open-mercato/ui/primitives/kbd', () => ({
  Kbd: (p: { children: React.ReactNode }) => <kbd>{p.children}</kbd>,
  KbdShortcut: () => <kbd />,
}))
jest.mock('@open-mercato/ui/primitives/segmented-control', () => ({
  SegmentedControl: (p: { children: React.ReactNode }) => <div>{p.children}</div>,
  SegmentedControlItem: (p: { children: React.ReactNode }) => <span>{p.children}</span>,
}))
jest.mock('@open-mercato/ui/primitives/select', () => {
  const Pass = (p: { children?: React.ReactNode }) => <>{p.children}</>
  return { Select: Pass, SelectTrigger: Pass, SelectValue: () => null, SelectContent: Pass, SelectItem: Pass }
})
jest.mock('../PhaseEditor', () => ({ PhaseEditor: () => <div>PHASE-EDITOR</div> }))
jest.mock('../ItemPriceField', () => ({
  ItemPriceField: (p: { label: string }) => <div>{`FIELD:${p.label}`}</div>,
}))
jest.mock('../CreditReasonField', () => ({
  CreditReasonField: () => null,
  isCreditReasonRequired: () => false,
}))

import { ItemForm } from '../ItemForm'

function render(initial: Record<string, unknown>, onSubmit = jest.fn()) {
  captured = []
  const html = renderToStaticMarkup(
    <ItemForm
      mode="edit"
      initial={{ billStartDate: '2026-01-01', description: 'Line', billAccountId: 'acc', ...initial } as never}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  )
  const headings = Array.from(html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)).map((m) => m[1])
  return { html, headings, onSubmit }
}

describe('ItemForm sections', () => {
  it('recurring: Rate holds price, VAT and phases; Billing settings holds timing, prorate and period', () => {
    const { html, headings } = render({ type: 'recurring', recurringUnitPrice: '10', phasesEnabled: true })
    const rate = headings.indexOf('Rate')
    const settings = headings.indexOf('Billing settings')
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(settings).toBeGreaterThan(rate)
    const rateIdx = html.indexOf('>Rate<')
    const settingsIdx = html.indexOf('>Billing settings<')
    const between = (needle: string) => html.indexOf(needle)
    for (const needle of ['FIELD:Unit price per cycle', 'VAT rate (%)', 'Price changes over time (phases)', 'PHASE-EDITOR']) {
      expect(between(needle)).toBeGreaterThan(rateIdx)
      expect(between(needle)).toBeLessThan(settingsIdx)
    }
    for (const needle of ['Charge timing', 'Prorate partial periods', 'Bill this line']) {
      expect(between(needle)).toBeGreaterThan(settingsIdx)
    }
  })

  it('one-time: Rate only (amount, VAT); no Billing settings, no phases', () => {
    const { html, headings } = render({ type: 'one_time', oneTimeAmount: '5' })
    expect(headings).toContain('Rate')
    expect(headings).not.toContain('Billing settings')
    expect(html).toContain('FIELD:Amount')
    expect(html).toContain('VAT rate (%)')
    for (const absent of ['Charge timing', 'Prorate partial periods', 'Bill this line', 'Price changes over time']) {
      expect(html).not.toContain(absent)
    }
  })

  it('usage: Rate holds the rate model and VAT; no Billing settings', () => {
    const { html, headings } = render({ type: 'usage', usageUnitPrice: '0.01', uomCode: 'gb' })
    expect(headings).toContain('Rate')
    expect(headings).not.toContain('Billing settings')
    expect(html).toContain('Rate model')
    expect(html).toContain('VAT rate (%)')
    expect(html).not.toContain('Charge timing')
    expect(html).not.toContain('Price changes over time')
  })

  it('submitted payload is unchanged by the layout (recurring)', async () => {
    const { onSubmit } = render({
      type: 'recurring',
      recurringUnitPrice: '10',
      taxRate: '20',
      chargeTiming: 'in_arrears',
      prorate: false,
    })
    const save = captured.find((b) => b.label === 'Save changes')
    await save?.onClick?.()
    expect(onSubmit).toHaveBeenCalledWith({
      billAccountId: 'acc',
      type: 'recurring',
      billStartDate: '2026-01-01',
      description: 'Line',
      rateJson: { unit_price: 10 },
      chargeTiming: 'in_arrears',
      prorate: false,
      taxRate: 20,
      priceBasis: 'net',
      isActive: true,
    })
  })
})
