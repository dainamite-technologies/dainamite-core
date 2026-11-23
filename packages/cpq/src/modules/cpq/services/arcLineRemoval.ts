/**
 * Removing an existing subscription item on an Amend / Renew quote.
 *
 * An ARC quote mirrors each live subscription item as a quote line. Activation
 * only acts on explicit line actions — an item with no line is left untouched —
 * so deleting a mirror line used to keep the item active on the subscription.
 * Instead, "remove" turns the mirror line (and its mirrored components) into a
 * `cancel` line, which activation applies by terminating the item. Lines this
 * quote added under it are dropped. A cancelled line can be restored from the
 * subscription item it mirrors.
 *
 * Cancel quotes are excluded: every line there is already a cancel line.
 */

import { isArcMirrorLine } from './arcPriceFreeze'

export type ArcRemovalLine = {
  quoteLineId: string
  parentLineId?: string | null
  action: string
  configuration: Record<string, unknown> | null | undefined
}

const ITEM_REMOVAL_QUOTE_TYPES = ['amend', 'renew'] as const

function supportsItemRemoval(quoteType: string | null | undefined): boolean {
  return (ITEM_REMOVAL_QUOTE_TYPES as readonly string[]).includes(quoteType ?? '')
}

/** Whether removing this line cancels a subscription item instead of deleting the line. */
export function removalCancelsItem(line: Pick<ArcRemovalLine, 'configuration'>, quoteType: string | null | undefined): boolean {
  return supportsItemRemoval(quoteType) && isArcMirrorLine(line.configuration, quoteType)
}

/** A subscription item marked for removal on an Amend / Renew quote. It is not priced. */
export function isArcCancelledLine(line: Pick<ArcRemovalLine, 'action'>, quoteType: string | null | undefined): boolean {
  return line.action === 'cancel' && supportsItemRemoval(quoteType)
}

/**
 * A line that takes a subscription item away instead of selling it: an Amend / Renew removal
 * (`isArcCancelledLine`) or any line of a Cancel quote. Its costs never bind (conversion guard)
 * and accept no writes.
 */
export function isArcTerminationLine(line: Pick<ArcRemovalLine, 'action'>, quoteType: string | null | undefined): boolean {
  return line.action === 'cancel' && (supportsItemRemoval(quoteType) || quoteType === 'cancel')
}

/** The line and every descendant, root first. */
export function collectLineSubtree<T extends ArcRemovalLine>(root: T, lines: readonly T[]): T[] {
  const children = new Map<string, T[]>()
  for (const line of lines) {
    if (!line.parentLineId) continue
    const siblings = children.get(line.parentLineId) ?? []
    siblings.push(line)
    children.set(line.parentLineId, siblings)
  }
  const out: T[] = []
  const seen = new Set<string>()
  const queue: T[] = [root]
  for (let index = 0; index < queue.length; index++) {
    const line = queue[index]
    if (seen.has(line.quoteLineId)) continue
    seen.add(line.quoteLineId)
    out.push(line)
    queue.push(...(children.get(line.quoteLineId) ?? []))
  }
  return out
}

export type ArcRemovalPlan<T> = {
  /** Mirror lines that become `cancel` lines. */
  cancel: T[]
  /** Roots of quote-added subtrees to delete (each deleted with its descendants). */
  removeRoots: T[]
}

export function planArcLineRemoval<T extends ArcRemovalLine>(root: T, lines: readonly T[], quoteType: string | null | undefined): ArcRemovalPlan<T> {
  const subtree = collectLineSubtree(root, lines)
  const cancel = subtree.filter((line) => isArcMirrorLine(line.configuration, quoteType) && line.action !== 'cancel')
  const remove = subtree.filter((line) => !isArcMirrorLine(line.configuration, quoteType))
  const removeIds = new Set(remove.map((line) => line.quoteLineId))
  const removeRoots = remove.filter((line) => !line.parentLineId || !removeIds.has(line.parentLineId))
  return { cancel, removeRoots }
}

export type ArcRestorePlan<T> = { ok: true; restore: T[] } | { ok: false; reason: 'parent_cancelled' }

/** Restore the line and its cancelled mirrored components; blocked while its parent stays cancelled. */
export function planArcLineRestore<T extends ArcRemovalLine>(root: T, lines: readonly T[], quoteType: string | null | undefined): ArcRestorePlan<T> {
  const parent = root.parentLineId ? lines.find((line) => line.quoteLineId === root.parentLineId) : undefined
  if (parent && isArcCancelledLine(parent, quoteType)) return { ok: false, reason: 'parent_cancelled' }
  const restore = collectLineSubtree(root, lines)
    .filter((line) => isArcCancelledLine(line, quoteType) && isArcMirrorLine(line.configuration, quoteType))
  return { ok: true, restore }
}
