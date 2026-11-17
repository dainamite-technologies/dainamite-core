import { evaluateLineCompleteness, type LineCompletenessInput } from '../lineCompleteness'

const base: LineCompletenessInput = {
  lineId: 'line-1',
  attributeErrors: [],
  chargeCount: 0,
  hasChargeDefinitions: true,
  isBundleOffering: false,
  isArcMirrored: false,
  isArcCancelled: false,
}

describe('evaluateLineCompleteness', () => {
  it.each<[string, Partial<LineCompletenessInput>, boolean]>([
    ['valid line with charges', { chargeCount: 2 }, true],
    ['valid line, offering defines no charges (included equipment, #125)', { hasChargeDefinitions: false }, true],
    ['bundle line without its own charges', { isBundleOffering: true }, true],
    ['ARC mirrored line with stored charges only', { isArcMirrored: true }, true],
    ['ARC cancelled line, even with errors', { isArcCancelled: true, attributeErrors: [{ message: 'x' }] }, true],
    ['charges defined but none applies', {}, false],
    ['attribute errors', { chargeCount: 1, attributeErrors: [{ message: 'speed is required' }] }, false],
    ['bundle slot errors', { isBundleOffering: true, bundleSlotErrors: [{ message: 'V-QBUN-1: …' }] }, false],
  ])('%s → configured=%s', (_label, overrides, expected) => {
    expect(evaluateLineCompleteness({ ...base, ...overrides }).isConfigured).toBe(expected)
  })

  it('names the reason with V-LINE-1 when charges exist but none applies', () => {
    const result = evaluateLineCompleteness(base)
    expect(result.errors).toEqual([
      expect.objectContaining({ lineId: 'line-1', type: 'charge', message: expect.stringMatching(/^V-LINE-1:/) }),
    ])
  })

  it('returns no errors for a configured line', () => {
    expect(evaluateLineCompleteness({ ...base, chargeCount: 1 }).errors).toEqual([])
  })

  it('returns attribute and slot errors together, without adding V-LINE-1', () => {
    const result = evaluateLineCompleteness({
      ...base,
      attributeErrors: [{ message: 'a' }],
      bundleSlotErrors: [{ message: 'b' }],
    })
    expect(result.errors.map((e) => e.message)).toEqual(['a', 'b'])
  })
})
