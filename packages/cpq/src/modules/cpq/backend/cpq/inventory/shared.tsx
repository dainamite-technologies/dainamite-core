"use client"
import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  assetStatusMap,
  formatStatusLabel,
  subscriptionStatusMap,
  type AssetStatus,
  type SubscriptionStatus,
} from '../../../components/statusMaps'

/**
 * Translated display label for a subscription / subscription-item / asset
 * status. The enum value stays the key; unknown values fall back to the
 * title-cased raw value so a renamed enum still renders.
 */
export function inventoryStatusLabel(t: TranslateFn, status: string): string {
  switch (status) {
    case 'pending': return t('cpq.inventory.status.pending', 'Pending')
    case 'active': return t('cpq.inventory.status.active', 'Active')
    case 'delivered': return t('cpq.inventory.status.delivered', 'Delivered')
    case 'returned': return t('cpq.inventory.status.returned', 'Returned')
    case 'suspended': return t('cpq.inventory.status.suspended', 'Suspended')
    case 'terminated': return t('cpq.inventory.status.terminated', 'Terminated')
    case 'expired': return t('cpq.inventory.status.expired', 'Expired')
    case 'cancelled': return t('cpq.inventory.status.cancelled', 'Cancelled')
    default: return formatStatusLabel(status)
  }
}

/** `{ value: label }` map for the given statuses, translated at render time. */
export function buildInventoryStatusLabels(t: TranslateFn, statuses: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const status of statuses) out[status] = inventoryStatusLabel(t, status)
  return out
}

/** Select options for the given statuses, translated at render time. */
export function buildInventoryStatusOptions(
  t: TranslateFn,
  statuses: readonly string[],
): { value: string; label: string }[] {
  return statuses.map((value) => ({ value, label: inventoryStatusLabel(t, value) }))
}

/**
 * Subscription / asset status pill. Looks up the OM Tag variant from the
 * shared maps so palettes stay consistent with the rest of the CPQ surface.
 * Falls back to `neutral` for unknown values so a renamed enum value still
 * renders without crashing.
 */
export function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const variant =
    subscriptionStatusMap[status as SubscriptionStatus] ??
    assetStatusMap[status as AssetStatus] ??
    'neutral'
  return (
    <Tag variant={variant} dot>
      {inventoryStatusLabel(t, status)}
    </Tag>
  )
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
