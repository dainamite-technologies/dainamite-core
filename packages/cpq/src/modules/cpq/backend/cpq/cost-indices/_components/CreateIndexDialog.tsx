'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  INDEX_FORM_ISSUE_FALLBACKS,
  buildCreateIndexBody,
  classifyIndexError,
  createIndexFormIssues,
  emptyCreateIndexForm,
  type CostIndexFailure,
  type CostIndexItem,
  type CreateIndexForm,
} from '../../../../lib/costIndexView'
import { IndexErrorAlert, IndexField, submitOnModEnter } from './dialogShared'

type Props = {
  onClose: () => void
  /** Called with the created index. */
  onCreated: (item: CostIndexItem) => void
}

/** Create a cost index (write access only; the page does not render the trigger otherwise). Ctrl/Cmd+Enter creates, Escape cancels. */
export function CreateIndexDialog({ onClose, onCreated }: Props) {
  const t = useT()
  const [form, setForm] = React.useState<CreateIndexForm>(() => emptyCreateIndexForm())
  const [showIssues, setShowIssues] = React.useState(false)
  const [failure, setFailure] = React.useState<CostIndexFailure | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = createIndexFormIssues(form)
  const set = <K extends keyof CreateIndexForm>(key: K, value: CreateIndexForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setFailure(null)
    const call = await apiCall<{ item?: CostIndexItem }>('/api/cpq/cost-indices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCreateIndexBody(form)),
    })
    setSaving(false)
    if (call.ok && call.result?.item) { onCreated(call.result.item); return }
    setFailure(classifyIndexError(call.status, call.result))
  }

  const shown = showIssues ? issues.map((issue) => t(`cpq.costIndices.create.issues.${issue}`, INDEX_FORM_ISSUE_FALLBACKS[issue])) : []
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={submitOnModEnter(() => void submit())} data-testid="cpq-create-index-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.costIndices.create.title', 'Create cost index')}</DialogTitle>
          <DialogDescription>{t('cpq.costIndices.create.description', 'A market price that cost elements can follow, for example data-centre power in EUR/MWh.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <IndexField label={`${t('cpq.costIndices.fields.code', 'Code')} *`} hint={t('cpq.costIndices.fields.codeHint', 'Cannot be changed later')}>
              <Input autoFocus value={form.code} maxLength={40} onChange={(event) => set('code', event.target.value.toUpperCase())} />
            </IndexField>
            <IndexField label={`${t('cpq.costIndices.fields.currency', 'Currency')} *`}>
              <Input value={form.currencyCode} maxLength={3} onChange={(event) => set('currencyCode', event.target.value.toUpperCase())} />
            </IndexField>
          </div>
          <IndexField label={`${t('cpq.costIndices.fields.name', 'Name')} *`}>
            <Input value={form.name} maxLength={200} onChange={(event) => set('name', event.target.value)} />
          </IndexField>
          <IndexField label={`${t('cpq.costIndices.fields.unit', 'Unit')} *`}>
            <Input value={form.unit} maxLength={40} placeholder="EUR/MWh" onChange={(event) => set('unit', event.target.value)} />
          </IndexField>
          <IndexField label={t('cpq.costIndices.fields.description', 'Description')}>
            <Textarea rows={2} maxLength={1000} value={form.description} onChange={(event) => set('description', event.target.value)} />
          </IndexField>
          <IndexErrorAlert failure={failure} issues={shown} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.costIndices.cancel', 'Cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-create-index-submit">
            {saving ? t('cpq.costIndices.saving', 'Saving…') : t('cpq.costIndices.create.submit', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
