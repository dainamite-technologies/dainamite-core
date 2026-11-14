"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
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
 *   - read-only: whether online top-ups are available (optional gateway);
 *   - Spec B: seller block, payment instructions (bank / IBAN / BIC),
 *     default payment terms and VAT rate, invoice footer and logo. Posting
 *     is blocked until legal name, address, tax id and IBAN are filled — the
 *     page shows what is missing.
 */

type Settings = {
  id: string
  lowBalanceThresholdDefault: number
  nearLimitBufferDefault: number
  statementEnabled: boolean
  topupTaxRate: number
  topupProvider: string
  numberMasks: Record<DocumentSeries, string>
  legalName: string
  sellerAddress: SellerAddress | null
  taxId: string
  bankName: string
  iban: string
  bic: string
  invoiceFooter: string
  logoAttachmentId: string | null
  defaultPaymentTermsDays: number
  defaultTaxRate: number
}

type SellerAddress = { line1: string; line2?: string; city: string; postal_code: string; country: string }

const EMPTY_ADDRESS: SellerAddress = { line1: '', line2: '', city: '', postal_code: '', country: 'PL' }

type SettingsResponse = {
  settings: Settings
  capabilities: { gatewayTopups: boolean }
  completeness?: { ready: boolean; missing: string[] }
}

/** Address is sent only when the required parts are filled; all blank clears it. */
function addressPayload(address: SellerAddress | null): SellerAddress | null | undefined {
  if (!address) return null
  const trimmed = {
    line1: address.line1.trim(),
    line2: (address.line2 ?? '').trim(),
    city: address.city.trim(),
    postal_code: address.postal_code.trim(),
    country: address.country.trim().toUpperCase(),
  }
  if (!trimmed.line1 && !trimmed.city && !trimmed.postal_code) return null
  const { line2, ...rest } = trimmed
  return line2 ? { ...rest, line2 } : rest
}

const ATTACHMENT_ENTITY_ID = 'billing:billing_settings'

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
        body: JSON.stringify({ ...values, sellerAddress: addressPayload(values.sellerAddress) }),
      })
      flash(t('billing.settings.saved', 'Billing settings saved'), 'success')
      await load()
    } catch (err) {
      flash(normalizeCrudServerError(err).message || t('billing.settings.error.save', 'Saving failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [load, t, values])

  const [uploading, setUploading] = React.useState(false)
  const handleLogoUpload = React.useCallback(
    async (file: File | null) => {
      if (!file || !values) return
      setUploading(true)
      try {
        const form = new FormData()
        form.set('entityId', ATTACHMENT_ENTITY_ID)
        form.set('recordId', loaded?.settings.id ?? 'settings')
        form.set('file', file)
        const call = await apiCall<{ item?: { id: string }; error?: string }>('/api/attachments', {
          method: 'POST',
          body: form,
        })
        if (!call.ok || !call.result?.item?.id) {
          throw new Error(call.result?.error || t('billing.settings.logo.upload_failed', 'Logo upload failed'))
        }
        set('logoAttachmentId', call.result.item.id)
      } catch (err) {
        flash(err instanceof Error ? err.message : t('billing.settings.logo.upload_failed', 'Logo upload failed'), 'error')
      } finally {
        setUploading(false)
      }
    },
    [loaded?.settings.id, t, values],
  )

  const address = values?.sellerAddress ?? EMPTY_ADDRESS
  const setAddress = (key: keyof SellerAddress, value: string) =>
    set('sellerAddress', { ...(values?.sellerAddress ?? EMPTY_ADDRESS), [key]: value })

  const missingLabels: Record<string, string> = {
    legalName: t('billing.settings.seller.legal_name', 'Legal name'),
    sellerAddress: t('billing.settings.seller.address', 'Address'),
    taxId: t('billing.settings.seller.tax_id', 'Tax ID'),
    iban: t('billing.settings.payment.iban', 'IBAN'),
  }

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
            {loaded.completeness && !loaded.completeness.ready ? (
              <div className="rounded-lg border border-status-warning-border bg-status-warning-bg p-4 text-sm">
                <div className="font-medium">
                  {t('billing.settings.incomplete.title', 'Invoices cannot be posted yet')}
                </div>
                <div className="text-muted-foreground">
                  {t('billing.settings.incomplete.help', 'Fill in the seller details printed on every invoice:')}{' '}
                  {loaded.completeness.missing.map((field) => missingLabels[field] ?? field).join(', ')}
                </div>
              </div>
            ) : null}

            <section className="rounded-lg border bg-card p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <h2 className="text-base font-semibold sm:col-span-2">{t('billing.settings.seller.title', 'Seller')}</h2>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.seller.legal_name', 'Legal name')} *</span>
                <Input value={values.legalName} maxLength={255} onChange={(e) => set('legalName', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.seller.line1', 'Address line 1')} *</span>
                <Input value={address.line1} onChange={(e) => setAddress('line1', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.seller.line2', 'Address line 2')}</span>
                <Input value={address.line2 ?? ''} onChange={(e) => setAddress('line2', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.seller.postal_code', 'Postal code')} *</span>
                <Input value={address.postal_code} onChange={(e) => setAddress('postal_code', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.seller.city', 'City')} *</span>
                <Input value={address.city} onChange={(e) => setAddress('city', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.seller.country', 'Country (ISO code)')} *</span>
                <Input value={address.country} maxLength={3} onChange={(e) => setAddress('country', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.seller.tax_id', 'Tax ID')} *</span>
                <Input value={values.taxId} maxLength={64} onChange={(e) => set('taxId', e.currentTarget.value)} />
              </label>
            </section>

            <section className="rounded-lg border bg-card p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <h2 className="text-base font-semibold sm:col-span-2">{t('billing.settings.payment.title', 'Payment and invoicing')}</h2>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.payment.bank_name', 'Bank name')}</span>
                <Input value={values.bankName} maxLength={255} onChange={(e) => set('bankName', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.payment.iban', 'IBAN')} *</span>
                <Input value={values.iban} className="font-mono" onChange={(e) => set('iban', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.payment.bic', 'BIC / SWIFT')}</span>
                <Input value={values.bic} className="font-mono" maxLength={11} onChange={(e) => set('bic', e.currentTarget.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.payment.terms', 'Default payment terms (days)')}</span>
                <Input
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  value={String(values.defaultPaymentTermsDays)}
                  onChange={(e) => set('defaultPaymentTermsDays', Number.parseInt(e.currentTarget.value, 10) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.settings.payment.tax_rate', 'Default VAT rate (%)')}</span>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={String(values.defaultTaxRate)}
                  onChange={(e) => set('defaultTaxRate', Number(e.currentTarget.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">
                  {t('billing.settings.payment.tax_rate.help', 'Applied to new billing items only; existing items keep their rate.')}
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.document.footer', 'Invoice footer')}</span>
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={values.invoiceFooter}
                  onChange={(e) => set('invoiceFooter', e.currentTarget.value)}
                />
                <span className="text-xs text-muted-foreground">
                  {t('billing.settings.document.footer.help', 'Registration court, share capital and similar legal notes.')}
                </span>
              </label>
              <div className="flex flex-col gap-2 text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t('billing.settings.document.logo', 'Logo (PNG or JPEG)')}</span>
                {values.logoAttachmentId ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={`/api/attachments/file/${encodeURIComponent(values.logoAttachmentId)}`}
                      alt={t('billing.settings.document.logo', 'Logo (PNG or JPEG)')}
                      className="h-12 max-w-[200px] object-contain rounded border bg-background"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => set('logoAttachmentId', null)}>
                      {t('billing.settings.document.logo.remove', 'Remove')}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t('billing.settings.document.logo.fallback', 'No logo — the organization logo is used when set.')}
                  </span>
                )}
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={uploading}
                  onChange={(e) => void handleLogoUpload(e.currentTarget.files?.[0] ?? null)}
                />
              </div>
            </section>

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
