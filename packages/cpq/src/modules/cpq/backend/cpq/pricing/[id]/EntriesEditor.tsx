"use client"
import * as React from 'react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Trash2 } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────

export type Dimension = { key: string; label: string }
export type PriceColumn = { key: string; label: string }

export type PricingTableShape = {
  id: string
  dimensions: Dimension[]
  priceColumns: PriceColumn[]
  currencyCodeList: string[]
}

export type Entry = {
  id: string
  dimensionValues: Record<string, string>
  tierNumber: number | null
  rangeFrom: string | null
  rangeTo: string | null
  currencyCode: string
  prices: Record<string, number>
}

type DraftEntry = Entry & {
  // null = unchanged, 'new' = added locally, 'modified' = field edited,
  // 'deleted' = pending delete (hidden from main grid but kept for save diff).
  _state: null | 'new' | 'modified' | 'deleted'
  _localId: string
}

type SaveResult = { ok: true } | { ok: false; error: string }

// ─── Component ──────────────────────────────────────────────────

export function EntriesEditor({
  table,
  initialEntries,
  onSaved,
}: {
  table: PricingTableShape
  initialEntries: Entry[]
  onSaved: (entries: Entry[]) => void
}) {
  const [drafts, setDrafts] = React.useState<DraftEntry[]>(() =>
    initialEntries.map((e) => ({ ...e, _state: null, _localId: e.id })),
  )
  const [mode, setMode] = React.useState<'view' | 'edit'>('view')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Sync external changes (e.g. parent reloads after config save).
  React.useEffect(() => {
    setDrafts(initialEntries.map((e) => ({ ...e, _state: null, _localId: e.id })))
  }, [initialEntries])

  const hasTieredEntries = drafts.some((d) => d.tierNumber != null && d._state !== 'deleted')
  const visibleDrafts = drafts.filter((d) => d._state !== 'deleted')
  const dirty = drafts.some((d) => d._state !== null)

  // ─── Mutation helpers ─────────────────────────────────────────

  const newLocalId = React.useCallback(() => `new-${Math.random().toString(36).slice(2, 10)}`, [])

  const addRow = (asTiered: boolean) => {
    const seed: DraftEntry = {
      id: '',
      _localId: newLocalId(),
      _state: 'new',
      dimensionValues: Object.fromEntries(table.dimensions.map((d) => [d.key, ''])),
      tierNumber: asTiered ? (drafts.filter((d) => d.tierNumber != null).length + 1) : null,
      rangeFrom: asTiered ? '0' : null,
      rangeTo: asTiered ? null : null,
      currencyCode: table.currencyCodeList[0] ?? 'USD',
      prices: Object.fromEntries(table.priceColumns.map((c) => [c.key, 0])),
    }
    setDrafts((prev) => [...prev, seed])
  }

  const updateRow = (localId: string, patch: Partial<DraftEntry>) => {
    setDrafts((prev) =>
      prev.map((d) =>
        d._localId === localId
          ? { ...d, ...patch, _state: d._state === 'new' ? 'new' : 'modified' }
          : d,
      ),
    )
  }

  const deleteRow = (localId: string) => {
    setDrafts((prev) =>
      prev.flatMap((d) => {
        if (d._localId !== localId) return [d]
        // New (not yet persisted) → drop entirely. Persisted → mark for delete.
        if (d._state === 'new') return []
        return [{ ...d, _state: 'deleted' }]
      }),
    )
  }

  const cancelEdit = () => {
    // Revert to initial — drop any local mutations.
    setDrafts(initialEntries.map((e) => ({ ...e, _state: null, _localId: e.id })))
    setError(null)
    setMode('view')
  }

  // ─── Save (diff against initialEntries) ───────────────────────

  const save = async (): Promise<SaveResult> => {
    setSaving(true)
    setError(null)
    try {
      // POST new entries (batch — route accepts arrays)
      const news = drafts.filter((d) => d._state === 'new')
      if (news.length > 0) {
        const payload = news.map((d) => ({
          pricingTableId: table.id,
          dimensionValues: d.dimensionValues,
          tierNumber: d.tierNumber ?? undefined,
          rangeFrom: d.rangeFrom != null ? Number(d.rangeFrom) : undefined,
          rangeTo: d.rangeTo != null ? Number(d.rangeTo) : undefined,
          currencyCode: d.currencyCode,
          prices: d.prices,
        }))
        const res = await fetch('/api/cpq/pricing-table-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          return { ok: false, error: body.error ?? 'Failed to create entries' }
        }
      }

      // PUT modified entries (one-by-one, route doesn't batch updates)
      const mods = drafts.filter((d) => d._state === 'modified')
      for (const d of mods) {
        const res = await fetch('/api/cpq/pricing-table-entries', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: d.id,
            dimensionValues: d.dimensionValues,
            tierNumber: d.tierNumber ?? null,
            rangeFrom: d.rangeFrom != null ? Number(d.rangeFrom) : null,
            rangeTo: d.rangeTo != null ? Number(d.rangeTo) : null,
            currencyCode: d.currencyCode,
            prices: d.prices,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          return { ok: false, error: body.error ?? `Failed to update entry ${d.id}` }
        }
      }

      // DELETE removed entries
      const dels = drafts.filter((d) => d._state === 'deleted')
      for (const d of dels) {
        const res = await fetch('/api/cpq/pricing-table-entries', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: d.id }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          return { ok: false, error: body.error ?? `Failed to delete entry ${d.id}` }
        }
      }

      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to save entries' }
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const r = await save()
    if (!r.ok) {
      setError(r.error)
      return
    }
    // Reload from server via parent (which re-fetches the pricing table
    // and pushes a fresh `initialEntries` down — useEffect resets drafts).
    onSaved([])
    setMode('view')
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Entries ({visibleDrafts.length})
        </h2>
        <div className="flex items-center gap-2">
          {mode === 'view' ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setMode('edit')}>
              Edit Entries
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => addRow(false)}>
                + Add Row
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addRow(true)}>
                + Add Tier
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {visibleDrafts.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {mode === 'edit'
            ? 'No entries yet — use "+ Add Row" (dimensions lookup) or "+ Add Tier" (range lookup).'
            : 'No entries in this pricing table.'}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {hasTieredEntries && (
                  <>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Tier #</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Range From</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Range To</th>
                  </>
                )}
                {table.dimensions.map((dim) => (
                  <th key={dim.key} className="px-3 py-3 text-left font-medium whitespace-nowrap">
                    {dim.label}
                  </th>
                ))}
                {table.priceColumns.map((col) => (
                  <th key={col.key} className="px-3 py-3 text-right font-medium whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-3 text-left font-medium">Currency</th>
                {mode === 'edit' && <th className="px-3 py-3 w-8" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {visibleDrafts.map((entry) => (
                <EntryRow
                  key={entry._localId}
                  entry={entry}
                  table={table}
                  hasTieredEntries={hasTieredEntries}
                  mode={mode}
                  onChange={(patch) => updateRow(entry._localId, patch)}
                  onDelete={() => deleteRow(entry._localId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Row sub-component ──────────────────────────────────────────

function EntryRow({
  entry,
  table,
  hasTieredEntries,
  mode,
  onChange,
  onDelete,
}: {
  entry: DraftEntry
  table: PricingTableShape
  hasTieredEntries: boolean
  mode: 'view' | 'edit'
  onChange: (patch: Partial<DraftEntry>) => void
  onDelete: () => void
}) {
  const readOnly = mode === 'view'
  const rowBg = entry._state === 'new'
    ? 'bg-success/5'
    : entry._state === 'modified'
      ? 'bg-warning/5'
      : ''

  return (
    <tr className={`border-b hover:bg-muted/30 ${rowBg}`}>
      {hasTieredEntries && (
        <>
          <td className="px-3 py-2">
            {readOnly ? (
              entry.tierNumber ?? '—'
            ) : (
              <Input
                type="number"
                value={entry.tierNumber ?? ''}
                onChange={(e) => onChange({ tierNumber: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-20 h-8"
              />
            )}
          </td>
          <td className="px-3 py-2">
            {readOnly ? (
              entry.rangeFrom ?? '—'
            ) : (
              <Input
                type="number"
                value={entry.rangeFrom ?? ''}
                onChange={(e) => onChange({ rangeFrom: e.target.value === '' ? null : e.target.value })}
                className="w-24 h-8"
              />
            )}
          </td>
          <td className="px-3 py-2">
            {readOnly ? (
              entry.rangeTo ?? '—'
            ) : (
              <Input
                type="number"
                value={entry.rangeTo ?? ''}
                onChange={(e) => onChange({ rangeTo: e.target.value === '' ? null : e.target.value })}
                placeholder="∞"
                className="w-24 h-8"
              />
            )}
          </td>
        </>
      )}
      {table.dimensions.map((dim) => (
        <td key={dim.key} className="px-3 py-2">
          {readOnly ? (
            entry.dimensionValues?.[dim.key] ?? '—'
          ) : (
            <Input
              value={entry.dimensionValues?.[dim.key] ?? ''}
              onChange={(e) =>
                onChange({
                  dimensionValues: { ...entry.dimensionValues, [dim.key]: e.target.value },
                })
              }
              className="w-28 h-8"
            />
          )}
        </td>
      ))}
      {table.priceColumns.map((col) => (
        <td key={col.key} className="px-3 py-2 text-right font-mono">
          {readOnly ? (
            entry.prices?.[col.key] != null ? Number(entry.prices[col.key]).toFixed(2) : '—'
          ) : (
            <Input
              type="number"
              step="0.01"
              value={entry.prices?.[col.key] ?? ''}
              onChange={(e) =>
                onChange({
                  prices: {
                    ...entry.prices,
                    [col.key]: e.target.value === '' ? 0 : Number(e.target.value),
                  },
                })
              }
              className="w-24 h-8 text-right"
            />
          )}
        </td>
      ))}
      <td className="px-3 py-2">
        {readOnly ? (
          entry.currencyCode
        ) : (
          <Select
            value={entry.currencyCode}
            onValueChange={(value) => onChange({ currencyCode: value })}
          >
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {table.currencyCodeList.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>
      {mode === 'edit' && (
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 rounded p-1"
            aria-label="Delete row"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
  )
}

