"use client"
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

/**
 * Bank CSV upload (Spec C). Posts the file to `/api/billing/payments/import`
 * and shows the batch summary (counts per outcome + first row errors).
 * Cmd/Ctrl+Enter uploads, Escape closes.
 */

export type ImportSummary = {
  importId: string
  fileName: string
  rowCount: number
  counts: Record<string, number>
  errors: Array<{ row: number; message: string }>
}

const COUNT_KEYS = ['allocated', 'partially_allocated', 'matched', 'unmatched', 'duplicate', 'rejected'] as const

export function PaymentUploadDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: (summary: ImportSummary) => void
}) {
  const t = useT()
  const [file, setFile] = React.useState<File | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [summary, setSummary] = React.useState<ImportSummary | null>(null)

  React.useEffect(() => {
    if (open) {
      setFile(null)
      setSummary(null)
    }
  }, [open])

  const countLabel: Record<(typeof COUNT_KEYS)[number], string> = {
    allocated: t('billing.payments.import.counts.allocated', 'Allocated'),
    partially_allocated: t('billing.payments.import.counts.partially_allocated', 'Partially allocated'),
    matched: t('billing.payments.import.counts.matched', 'Matched (credit)'),
    unmatched: t('billing.payments.import.counts.unmatched', 'Unmatched'),
    duplicate: t('billing.payments.import.counts.duplicate', 'Duplicates'),
    rejected: t('billing.payments.import.counts.rejected', 'Rejected rows'),
  }

  const upload = React.useCallback(async () => {
    if (!file || uploading) return
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const call = await apiCall<ImportSummary & { error?: string }>('/api/billing/payments/import', { method: 'POST', body: form })
      if (!call.ok || !call.result?.importId) {
        flash(call.result?.error ?? t('billing.payments.import.failed', 'Import failed'), 'error')
        return
      }
      setSummary(call.result)
      onImported(call.result)
    } finally {
      setUploading(false)
    }
  }, [file, onImported, t, uploading])

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            if (!summary) void upload()
            else onClose()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('billing.payments.import.title', 'Upload bank payments')}</DialogTitle>
          <DialogDescription>
            {t(
              'billing.payments.import.help',
              'CSV with the header date,amount,currency,reference,payer_name,payer_account. Payments are matched by the invoice number in the reference.',
            )}
          </DialogDescription>
        </DialogHeader>
        {summary ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="text-muted-foreground">
              {summary.fileName} · {t('billing.payments.import.rows', 'rows')}: {summary.rowCount}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COUNT_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">{countLabel[key]}</span>
                  <span className="font-medium tabular-nums">{summary.counts[key] ?? 0}</span>
                </div>
              ))}
            </div>
            {summary.errors.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-md border p-2 text-xs">
                {summary.errors.slice(0, 20).map((error) => (
                  <div key={`${error.row}-${error.message}`}>
                    {t('billing.payments.import.line', 'Line')} {error.row}: {error.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <Input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        )}
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> · <Kbd>Esc</Kbd>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {summary ? t('billing.common.close', 'Close') : t('billing.common.cancel', 'Cancel')}
              </Button>
              {!summary ? (
                <Button type="button" onClick={() => void upload()} disabled={!file || uploading}>
                  {uploading ? t('billing.payments.import.uploading', 'Uploading…') : t('billing.payments.import.action', 'Upload')}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
