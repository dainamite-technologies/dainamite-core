"use client"
import * as React from 'react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  assetStatusMap,
  formatStatusLabel,
  subscriptionStatusMap,
  type AssetStatus,
  type SubscriptionStatus,
} from '../../../components/statusMaps'

/**
 * Subscription / asset status pill. Looks up the OM Tag variant from the
 * shared maps so palettes stay consistent with the rest of the CPQ surface.
 * Falls back to `neutral` for unknown values so a renamed enum value still
 * renders without crashing.
 */
export function StatusBadge({ status }: { status: string }) {
  const variant =
    subscriptionStatusMap[status as SubscriptionStatus] ??
    assetStatusMap[status as AssetStatus] ??
    'neutral'
  return (
    <Tag variant={variant} dot>
      {formatStatusLabel(status)}
    </Tag>
  )
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
