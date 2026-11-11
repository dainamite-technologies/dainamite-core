import {
  collectLineSubtree,
  isArcCancelledLine,
  planArcLineRemoval,
  planArcLineRestore,
  removalCancelsItem,
  type ArcRemovalLine,
} from '../arcLineRemoval'

const mirror = (quoteLineId: string, parentLineId: string | null = null, action = 'modify'): ArcRemovalLine => ({
  quoteLineId,
  parentLineId,
  action,
  configuration: { _arcMirroredFromItemId: `item-${quoteLineId}`, _arcMirroredName: quoteLineId },
})
const added = (quoteLineId: string, parentLineId: string | null = null): ArcRemovalLine => ({
  quoteLineId,
  parentLineId,
  action: 'add',
  configuration: { port_speed: '10G' },
})

describe('removalCancelsItem', () => {
  it.each(['amend', 'renew'])('is true for a mirror line on a %s quote', (quoteType) => {
    expect(removalCancelsItem(mirror('a'), quoteType)).toBe(true)
  })

  it('is false for a line the quote added', () => {
    expect(removalCancelsItem(added('a'), 'amend')).toBe(false)
  })

  it.each(['new', 'cancel', null])('is false on a %s quote', (quoteType) => {
    expect(removalCancelsItem(mirror('a'), quoteType)).toBe(false)
  })
})

describe('isArcCancelledLine', () => {
  it('is true for a cancel line on an Amend / Renew quote', () => {
    expect(isArcCancelledLine({ action: 'cancel' }, 'amend')).toBe(true)
    expect(isArcCancelledLine({ action: 'cancel' }, 'renew')).toBe(true)
  })

  it('is false on a Cancel quote, where every line is a cancel line and keeps its price', () => {
    expect(isArcCancelledLine({ action: 'cancel' }, 'cancel')).toBe(false)
  })

  it('is false for modify / add lines', () => {
    expect(isArcCancelledLine({ action: 'modify' }, 'amend')).toBe(false)
    expect(isArcCancelledLine({ action: 'add' }, 'amend')).toBe(false)
  })
})

describe('collectLineSubtree', () => {
  it('returns the root and every descendant, root first', () => {
    const lines = [mirror('root'), mirror('child', 'root'), mirror('grandchild', 'child'), mirror('other')]
    expect(collectLineSubtree(lines[0], lines).map((l) => l.quoteLineId)).toEqual(['root', 'child', 'grandchild'])
  })

  it('terminates on a parent cycle', () => {
    const a = mirror('a', 'b')
    const b = mirror('b', 'a')
    expect(collectLineSubtree(a, [a, b]).map((l) => l.quoteLineId)).toEqual(['a', 'b'])
  })
})

describe('planArcLineRemoval', () => {
  it('cancels a single mirror line and deletes nothing', () => {
    const line = mirror('port')
    expect(planArcLineRemoval(line, [line, added('new-port')], 'amend')).toEqual({ cancel: [line], removeRoots: [] })
  })

  it('cancels mirrored components with their bundle and deletes components this quote added', () => {
    const bundle = mirror('bundle')
    const existingComponent = mirror('comp-1', 'bundle')
    const newComponent = added('comp-2', 'bundle')
    const newGrandchild = added('comp-2a', 'comp-2')
    const plan = planArcLineRemoval(bundle, [bundle, existingComponent, newComponent, newGrandchild], 'amend')
    expect(plan.cancel.map((l) => l.quoteLineId)).toEqual(['bundle', 'comp-1'])
    // Only the subtree root is deleted — removing it takes its descendants with it.
    expect(plan.removeRoots.map((l) => l.quoteLineId)).toEqual(['comp-2'])
  })

  it('leaves components that are already cancelled alone', () => {
    const bundle = mirror('bundle')
    const cancelled = mirror('comp-1', 'bundle', 'cancel')
    expect(planArcLineRemoval(bundle, [bundle, cancelled], 'amend').cancel).toEqual([bundle])
  })
})

describe('planArcLineRestore', () => {
  it('restores the line and its cancelled mirrored components', () => {
    const bundle = mirror('bundle', null, 'cancel')
    const component = mirror('comp-1', 'bundle', 'cancel')
    const plan = planArcLineRestore(bundle, [bundle, component], 'amend')
    expect(plan).toEqual({ ok: true, restore: [bundle, component] })
  })

  it('is blocked while the parent item is still marked for removal', () => {
    const bundle = mirror('bundle', null, 'cancel')
    const component = mirror('comp-1', 'bundle', 'cancel')
    expect(planArcLineRestore(component, [bundle, component], 'amend')).toEqual({ ok: false, reason: 'parent_cancelled' })
  })

  it('restores a component on its own when the parent stays', () => {
    const bundle = mirror('bundle')
    const component = mirror('comp-1', 'bundle', 'cancel')
    expect(planArcLineRestore(component, [bundle, component], 'amend')).toEqual({ ok: true, restore: [component] })
  })
})
