'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  CSV_ISSUE_FALLBACKS,
  classifyIndexError,
  costIndexErrorFallback,
  formatIndexDate,
  formatIndexValue,
  importErrorLines,
  parseIndexValuesCsv,
  readImportErrors,
  summarizeImport,
  type CostIndexFailure,
  type CsvParseResult,
  type ImportRowResult,
} from '../../../../../lib/costIndexView'
import { IndexErrorAlert, submitOnModEnter } from '../../_components/dialogShared'

type Props = {
  onClose: () => void
  onImported: (summary: { created: number; unchanged: number }) => void
}

type ImportResponse = { batchId?: string | null; dryRun?: boolean; results?: ImportRowResult[] }

/**
 * Import values from pasted or uploaded CSV (`indexCode,effectiveDate,value,note`). Two phases: Preview runs the
 * server's dry run (nothing written); Import is enabled only after a clean preview of the current text and writes the
 * same rows all-or-nothing. Editing the text drops the preview. Ctrl/Cmd+Enter runs the current phase, Escape cancels.
 */
export function ImportValuesDialog({ onClose, onImported }: Props) {
  const t = useT()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [text, setText] = React.useState('')
  const [parsed, setParsed] = React.useState<CsvParseResult | null>(null)
  const [preview, setPreview] = React.useState<ImportRowResult[] | null>(null)
  const [rowErrors, setRowErrors] = React.useState<Array<{ row: number; code: string; indexCode?: string; line: number | null }>>([])
  const [failure, setFailure] = React.useState<CostIndexFailure | null>(null)
  const [busy, setBusy] = React.useState(false)

  const edit = (next: string) => { setText(next); setParsed(null); setPreview(null); setRowErrors([]); setFailure(null) }

  const send = async (current: CsvParseResult, dryRun: boolean) => {
    const call = await apiCall<ImportResponse>('/api/cpq/cost-indices/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: current.items, dryRun }),
    })
    if (call.ok) return call.result?.results ?? []
    const errors = readImportErrors(call.result)
    if (errors.length > 0) setRowErrors(importErrorLines(errors, current.lines))
    else setFailure(classifyIndexError(call.status, call.result))
    return null
  }

  const runPreview = async () => {
    setFailure(null); setRowErrors([]); setPreview(null)
    const current = parseIndexValuesCsv(text)
    setParsed(current)
    if (current.issues.length > 0) return
    setBusy(true)
    const results = await send(current, true)
    setBusy(false)
    if (results) setPreview(results)
  }

  const runImport = async () => {
    if (!parsed || !preview) return
    setBusy(true)
    const results = await send(parsed, false)
    setBusy(false)
    if (results) onImported(summarizeImport(results))
  }

  const primary = () => { if (busy) return; void (preview ? runImport() : runPreview()) }
  const summary = preview ? summarizeImport(preview) : null
  const issueLines = (parsed?.issues ?? []).slice(0, 20).map((issue) => {
    const message = t(`cpq.costIndices.import.issues.${issue.code}`, CSV_ISSUE_FALLBACKS[issue.code])
    return issue.line > 0 ? t('cpq.costIndices.import.lineIssue', 'Line {line}: {message}', { line: issue.line, message }) : message
  })

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={submitOnModEnter(primary)} data-testid="cpq-import-index-values-dialog" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('cpq.costIndices.import.title', 'Import values')}</DialogTitle>
          <DialogDescription>{t('cpq.costIndices.import.description', 'Paste or upload CSV with the columns indexCode, effectiveDate (YYYY-MM-DD), value, note. All rows are imported or none.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Textarea
            autoFocus
            rows={8}
            className="font-mono text-xs"
            value={text}
            placeholder={t('cpq.costIndices.import.placeholder', 'indexCode,effectiveDate,value,note\nDEMO-DC-POWER,2026-11-01,82.40,Monthly settlement')}
            onChange={(event) => edit(event.target.value)}
            data-testid="cpq-import-index-values-text"
          />
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              data-testid="cpq-import-index-values-file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void file.text().then(edit)
                event.target.value = ''
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>{t('cpq.costIndices.import.upload', 'Upload CSV file')}</Button>
          </div>
          {issueLines.length > 0 && (
            <Alert variant="warning" data-testid="cpq-import-index-values-issues">
              <AlertDescription>{issueLines.map((line, i) => <span key={i} className="block">{line}</span>)}</AlertDescription>
            </Alert>
          )}
          {rowErrors.length > 0 && (
            <Alert variant="warning" data-testid="cpq-import-index-values-row-errors">
              <AlertDescription>
                <span className="block font-medium">{t('cpq.costIndices.errors.IMPORT_VALIDATION_FAILED', costIndexErrorFallback('IMPORT_VALIDATION_FAILED'))}</span>
                {rowErrors.slice(0, 20).map((error) => (
                  <span key={`${error.row}:${error.code}`} className="block text-xs">
                    {t('cpq.costIndices.import.lineIssue', 'Line {line}: {message}', {
                      line: error.line ?? error.row,
                      message: `${t(`cpq.costIndices.errors.${error.code}`, costIndexErrorFallback(error.code))}${error.indexCode ? ` (${error.indexCode})` : ''}`,
                    })}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <IndexErrorAlert failure={failure} />
          {preview && summary && (
            <div className="space-y-2 rounded-lg border p-3" data-testid="cpq-import-index-values-preview">
              <div className="flex items-center gap-2 text-sm">
                <Tag variant="success" dot>{t('cpq.costIndices.import.created', '{count} new', { count: summary.created })}</Tag>
                <Tag variant="neutral" dot>{t('cpq.costIndices.import.unchanged', '{count} unchanged', { count: summary.unchanged })}</Tag>
              </div>
              <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
                {preview.slice(0, 50).map((row) => {
                  const item = parsed?.items[row.row - 1]
                  return (
                    <li key={row.row}>
                      {row.indexCode} · {formatIndexDate(row.effectiveDate)}{item ? ` · ${formatIndexValue(item.value)}` : ''} · r{row.revision} ·{' '}
                      {row.status === 'created' ? t('cpq.costIndices.import.willCreate', 'will be created') : t('cpq.costIndices.import.willSkip', 'unchanged, skipped')}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.costIndices.cancel', 'Cancel')}</Button>
          {preview ? (
            <Button onClick={() => void runImport()} disabled={busy} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-import-index-values-confirm">
              {busy ? t('cpq.costIndices.saving', 'Saving…') : t('cpq.costIndices.import.confirm', 'Import')}
            </Button>
          ) : (
            <Button onClick={() => void runPreview()} disabled={busy || !text.trim()} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-import-index-values-preview-button">
              {busy ? t('cpq.costIndices.import.checking', 'Checking…') : t('cpq.costIndices.import.preview', 'Preview')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
