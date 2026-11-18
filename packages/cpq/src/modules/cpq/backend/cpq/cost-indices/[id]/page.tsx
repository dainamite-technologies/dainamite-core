"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Plus, Power, Upload } from 'lucide-react'
import { CpqInteractionStyles } from '../../../../components/CpqListView'
import { useGrantedFeatures } from '../../../../components/useGrantedFeatures'
import { COST_INDEX_WRITE_FEATURES } from '../../../../data/cost-indices'
import {
  COST_PLUS_OFF_FALLBACK,
  VALUE_BADGE_FALLBACKS,
  VALUE_BADGE_VARIANTS,
  classifyIndexError,
  elementChargeLabel,
  formatCurrentValue,
  formatIndexDate,
  formatIndexValue,
  valueBadges,
  type CostIndexDetail,
  type CostIndexFailure,
  type CostIndexValueRow,
} from '../../../../lib/costIndexView'
import { IndexErrorAlert, IndexField } from '../_components/dialogShared'
import { AddValueDialog } from './_components/AddValueDialog'
import { ImportValuesDialog } from './_components/ImportValuesDialog'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALUES_PAGE_SIZE = 25
const LIST_HREF = '/backend/cpq/cost-indices'

type ValuesResponse = { items?: CostIndexValueRow[]; total?: number; totalPages?: number }
type Draft = { name: string; unit: string; description: string; currencyCode: string }
type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'notFound' } | { kind: 'toggleOff' } | { kind: 'error' }

export default function CpqCostIndexDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const urlParams = useParams()
  const id = String(props.params?.id ?? (urlParams as { id?: string } | null)?.id ?? '')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const granted = useGrantedFeatures(COST_INDEX_WRITE_FEATURES)
  const canWrite = COST_INDEX_WRITE_FEATURES.every((feature) => granted.includes(feature))

  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })
  const [detail, setDetail] = React.useState<CostIndexDetail | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [failure, setFailure] = React.useState<CostIndexFailure | null>(null)
  const [dialog, setDialog] = React.useState<'value' | 'import' | null>(null)

  const [values, setValues] = React.useState<CostIndexValueRow[]>([])
  const [valuesTotal, setValuesTotal] = React.useState(0)
  const [valuesPages, setValuesPages] = React.useState(1)
  const [valuesPage, setValuesPage] = React.useState(1)
  const [valuesLoading, setValuesLoading] = React.useState(true)
  const [showCorrections, setShowCorrections] = React.useState(false)

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  React.useEffect(() => {
    if (!UUID_RE.test(id)) { setState({ kind: 'notFound' }); return }
    let cancelled = false
    void (async () => {
      const call = await apiCall<CostIndexDetail>(`/api/cpq/cost-indices/${id}`)
      if (cancelled) return
      if (call.ok && call.result?.item) { setDetail(call.result); setState({ kind: 'ready' }); return }
      const failed = classifyIndexError(call.status, call.result)
      if (failed.toggleOff) setState({ kind: 'toggleOff' })
      else if (call.status === 404) setState({ kind: 'notFound' })
      else setState({ kind: 'error' })
    })()
    return () => { cancelled = true }
  }, [id, reloadToken])

  React.useEffect(() => {
    if (state.kind !== 'ready') return
    let cancelled = false
    void (async () => {
      setValuesLoading(true)
      const params = new URLSearchParams({ page: String(valuesPage), pageSize: String(VALUES_PAGE_SIZE), includeSuperseded: String(showCorrections) })
      const call = await apiCall<ValuesResponse>(`/api/cpq/cost-indices/${id}/values?${params}`)
      if (cancelled) return
      if (call.ok && call.result) {
        const items = Array.isArray(call.result.items) ? call.result.items : []
        setValues(items)
        setValuesTotal(typeof call.result.total === 'number' ? call.result.total : items.length)
        setValuesPages(typeof call.result.totalPages === 'number' ? Math.max(1, call.result.totalPages) : 1)
      } else {
        flash(t('cpq.costIndices.error.loadValues', 'Failed to load values'), 'error')
      }
      setValuesLoading(false)
    })()
    return () => { cancelled = true }
  }, [id, showCorrections, valuesPage, reloadToken, state.kind, t])

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true); setFailure(null)
    const call = await apiCall<{ item?: unknown }>(`/api/cpq/cost-indices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (call.ok) { flash(t('cpq.costIndices.flash.saved', 'Cost index saved'), 'success'); setEditing(false); reload(); return true }
    setFailure(classifyIndexError(call.status, call.result))
    return false
  }

  const remove = async () => {
    const ok = await confirm({
      title: t('cpq.costIndices.delete.title', 'Delete this cost index?'),
      text: t('cpq.costIndices.delete.text', 'Its values are kept for the snapshots of existing quotes. An index that cost elements use cannot be deleted.'),
      confirmText: t('cpq.costIndices.delete.confirm', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    setFailure(null)
    const call = await apiCall<unknown>(`/api/cpq/cost-indices/${id}`, { method: 'DELETE' })
    if (call.ok) { flash(t('cpq.costIndices.flash.deleted', 'Cost index deleted'), 'success'); router.push(LIST_HREF); return }
    setFailure(classifyIndexError(call.status, call.result))
  }

  const columns = React.useMemo<ColumnDef<CostIndexValueRow>[]>(() => [
    { id: 'effectiveDate', header: t('cpq.costIndices.values.effectiveDate', 'Effective date'), cell: ({ row }) => <span className="text-sm">{formatIndexDate(row.original.effectiveDate)}</span> },
    { id: 'value', header: t('cpq.costIndices.values.value', 'Value'), cell: ({ row }) => <span className="text-sm font-medium">{formatIndexValue(row.original.value)}</span> },
    { id: 'revision', header: t('cpq.costIndices.values.revision', 'Revision'), cell: ({ row }) => <span className="text-sm">r{row.original.revision}</span> },
    {
      id: 'status',
      header: t('cpq.costIndices.values.status', 'Status'),
      cell: ({ row }) => (
        <span className="inline-flex flex-wrap gap-1">
          {valueBadges(row.original).map((badge) => (
            <Tag key={badge} variant={VALUE_BADGE_VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-index-badge-${badge}`}>
              {t(`cpq.costIndices.badges.${badge}`, VALUE_BADGE_FALLBACKS[badge])}
            </Tag>
          ))}
        </span>
      ),
    },
    { id: 'note', header: t('cpq.costIndices.values.note', 'Note'), cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.sourceNote ?? '—'}</span> },
    { id: 'createdAt', header: t('cpq.costIndices.values.recorded', 'Recorded'), cell: ({ row }) => <span className="text-xs text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span> },
  ], [t])

  if (state.kind === 'loading') return <Page><PageBody><LoadingMessage label={t('cpq.costIndices.detail.loading', 'Loading cost index…')} /></PageBody></Page>
  if (state.kind === 'toggleOff') return <Page><PageBody><ErrorMessage label={t('cpq.costIndices.toggleOff', COST_PLUS_OFF_FALLBACK)} /></PageBody></Page>
  if (state.kind === 'notFound') {
    return (
      <Page><PageBody>
        <ErrorMessage
          label={t('cpq.costIndices.detail.notFound', 'Cost index not found')}
          action={<Button asChild variant="outline" size="sm"><Link href={LIST_HREF}>{t('cpq.costIndices.detail.backToList', 'Back to cost indices')}</Link></Button>}
        />
      </PageBody></Page>
    )
  }
  if (state.kind === 'error' || !detail) {
    return (
      <Page><PageBody>
        <ErrorMessage
          label={t('cpq.costIndices.detail.error', 'Failed to load the cost index')}
          action={<Button variant="outline" size="sm" onClick={() => { setState({ kind: 'loading' }); reload() }}>{t('cpq.costIndices.detail.retry', 'Retry')}</Button>}
        />
      </PageBody></Page>
    )
  }

  const { item } = detail
  const currencyLocked = detail.elements.length > 0 || valuesTotal > 0
  const currentLabel = formatCurrentValue(detail.current)
  const startEdit = () => { setDraft({ name: item.name, unit: item.unit, description: item.description ?? '', currencyCode: item.currencyCode }); setFailure(null); setEditing(true) }
  const saveEdit = () => {
    if (!draft || saving || !draft.name.trim() || !draft.unit.trim()) return
    const body: Record<string, unknown> = {}
    if (draft.name.trim() !== item.name) body.name = draft.name.trim()
    if (draft.unit.trim() !== item.unit) body.unit = draft.unit.trim()
    if (draft.description.trim() !== (item.description ?? '')) body.description = draft.description.trim() || null
    if (draft.currencyCode !== item.currencyCode) body.currencyCode = draft.currencyCode
    if (Object.keys(body).length === 0) { setEditing(false); return }
    void patch(body)
  }

  const menuActions = canWrite
    ? [
        { id: 'add-value', label: t('cpq.costIndices.addValue.title', 'Add value'), icon: Plus, onSelect: () => setDialog('value'), disabled: !item.isActive },
        { id: 'import', label: t('cpq.costIndices.import.title', 'Import values'), icon: Upload, onSelect: () => setDialog('import') },
        {
          id: 'toggle-active',
          label: item.isActive ? t('cpq.costIndices.actions.deactivate', 'Deactivate') : t('cpq.costIndices.actions.activate', 'Activate'),
          icon: Power,
          onSelect: () => void patch({ isActive: !item.isActive }),
        },
      ]
    : undefined

  return (
    <Page>
      <PageBody className="cpq-list-view space-y-6">
        <CpqInteractionStyles />
        <FormHeader
          mode="detail"
          backHref={LIST_HREF}
          backLabel={t('cpq.costIndices.detail.backToList', 'Back to cost indices')}
          entityTypeLabel={t('cpq.costIndices.detail.entity', 'Cost index')}
          title={`${item.code} · ${item.name}`}
          statusBadge={
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Tag variant={item.isActive ? 'success' : 'neutral'} dot>{item.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}</Tag>
              <span className="text-sm text-muted-foreground" data-testid="cpq-cost-index-current">
                {currentLabel ?? t('cpq.costIndices.noValueYet', 'No value yet')}
              </span>
            </div>
          }
          menuActions={menuActions}
          onDelete={canWrite ? () => void remove() : undefined}
        />
        <IndexErrorAlert failure={failure} />

        <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="cpq-cost-index-master">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('cpq.costIndices.detail.master', 'Details')}</h3>
            {canWrite && !editing && <Button variant="outline" size="sm" onClick={startEdit} data-testid="cpq-cost-index-edit">{t('cpq.costIndices.actions.edit', 'Edit')}</Button>}
          </div>
          {editing && draft ? (
            <div className="space-y-3 text-sm" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); saveEdit() } else if (event.key === 'Escape') setEditing(false) }}>
              <div className="grid grid-cols-3 gap-3">
                <IndexField label={t('cpq.costIndices.fields.code', 'Code')} hint={t('cpq.costIndices.fields.codeHint', 'Cannot be changed later')}>
                  <Input value={item.code} disabled readOnly />
                </IndexField>
                <IndexField label={`${t('cpq.costIndices.fields.name', 'Name')} *`}>
                  <Input autoFocus value={draft.name} maxLength={200} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </IndexField>
                <IndexField label={`${t('cpq.costIndices.fields.unit', 'Unit')} *`}>
                  <Input value={draft.unit} maxLength={40} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
                </IndexField>
                <IndexField
                  label={t('cpq.costIndices.fields.currency', 'Currency')}
                  hint={currencyLocked ? t('cpq.costIndices.fields.currencyLocked', 'Locked: the index has values or cost elements that use it') : undefined}
                >
                  <Input
                    value={draft.currencyCode}
                    maxLength={3}
                    disabled={currencyLocked}
                    title={currencyLocked ? t('cpq.costIndices.fields.currencyLocked', 'Locked: the index has values or cost elements that use it') : undefined}
                    onChange={(event) => setDraft({ ...draft, currencyCode: event.target.value.toUpperCase() })}
                  />
                </IndexField>
              </div>
              <IndexField label={t('cpq.costIndices.fields.description', 'Description')}>
                <Textarea rows={2} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </IndexField>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)}>{t('cpq.costIndices.cancel', 'Cancel')}</Button>
                <Button onClick={saveEdit} disabled={saving} title="Ctrl/Cmd+Enter" data-testid="cpq-cost-index-save">{saving ? t('cpq.costIndices.saving', 'Saving…') : t('cpq.costIndices.actions.save', 'Save')}</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-4 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">{t('cpq.costIndices.fields.unit', 'Unit')}</dt><dd>{item.unit}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('cpq.costIndices.fields.currency', 'Currency')}</dt><dd>{item.currencyCode}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('cpq.costIndices.detail.futureValues', 'Future values')}</dt><dd>{detail.futureValueCount}</dd></div>
              <div className="col-span-4"><dt className="text-xs text-muted-foreground">{t('cpq.costIndices.fields.description', 'Description')}</dt><dd>{item.description || '—'}</dd></div>
            </dl>
          )}
        </section>

        <InjectionSpot spotId="detail:cpq.cost_index" context={{ indexId: item.id, code: item.code, isActive: item.isActive, canWrite }} />

        <section className="space-y-3" data-testid="cpq-cost-index-values">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showCorrections} onCheckedChange={(checked) => { setShowCorrections(checked === true); setValuesPage(1) }} data-testid="cpq-cost-index-show-corrections" />
            {t('cpq.costIndices.values.showCorrections', 'Show corrections')}
          </label>
          <DataTable<CostIndexValueRow>
            title={t('cpq.costIndices.values.title', 'Values')}
            refreshButton={{ label: t('cpq.list.actions.refresh', 'Refresh'), onRefresh: reload, isRefreshing: valuesLoading }}
            actions={canWrite ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDialog('import')} data-testid="cpq-cost-index-import">{t('cpq.costIndices.import.title', 'Import values')}</Button>
                <Button onClick={() => setDialog('value')} disabled={!item.isActive} data-testid="cpq-cost-index-add-value">{t('cpq.costIndices.addValue.title', 'Add value')}</Button>
              </div>
            ) : undefined}
            columns={columns}
            data={values}
            injectionSpotId="data-table:cpq.cost_index_values"
            pagination={{ page: valuesPage, pageSize: VALUES_PAGE_SIZE, total: valuesTotal, totalPages: valuesPages, onPageChange: setValuesPage }}
            isLoading={valuesLoading}
            emptyState={<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{t('cpq.costIndices.values.empty', 'No values yet. Add the first value to start pricing with this index.')}</div>}
          />
        </section>

        <section className="space-y-2 rounded-lg border bg-card p-4" data-testid="cpq-cost-index-used-by">
          <h3 className="text-sm font-semibold">{t('cpq.costIndices.usedBy.title', 'Used by')}</h3>
          {detail.elements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('cpq.costIndices.usedBy.empty', 'No cost element uses this index yet.')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.elements.map((element) => (
                <li key={element.id} className="flex items-center gap-2">
                  <span>{elementChargeLabel(element)}</span>
                  {!element.isActive && <Tag variant="neutral" className="px-1.5 text-xs">{t('common.inactive', 'Inactive')}</Tag>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/backend/cpq/offerings" className="text-xs text-primary hover:underline">{t('cpq.costIndices.usedBy.openOfferings', 'Open offerings to edit charge cost elements')}</Link>
        </section>

        {dialog === 'value' && (
          <AddValueDialog
            indexId={item.id}
            indexCode={item.code}
            unit={item.unit}
            currencyCode={item.currencyCode}
            onClose={() => setDialog(null)}
            onAdded={(revision) => {
              setDialog(null)
              flash(t('cpq.costIndices.flash.valueAdded', 'Value added (revision {revision})', { revision }), 'success')
              setValuesPage(1)
              reload()
            }}
          />
        )}
        {dialog === 'import' && (
          <ImportValuesDialog
            onClose={() => setDialog(null)}
            onImported={({ created, unchanged }) => {
              setDialog(null)
              flash(t('cpq.costIndices.flash.imported', 'Imported: {created} new, {unchanged} unchanged', { created, unchanged }), 'success')
              setValuesPage(1)
              reload()
            }}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
