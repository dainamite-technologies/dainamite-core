"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams, useRouter } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Download, Trash2, Upload } from 'lucide-react'
import { EntriesEditor, type Entry } from './EntriesEditor'
import { exportPricingTableToXlsx } from './xlsxExport'
import {
  commitImportDiff,
  parsePricingTableXlsx,
  type ImportDiff,
} from './xlsxImport'
import { ImportPreview } from './ImportPreview'

type Dimension = { key: string; label: string }
type PriceColumn = { key: string; label: string }

type PricingTable = {
  id: string
  code: string
  name: string
  dimensions: Dimension[]
  priceColumns: PriceColumn[]
  currencyCodeList: string[]
  isActive: boolean
}

const EMPTY_TABLE: PricingTable = {
  id: '',
  code: '',
  name: '',
  dimensions: [],
  priceColumns: [],
  currencyCodeList: ['USD'],
  isActive: true,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function PricingTableDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const urlParams = useParams()
  const id = (props.params?.id ?? urlParams?.id) as string
  const isNew = id === 'new'

  const [table, setTable] = React.useState<PricingTable>(EMPTY_TABLE)
  const [entries, setEntries] = React.useState<Entry[]>([])
  const [loading, setLoading] = React.useState(!isNew)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'view' | 'edit'>(isNew ? 'edit' : 'view')
  const [draft, setDraft] = React.useState<PricingTable>(EMPTY_TABLE)
  const [saving, setSaving] = React.useState(false)

  // Import state
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [importDiff, setImportDiff] = React.useState<ImportDiff | null>(null)
  const [importApplying, setImportApplying] = React.useState(false)

  // ─── Load ────────────────────────────────────────────────────

  const load = React.useCallback(async () => {
    if (isNew) return
    if (!id || !UUID_RE.test(id)) {
      setError('Invalid pricing table ID')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/cpq/pricing-tables?id=${encodeURIComponent(id)}`)
      if (!res.ok) {
        setError('Pricing table not found')
        return
      }
      const data = await res.json()
      const loaded: PricingTable = {
        id: data.id,
        code: data.code,
        name: data.name,
        dimensions: data.dimensions ?? [],
        priceColumns: data.priceColumns ?? [],
        currencyCodeList: data.currencyCodeList ?? ['USD'],
        isActive: data.isActive,
      }
      setTable(loaded)
      setDraft(loaded)
      setEntries(data.entries ?? [])
    } catch (err) {
      console.error('Failed to load pricing table', err)
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id, isNew])

  React.useEffect(() => {
    void load()
  }, [load])

  // ─── Config CRUD ────────────────────────────────────────────

  const startEdit = () => {
    setDraft(table)
    setMode('edit')
    setError(null)
  }

  const cancelEdit = () => {
    if (isNew) {
      router.push('/backend/cpq/pricing')
      return
    }
    setDraft(table)
    setMode('view')
    setError(null)
  }

  // Mirror V-PT-1 from validators.ts so the user gets feedback before the
  // server rejects the payload.
  const configValidationError = React.useMemo(() => {
    if (!draft.code.trim()) return 'Code is required'
    if (!draft.name.trim()) return 'Name is required'
    if (draft.currencyCodeList.length === 0) return 'At least one currency is required'
    const checkList = (items: Array<{ key: string; label: string }>, label: string): string | null => {
      const seen = new Set<string>()
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item.key.trim()) return `${label} #${i + 1}: key is required`
        if (!item.label.trim()) return `${label} #${i + 1}: label is required`
        if (seen.has(item.key)) return `${label}: duplicate key "${item.key}"`
        seen.add(item.key)
      }
      return null
    }
    return checkList(draft.dimensions, 'Dimension') ?? checkList(draft.priceColumns, 'Price Column')
  }, [draft])

  const saveConfig = async () => {
    if (configValidationError) {
      setError(configValidationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        code: draft.code,
        name: draft.name,
        dimensions: draft.dimensions,
        priceColumns: draft.priceColumns,
        currencyCodeList: draft.currencyCodeList,
        isActive: draft.isActive,
      }
      const res = await fetch('/api/cpq/pricing-tables', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? payload : { id, ...payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Failed to ${isNew ? 'create' : 'save'} pricing table`)
        return
      }
      const saved = await res.json()
      if (isNew) {
        router.push(`/backend/cpq/pricing/${saved.id}`)
      } else {
        setTable({ ...draft, id })
        setMode('view')
      }
    } catch (err) {
      console.error('Failed to save', err)
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ─── Excel import ──────────────────────────────────────────

  const handleImportFile = async (file: File) => {
    setError(null)
    const r = await parsePricingTableXlsx(
      file,
      {
        dimensions: table.dimensions,
        priceColumns: table.priceColumns,
        currencyCodeList: table.currencyCodeList,
      },
      entries,
    )
    if (!r.ok) {
      setError(r.error)
      return
    }
    setImportDiff(r.diff)
  }

  const applyImportDiff = async () => {
    if (!importDiff) return
    setImportApplying(true)
    setError(null)
    try {
      const r = await commitImportDiff(table.id, importDiff)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setImportDiff(null)
      await load()
    } finally {
      setImportApplying(false)
    }
  }

  const cancelImport = () => {
    setImportDiff(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deleteTable = async () => {
    if (!window.confirm(t('cpq.pricing.confirmDelete', 'Delete this pricing table and all its entries?'))) return
    try {
      const res = await fetch('/api/cpq/pricing-tables', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        router.push('/backend/cpq/pricing')
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to delete')
      }
    } catch {
      setError('Failed to delete')
    }
  }

  // ─── Render ────────────────────────────────────────────────

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (error && !isNew && !table.id) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/backend/cpq/pricing')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('common.back', 'Back')}
        </button>
        <Alert variant="destructive">{error}</Alert>
      </div>
    )
  }

  const editing = mode === 'edit'
  const view = editing ? draft : table

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/backend/cpq/pricing')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('common.back', 'Back')}
          </button>
          <h1 className="text-2xl font-bold">
            {isNew ? t('cpq.pricing.new', 'New Pricing Table') : table.name}
          </h1>
          {!isNew && (
            <Tag variant={table.isActive ? 'success' : 'neutral'} dot>
              {table.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
            </Tag>
          )}
        </div>
        {!isNew && mode === 'view' && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => exportPricingTableToXlsx(table, entries)}
              title={t('cpq.pricing.export.tooltip', 'Download this pricing table as an Excel file')}
            >
              <Download className="h-4 w-4 mr-1.5" />
              {t('cpq.pricing.export.button', 'Export to Excel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              title={t('cpq.pricing.import.tooltip', 'Upload an Excel file to add / update / delete entries')}
              disabled={importDiff !== null}
            >
              <Upload className="h-4 w-4 mr-1.5" />
              {t('cpq.pricing.import.button', 'Import from Excel')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImportFile(file)
                // reset so re-uploading the same file fires onChange again
                e.target.value = ''
              }}
            />
            <Button type="button" onClick={startEdit}>{t('common.edit', 'Edit')}</Button>
            <Button type="button" variant="destructive" onClick={deleteTable}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        )}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {/* Excel import preview — shown after a file is parsed, hides until user confirms / cancels */}
      {importDiff && (
        <ImportPreview
          diff={importDiff}
          saving={importApplying}
          onConfirm={applyImportDiff}
          onCancel={cancelImport}
        />
      )}

      {/* Configuration section */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Configuration</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfigField label="Code" required>
            {editing ? (
              <Input
                value={view.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="e.g. cloud-connect-pricing"
              />
            ) : (
              <span className="font-mono text-sm">{view.code}</span>
            )}
          </ConfigField>
          <ConfigField label="Name" required>
            {editing ? (
              <Input
                value={view.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Cloud Connect Pricing"
              />
            ) : (
              <span className="font-medium text-sm">{view.name}</span>
            )}
          </ConfigField>
          <ConfigField label="Currencies (comma-separated)" required>
            {editing ? (
              <Input
                value={view.currencyCodeList.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    currencyCodeList: e.target.value
                      .split(',')
                      .map((s) => s.trim().toUpperCase())
                      .filter(Boolean),
                  })
                }
                placeholder="USD, EUR"
              />
            ) : (
              <span className="text-sm">{view.currencyCodeList.join(', ') || '—'}</span>
            )}
          </ConfigField>
          <ConfigField label="Active">
            {editing ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={view.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  className="rounded border"
                />
                {view.isActive ? 'Yes' : 'No'}
              </label>
            ) : (
              <span className="text-sm">{view.isActive ? 'Yes' : 'No'}</span>
            )}
          </ConfigField>
        </div>

        <KeyLabelListEditor
          title="Dimensions"
          description="Lookup keys for matching entries (e.g. region, tier). Leave empty if you use tier ranges only."
          items={view.dimensions}
          editing={editing}
          onChange={(dimensions) => setDraft({ ...draft, dimensions })}
        />

        <KeyLabelListEditor
          title="Price Columns"
          description="Each price column becomes a numeric field on every entry. Charges reference one column by its key."
          items={view.priceColumns}
          editing={editing}
          onChange={(priceColumns) => setDraft({ ...draft, priceColumns })}
        />

        {editing && (
          <>
            {configValidationError && (
              <Alert variant="destructive">{configValidationError}</Alert>
            )}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                type="button"
                onClick={saveConfig}
                disabled={saving || configValidationError !== null}
              >
                {saving ? 'Saving...' : (isNew ? 'Create Pricing Table' : 'Save')}
              </Button>
              <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Entries section — only when table exists */}
      {!isNew && (
        <EntriesEditor
          table={{
            id: table.id,
            dimensions: table.dimensions,
            priceColumns: table.priceColumns,
            currencyCodeList: table.currencyCodeList,
          }}
          initialEntries={entries}
          onSaved={() => {
            void load()
          }}
        />
      )}
    </div>
  )
}

// ─── ConfigField ────────────────────────────────────────────────

function ConfigField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs mb-1">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </div>
      <div>{children}</div>
    </div>
  )
}

// ─── KeyLabelListEditor (dimensions / price columns) ─────────

function KeyLabelListEditor({
  title,
  description,
  items,
  editing,
  onChange,
}: {
  title: string
  description: string
  items: Array<{ key: string; label: string }>
  editing: boolean
  onChange: (next: Array<{ key: string; label: string }>) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {items.length === 0 && !editing && (
        <div className="text-xs text-muted-foreground italic">—</div>
      )}

      {items.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs">
                <th className="px-3 py-2 text-left font-medium">
                  Key {editing && <span className="text-destructive">*</span>}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  Label {editing && <span className="text-destructive">*</span>}
                </th>
                {editing && <th className="px-3 py-2 w-8" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {editing ? (
                      <Input
                        value={item.key}
                        onChange={(e) => {
                          const next = [...items]
                          next[idx] = { ...item, key: e.target.value }
                          onChange(next)
                        }}
                        placeholder="e.g. region"
                        className="h-8"
                      />
                    ) : (
                      <span className="font-mono text-xs">{item.key}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <Input
                        value={item.label}
                        onChange={(e) => {
                          const next = [...items]
                          next[idx] = { ...item, label: e.target.value }
                          onChange(next)
                        }}
                        placeholder="Region"
                        className="h-8"
                      />
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </td>
                  {editing && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onChange(items.filter((_, i) => i !== idx))}
                        className="text-destructive hover:bg-destructive/10 rounded p-1"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, { key: '', label: '' }])}
        >
          + Add {title.slice(0, -1)}
        </Button>
      )}
    </div>
  )
}
