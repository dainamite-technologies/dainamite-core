"use client"
import * as React from 'react'
import { Pause, Play, ShieldAlert, Clock, Trash2, Info } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { formatBillingDay } from '../lib/displayDate'
import { localTodayIso } from '../lib/dateOnly'
import type { ItemStatus } from '../lib/itemStatusPeriods'
import {
  currentStatusPill,
  minResumeDate,
  shiftIsoDay,
  type PhaseRow,
  type StatusPeriodRow,
} from '../lib/itemStatusLabel'
import { ItemStatusDialog, statusErrorMessage } from './ItemStatusDialog'
import { phaseDisplayName, phasePriceLabel, statusName, statusVariant, ItemStatusTag } from './ItemLineLabels'

/**
 * Billing item detail sections for the line schedule (line-period-and-status
 * spec §4.3, price-phases spec §4.1): the read-only phase schedule and the
 * status periods with Pause / Suspend / Grace period / Resume. CPQ lines
 * (`subscriptionId` set) show their status read-only (D6).
 */

function SectionCard({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function ItemPhaseScheduleCard({
  phases,
  phasesEnabled,
  regularPrice,
  currencyCode,
}: {
  phases: readonly PhaseRow[]
  phasesEnabled: boolean
  regularPrice: number | null
  currencyCode?: string | null
}) {
  const t = useT()
  const locale = useLocale()
  const today = React.useMemo(() => localTodayIso(), [])
  const ordered = React.useMemo(() => phases.slice().sort((a, b) => a.sequence - b.sequence), [phases])
  const last = ordered.length > 0 ? ordered[ordered.length - 1] : null
  return (
    <SectionCard
      title={t('billing.items.phases.title', 'Price phases')}
      actions={!phasesEnabled ? <Tag variant="neutral">{t('billing.items.phases.off', 'Off')}</Tag> : null}
    >
      {!phasesEnabled ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t('billing.items.phases.off_help', 'Phases are switched off — the regular price applies. Edit the item to switch them on.')}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('billing.items.phases.col.phase', 'Phase')}</TableHead>
            <TableHead>{t('billing.items.phases.col.dates', 'Dates')}</TableHead>
            <TableHead>{t('billing.items.phases.col.price', 'Price per period')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((phase, index) => {
            const current = phase.startDate && phase.endDate && phase.startDate <= today && today <= phase.endDate
            return (
              <TableRow key={phase.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    {phaseDisplayName(t, phase.name, index, phase.priceType)}
                    {current && phasesEnabled ? <Tag variant="brand">{t('billing.items.phases.current', 'Current')}</Tag> : null}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatBillingDay(phase.startDate, locale)} – {formatBillingDay(phase.endDate, locale)}
                </TableCell>
                <TableCell className="tabular-nums">{phasePriceLabel(t, phase.priceType, phase.value, currencyCode)}</TableCell>
              </TableRow>
            )
          })}
          {last?.endDate ? (
            <TableRow>
              <TableCell className="text-muted-foreground">{t('billing.items.phases.regular', 'Regular price')}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {t('billing.items.phases.from_date', 'from {date}', { date: formatBillingDay(shiftIsoDay(last.endDate, 1), locale) })}
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {regularPrice != null ? `${regularPrice}${currencyCode ? ` ${currencyCode}` : ''}` : '—'}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </SectionCard>
  )
}

function ResumeDialog({
  open,
  onOpenChange,
  period,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  period: StatusPeriodRow | null
  onSaved: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const [resumeOn, setResumeOn] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const { runMutation } = useGuardedMutation<{ periodId: string }>({ contextId: 'billing-item-status-resume' })
  const min = period ? minResumeDate(period) : ''
  // Resuming shortens the status: the resume day is at most its last day.
  const max = period?.toDate ?? undefined

  React.useEffect(() => {
    if (!open || !period) return
    const today = localTodayIso()
    setResumeOn(today < min ? min : max && today > max ? max : today)
  }, [max, min, open, period])

  const valid = Boolean(period) && /^\d{4}-\d{2}-\d{2}$/.test(resumeOn) && resumeOn >= min && (!max || resumeOn <= max)

  const handleSubmit = React.useCallback(async () => {
    if (!period || !valid || saving) return
    setSaving(true)
    const body = { id: period.id, toDate: shiftIsoDay(resumeOn, -1) }
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow('/api/billing/items/status-periods', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        context: { periodId: period.id },
        mutationPayload: body,
      })
      flash(t('billing.items.status.resumed', 'Line resumes on {date}', { date: formatBillingDay(resumeOn, locale) }), 'success')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      flash(statusErrorMessage(t, err), 'error')
    } finally {
      setSaving(false)
    }
  }, [locale, onOpenChange, onSaved, period, resumeOn, runMutation, saving, t, valid])

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
          <DialogTitle>{t('billing.items.status.resume_title', 'Resume line')}</DialogTitle>
          <DialogDescription>
            {period
              ? t('billing.items.status.resume_description', 'Ends the status “{status}”. The day before the resume date is its last day.', {
                  status: statusName(t, period.status),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('billing.items.status.field.resume_on', 'Resumes on')}</span>
          <Input type="date" value={resumeOn} min={min} max={max} onChange={(event) => setResumeOn(event.currentTarget.value)} />
          {!valid && resumeOn ? (
            <span className="text-xs text-destructive">
              {t('billing.items.status.resume_range', 'Pick a day after {from}, on or before the status ends', {
                from: formatBillingDay(period?.fromDate, locale),
              })}
            </span>
          ) : null}
        </label>
        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> {t('billing.items.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
            {t('billing.items.form.cancel_hint', 'to discard')}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!valid || saving}>
              {saving ? t('billing.items.form.saving', 'Saving…') : t('billing.items.status.resume', 'Resume')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ItemStatusPeriodsCard({
  itemId,
  periods,
  readOnly,
  canSetStatus,
  onChanged,
}: {
  itemId: string
  periods: readonly StatusPeriodRow[]
  /** CPQ line (D6): status comes from the CPQ subscription. */
  readOnly: boolean
  /** Recurring, active lines only — usage / one-time lines are never affected. */
  canSetStatus: boolean
  onChanged: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const today = React.useMemo(() => localTodayIso(), [])
  const [dialogStatus, setDialogStatus] = React.useState<ItemStatus | null>(null)
  const [resumeOpen, setResumeOpen] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ periodId: string }>({ contextId: 'billing-item-status-delete' })
  const pill = currentStatusPill(periods, today)
  const current = pill ? periods.find((p) => p.id === pill.periodId) ?? null : null
  // A period that starts today cannot be shortened to end before it — remove it instead.
  const resumable = current && minResumeDate(current) <= (current.toDate ?? '9999-12-31') ? current : null
  const editable = !readOnly && canSetStatus

  const handleDelete = React.useCallback(
    async (period: StatusPeriodRow) => {
      const ok = await confirm({
        title: t('billing.items.status.delete_title', 'Remove this status?'),
        text: t(
          'billing.items.status.delete_text',
          'The line is treated as active for these days. Days it left uncharged are charged on the next Bill Run.',
        ),
        confirmText: t('billing.items.status.delete', 'Remove'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow('/api/billing/items/status-periods', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: period.id }),
            }),
          context: { periodId: period.id },
          mutationPayload: { id: period.id },
        })
        flash(t('billing.items.status.deleted', 'Status removed'), 'success')
        onChanged()
      } catch (err) {
        flash(statusErrorMessage(t, err), 'error')
      }
    },
    [confirm, onChanged, runMutation, t],
  )

  const sorted = React.useMemo(() => periods.slice().sort((a, b) => b.fromDate.localeCompare(a.fromDate)), [periods])

  return (
    <SectionCard
      title={t('billing.items.status.title', 'Service status')}
      actions={
        editable ? (
          <>
            {resumable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setResumeOpen(true)}>
                <Play size={14} />
                {t('billing.items.status.resume', 'Resume')}
              </Button>
            ) : null}
            {!current ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setDialogStatus('paused')}>
                  <Pause size={14} />
                  {t('billing.items.status.pause', 'Pause')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDialogStatus('suspended')}>
                  <ShieldAlert size={14} />
                  {t('billing.items.status.suspend', 'Suspend')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDialogStatus('grace')}>
                  <Clock size={14} />
                  {t('billing.items.status.grace_action', 'Grace period')}
                </Button>
              </>
            ) : null}
          </>
        ) : null
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('billing.items.status.today', 'Today')}:</span>
        {pill ? <ItemStatusTag periods={periods} today={today} /> : <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>}
      </div>
      {readOnly ? (
        <p className="mb-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Info size={14} />
          {t('billing.items.status.read_only', 'Status comes from the CPQ subscription')}
        </p>
      ) : !canSetStatus ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t('billing.items.status.recurring_only', 'Only active recurring lines can be paused or suspended.')}
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('billing.items.status.empty', 'No status periods — the line is active.')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('billing.items.status.field.status', 'Status')}</TableHead>
              <TableHead>{t('billing.items.status.col.period', 'Period')}</TableHead>
              <TableHead>{t('billing.items.status.field.charge', 'Charging')}</TableHead>
              <TableHead>{t('billing.items.status.col.reason', 'Reason')}</TableHead>
              {editable ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((period) => (
              <TableRow key={period.id}>
                <TableCell>
                  <Tag variant={statusVariant(period.status)}>{statusName(t, period.status)}</Tag>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatBillingDay(period.fromDate, locale)} –{' '}
                  {period.toDate ? formatBillingDay(period.toDate, locale) : t('billing.items.status.open_ended', 'open-ended')}
                </TableCell>
                <TableCell>
                  {period.status === 'grace'
                    ? t('billing.items.status.charge.flag_only', 'Billed normally')
                    : period.chargeBehavior === 'no_charge'
                      ? t('billing.items.status.charge.no_charge', 'No charge')
                      : t('billing.items.status.charge.charge', 'Keep charging')}
                </TableCell>
                <TableCell className="text-muted-foreground">{period.reason || '—'}</TableCell>
                {editable ? (
                  <TableCell className="text-right">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('billing.items.status.delete', 'Remove')}
                      onClick={() => void handleDelete(period)}
                    >
                      <Trash2 />
                    </IconButton>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editable && dialogStatus ? (
        <ItemStatusDialog
          open={dialogStatus !== null}
          onOpenChange={(open) => (!open ? setDialogStatus(null) : undefined)}
          target={{ kind: 'item', itemId }}
          status={dialogStatus}
          onSaved={onChanged}
        />
      ) : null}
      {editable ? <ResumeDialog open={resumeOpen} onOpenChange={setResumeOpen} period={resumable} onSaved={onChanged} /> : null}
      {ConfirmDialogElement}
    </SectionCard>
  )
}
