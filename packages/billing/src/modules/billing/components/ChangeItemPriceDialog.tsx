"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { MoneyInput } from './MoneyInput'

/**
 * "Change price" for a recurring item: effective date + new price →
 * `POST /api/billing/items/change-price`. The current item ends the day
 * before; a copy with the new price starts on the date. On success the caller
 * opens the new item.
 */

export type ChangeItemPriceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  currentPrice: number | null
  currencyCode?: string | null
  priceBasis: 'net' | 'gross'
  /** The earliest allowed effective date is the day after this (YYYY-MM-DD). */
  billStartDate: string
  billEndDate?: string | null
  onChanged: (newItemId: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function ChangeItemPriceDialog({
  open,
  onOpenChange,
  itemId,
  currentPrice,
  currencyCode,
  priceBasis,
  billStartDate,
  billEndDate,
  onChanged,
}: ChangeItemPriceDialogProps) {
  const t = useT()
  const minDate = nextDay(billStartDate)
  const maxDate = billEndDate ? billEndDate.slice(0, 10) : undefined
  const [effectiveDate, setEffectiveDate] = React.useState('')
  const [price, setPrice] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const today = todayIso()
    setEffectiveDate(today < minDate ? minDate : today)
    setPrice(currentPrice != null ? String(currentPrice) : '')
  }, [currentPrice, minDate, open])

  const parsedPrice = Number.parseFloat(price)
  const priceValid = price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0
  const dateValid = effectiveDate >= minDate && (!maxDate || effectiveDate <= maxDate)

  const handleSubmit = React.useCallback(async () => {
    if (!priceValid || !dateValid || saving) return
    setSaving(true)
    try {
      const call = await apiCallOrThrow<{ previousItemId: string; newItemId: string }>('/api/billing/items/change-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, effectiveDate, unitPrice: parsedPrice }),
      })
      const newItemId = call.result?.newItemId
      flash(t('billing.items.change_price.success', 'Price changed — the new item is active from the effective date'), 'success')
      onOpenChange(false)
      if (newItemId) onChanged(newItemId)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      const code = (err as { body?: { code?: string } } | null)?.body?.code
      flash(code ? t(code, message || code) : message || t('billing.items.change_price.error', 'Could not change the price'), 'error')
    } finally {
      setSaving(false)
    }
  }, [dateValid, effectiveDate, itemId, onChanged, onOpenChange, parsedPrice, priceValid, saving, t])

  const basisLabel =
    priceBasis === 'gross' ? t('billing.items.price_basis.gross', 'Gross') : t('billing.items.price_basis.net', 'Net')

  return (
    <Dialog open={open} onOpenChange={(next) => (!saving ? onOpenChange(next) : undefined)}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('billing.items.change_price.title', 'Change price')}</DialogTitle>
          <DialogDescription>
            {t(
              'billing.items.change_price.description',
              'This item ends the day before the effective date and a copy with the new price starts on it. Days already billed after the change are credited and charged again at the new price, per the item proration setting.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('billing.items.change_price.effective_date', 'Effective from')}</span>
            <Input
              type="date"
              value={effectiveDate}
              min={minDate}
              max={maxDate}
              onChange={(event) => setEffectiveDate(event.currentTarget.value)}
            />
            {effectiveDate && dateValid ? (
              <span className="text-xs text-muted-foreground">
                {t('billing.items.change_price.current_ends', 'Current price ends on')} {previousDay(effectiveDate)}
              </span>
            ) : (
              <span className="text-xs text-destructive">
                {t('billing.items.change_price.date_range', 'Pick a date after the item start')}
                {maxDate ? ` ${t('billing.items.change_price.and_before', 'and on or before')} ${maxDate}` : ''}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.items.change_price.new_price', 'New unit price per cycle')} ({basisLabel})
            </span>
            <MoneyInput currencyCode={currencyCode} step="0.01" min="0" value={price} onChange={(event) => setPrice(event.currentTarget.value)} />
            {currentPrice != null ? (
              <span className="text-xs text-muted-foreground">
                {t('billing.items.change_price.current_price', 'Current price')}: {currentPrice}
                {currencyCode ? ` ${currencyCode}` : ''}
              </span>
            ) : null}
          </label>
        </div>
        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> {t('billing.items.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
            {t('billing.items.form.cancel_hint', 'to discard')}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!priceValid || !dateValid || saving}>
              {saving ? t('billing.items.form.saving', 'Saving…') : t('billing.items.change_price.action', 'Change price')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
