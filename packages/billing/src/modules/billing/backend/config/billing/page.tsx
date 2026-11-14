"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { DOCUMENT_SERIES, type DocumentSeries } from '../../../lib/numbering'

/**
 * Billing settings (Spec 0) — per organization:
 *   - document number masks per series, with a live example of the next
 *     number and the counter scope (never / yearly / monthly reset);
 *   - prepaid defaults (moved from core `configs`);
 *   - read-only: whether online top-ups are available (optional gateway).
 * Spec B adds seller / document fields to this page.
 */

type Settings = {
  lowBalanceThresholdDefault: number
  nearLimitBufferDefault: number
  statementEnabled: boolean
  topupTaxRate: number
  topupProvider: string
  numberMasks: Record<DocumentSeries, string>
}

type SettingsResponse = { settings: Settings; capabilities: { gatewayTopups: boolean } }

type Preview = { valid: boolean; errors: string[]; example?: string; scopeKey?: string }

function useMaskPreview(mask: string): Preview | null {
  const [preview, setPreview] = React.useState<Preview | null>(null)
  React.useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      void apiCall<Preview>(`/api/billing/settings/number-preview?mask=${encodeURIComponent(mask)}`).then((call) => {
        if (!cancelled) setPreview(call.ok ? call.result ?? null : null)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [mask])
  return preview
}

function MaskField({
  series,
  value,
  initial,
  onChange,
}: {
  series: DocumentSeries
  value: string
  initial: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const preview = useMaskPreview(value)
  const seriesLabel: Record<DocumentSeries, string> = {
    invoice: t('billing.settings.series.invoice', 'Invoices and debit memos'),
    credit_memo: t('billing.settings.series.credit_memo', 'Credit memos'),
    receipt: t('billing.settings.series.receipt', 'Top-up receipts'),
  }
  const scopeLabel = (scopeKey: string | undefined) =>
    !scopeKey
      ? t('billing.settings.mask.scope.none', 'Counter never resets')
      : scopeKey.length === 4
        ? t('billing.settings.mask.scope.year', 'Counter resets every year')
        : t('billing.settings.mask.scope.month', 'Counter resets every month')
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{seriesLabel[series]}</span>
      <Input value={value} maxLength={64} onChange={(event) => onChange(event.currentTarget.value)} />
      {preview?.valid ? (
        <span className="text-xs text-muted-foreground">
          {t('billing.settings.mask.example', 'Next number looks like')} <span className="font-mono">{preview.example}</span>
          {' · '}
          {scopeLabel(preview.scopeKey)}
        </span>
      ) : preview ? (
        <span className="text-xs text-destructive">
          {preview.errors.map((code) => t(`billing.settings.mask.error.${code}`, code)).join(' ')}
        </span>
      ) : null}
      {value !== initial ? (
        <span className="text-xs text-muted-foreground">
          {t(
            'billing.settings.mask.change_warning',
            'Changing the mask mid-period starts a new counter; a number that was already issued is rejected at post.',
          )}
        </span>
      ) : null}
    </label>
  )
}

export default function BillingSettingsPage() {
  const t = useT()
  const [loaded, setLoaded] = React.useState<SettingsResponse | null>(null)
  const [values, setValues] = React.useState<Settings | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const result = await readApiResultOrThrow<SettingsResponse>('/api/billing/settings')
      setLoaded(result)
      setValues(result.settings)
    } catch (err) {
      setError(normalizeCrudServerError(err).message || t('billing.settings.error.load', 'Could not load billing settings'))
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev))

  const handleSave = React.useCallback(async () => {
    if (!values) return
    setSaving(true)
    try {
      await apiCallOrThrow('/api/billing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      flash(t('billing.settings.saved', 'Billing settings saved'), 'success')
      await load()
    } catch (err) {
      flash(normalizeCrudServerError(err).message || t('billing.settings.error.save', 'Saving failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [load, t, values])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSave()
    } else if (event.key === 'Escape' && loaded) {
      event.preventDefault()
      setValues(loaded.settings)
    }
  }

  return (
    <Page>
      <PageHeader title={t('billing.settings.title', 'Billing')} />
      <PageBody>
        {error ? (
          <ErrorMessage label={error} />
        ) : !values || !loaded ? (
          <LoadingMessage label={t('billing.settings.loading', 'Loading billing settings…')} />
        ) : (
          <div className="flex flex-col gap-6" onKeyDown={handleKeyDown}>
            <section className="rounded-lg border bg-card p-6 flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">{t('billing.settings.numbering.title', 'Document numbering')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'billing.settings.numbering.help',
                    'Use date tokens and exactly one counter token. The counter token decides when numbering restarts. Add :N to zero-pad the counter.',
                  )}
                </p>
                {/* Tokens are rendered literally — never through i18n interpolation. */}
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                  {[
                    ['{YYYY} {YY} {MM} {DD}', t('billing.settings.token.date', 'Issue date parts')],
                    ['{SEQUENCE_NUM}', t('billing.settings.mask.scope.none', 'Counter never resets')],
                    ['{SEQUENCE_NUM_YEAR}', t('billing.settings.mask.scope.year', 'Counter resets every year')],
                    ['{SEQUENCE_NUM_MONTH:4}', t('billing.settings.mask.scope.month', 'Counter resets every month')],
                  ].map(([token, label]) => (
                    <li key={token}>
                      <span className="font-mono">{token}</span> — {label}
                    </li>
                  ))}
                </ul>
              </div>
              {DOCUMENT_SERIES.map((series) => (
                <MaskField
                  key={series}
                  series={series}
                  value={values.numberMasks[series]}
                  initial={loaded.settings.numberMasks[series]}
                  onChange={(next) => set('numberMasks', { ...values.numberMasks, [series]: next })}
                />
              ))}
            </section>

            <section className="rounded-lg border bg-card p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <h2 className="text-base font-semibold sm:col-span-2">{t('billing.settings.prepaid.title', 'Prepaid defaults')}</h2>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.prepaid.low_balance', 'Low-balance threshold')}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(values.lowBalanceThresholdDefault)}
                  onChange={(e) => set('lowBalanceThresholdDefault', Number(e.currentTarget.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.prepaid.near_limit', 'Near credit-limit buffer')}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(values.nearLimitBufferDefault)}
                  onChange={(e) => set('nearLimitBufferDefault', Number(e.currentTarget.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.prepaid.topup_tax_rate', 'VAT on top-up receipts (%)')}</span>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={String(values.topupTaxRate)}
                  onChange={(e) => set('topupTaxRate', Number(e.currentTarget.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.prepaid.topup_provider', 'Top-up payment provider')}</span>
                <Input value={values.topupProvider} onChange={(e) => set('topupProvider', e.currentTarget.value)} />
              </label>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <span className="text-sm">{t('billing.settings.prepaid.statements', 'Generate consumption statements at period close')}</span>
                <Switch checked={values.statementEnabled} onCheckedChange={(next) => set('statementEnabled', next)} />
              </div>
              <div className="flex items-center gap-2 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.prepaid.gateway', 'Online top-ups')}</span>
                {loaded.capabilities.gatewayTopups ? (
                  <Tag variant="success">{t('billing.settings.prepaid.gateway.available', 'Available')}</Tag>
                ) : (
                  <Tag variant="neutral">
                    {t('billing.settings.prepaid.gateway.unavailable', 'Unavailable — payment gateways module not installed')}
                  </Tag>
                )}
              </div>
            </section>

            <div className="flex items-center justify-end gap-3">
              <span className="text-xs text-muted-foreground">
                <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> {t('billing.settings.save_hint', 'to save')}
              </span>
              <Button type="button" variant="outline" onClick={() => setValues(loaded.settings)} disabled={saving}>
                {t('billing.common.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                {saving ? t('billing.settings.saving', 'Saving…') : t('billing.common.save', 'Save')}
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
