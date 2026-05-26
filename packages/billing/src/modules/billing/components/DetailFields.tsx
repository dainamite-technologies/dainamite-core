"use client"
import * as React from 'react'

/**
 * OM/CPQ-standard read-only detail rendering.
 *
 * One bordered card holding a 2-col grid of label-above-value blocks —
 * mirrors the CPQ offering detail "General" section so billing detail
 * pages match the rest of the admin shell.
 */

export function DetailCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

export function DetailField({
  label,
  children,
  fullWidth = false,
}: {
  label: string
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : undefined}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="text-sm py-1">{children}</div>
    </div>
  )
}

/** Compact stat block — card with an optional heading + metric tiles. */
export function StatCard({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      {title ? <h3 className="text-sm font-medium mb-3">{title}</h3> : null}
      <div className="flex flex-wrap gap-x-10 gap-y-4">{children}</div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
