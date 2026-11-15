"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { DetailCard, DetailField } from '../../../../components/DetailFields'
import { AccountPicker } from '../../../../components/AccountPicker'
import { AllocatePaymentDialog } from '../../../../components/AllocatePaymentDialog'
import { formatMoney } from '../../../../components/InvoicesTable'
import { PAYMENT_STATUS_VARIANT, usePaymentLabels } from '../../../../components/PaymentsTable'
import { accountHref, invoiceDetailHref } from '../../../../lib/navigation'

/**
 * Payment detail (Spec C): fields, match reason, allocations (with
 * un-allocate) and the actions valid for the payment's status — assign to
 * an account, allocate, unassign, ignore / restore, convert to a top-up.
 */

type PaymentRecord = {
  id: string
  received_at: string
  amount: string
  currency_code: string
  reference: string | null
  payer_name: string | null
  payer_account: string | null
  source: string
  import_id: string | null
  bill_account_id: string | null
  bill_account_name: string | null
  bill_account_mode: string | null
  status: string
  unallocated_amount: string
  match_reason: string | null
  topup_id: string | null
}

type AllocationRow = {
  id: string
  invoice_id: string
  invoice_number: string | null
  document_type: string | null
  invoice_status: string | null
  amount: string
  currency_code: string
  allocated_by: string
  created_at: string
}

type DetailResponse = { payment: PaymentRecord; allocations: AllocationRow[] }

function AccountActionDialog({
  open,
  title,
  confirmLabel,
  billingMode,
  currencyCode,
  initialAccountId,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  confirmLabel: string
  billingMode: 'postpaid' | 'prepaid'
  currencyCode: string
  initialAccountId?: string | null
  onClose: () => void
  onConfirm: (billAccountId: string) => Promise<void>
}) {
  const t = useT()
  const [accountId, setAccountId] = React.useState(initialAccountId ?? '')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) setAccountId(initialAccountId ?? '')
  }, [initialAccountId, open])
  const submit = async () => {
    if (!accountId || busy) return
    setBusy(true)
    try {
      await onConfirm(accountId)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <AccountPicker value={accountId} onChange={setAccountId} currencyCode={currencyCode} billingMode={billingMode} />
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> · <Kbd>Esc</Kbd>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('billing.common.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={!accountId || busy}>
                {confirmLabel}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function PaymentDetailPage() {
  const t = useT()
  const labels = usePaymentLabels()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [data, setData] = React.useState<DetailResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [dialog, setDialog] = React.useState<'assign' | 'convert' | 'allocate' | null>(null)

  const load = React.useCallback(async () => {
    if (!id) return
    try {
      setData(await readApiResultOrThrow<DetailResponse>(`/api/billing/payments/${encodeURIComponent(id)}`))
      setError(null)
    } catch (err) {
      if ((err as { status?: number })?.status === 404) setNotFound(true)
      else setError(normalizeCrudServerError(err).message || t('billing.payments.detail.load_error', 'Could not load the payment'))
    }
  }, [id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const action = React.useCallback(
    async (path: string, body: Record<string, unknown>, success: string) => {
      try {
        await apiCallOrThrow(`/api/billing/payments/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        flash(success, 'success')
        await load()
      } catch (err) {
        flash(normalizeCrudServerError(err).message || t('billing.payments.action_failed', 'The action failed'), 'error')
      }
    },
    [load, t],
  )

  const allocationColumns = React.useMemo<ColumnDef<AllocationRow>[]>(
    () => [
      {
        accessorKey: 'invoice_number',
        header: t('billing.payments.allocations.invoice', 'Invoice'),
        cell: ({ row }) => (
          <Link href={invoiceDetailHref(row.original.invoice_id)} className="text-primary hover:underline">
            {row.original.invoice_number ?? row.original.invoice_id}
          </Link>
        ),
      },
      {
        accessorKey: 'amount',
        header: t('billing.payments.columns.amount', 'Amount'),
        cell: ({ row }) => formatMoney(row.original.amount, row.original.currency_code),
      },
      {
        accessorKey: 'allocated_by',
        header: t('billing.payments.allocations.by', 'How'),
        cell: ({ row }) =>
          ({
            auto: t('billing.payments.allocations.by.auto', 'Matched automatically'),
            credit: t('billing.payments.allocations.by.credit', 'Credit applied'),
            user: t('billing.payments.allocations.by.user', 'Manual'),
            gateway: t('billing.payments.allocations.by.gateway', 'Online payment'),
          })[row.original.allocated_by] ?? row.original.allocated_by,
      },
      {
        accessorKey: 'created_at',
        header: t('billing.payments.allocations.at', 'When'),
        cell: ({ row }) => new Date(row.original.created_at).toLocaleString(),
      },
    ],
    [t],
  )

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState label={t('billing.payments.not_found', 'Payment not found')} backHref="/backend/billing/payments" backLabel={t('billing.payments.title', 'Payments')} />
        </PageBody>
      </Page>
    )
  }
  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (!data || !id) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('billing.payments.detail.loading', 'Loading payment…')} />
        </PageBody>
      </Page>
    )
  }

  const { payment, allocations } = data
  const unallocated = Number.parseFloat(payment.unallocated_amount)
  const hasAllocations = allocations.length > 0
  const isUnmatched = payment.status === 'unmatched'
  const canAllocate = Boolean(payment.bill_account_id) && ['matched', 'partially_allocated'].includes(payment.status) && unallocated > 0

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/payments"
        entityTypeLabel={t('billing.payments.detail.title', 'Payment')}
        title={formatMoney(payment.amount, payment.currency_code)}
        statusBadge={<Tag variant={PAYMENT_STATUS_VARIANT[payment.status] ?? 'default'}>{labels.status(payment.status)}</Tag>}
        actionsContent={
          <>
            {isUnmatched ? (
              <Button type="button" onClick={() => setDialog('assign')}>
                {t('billing.payments.actions.assign', 'Assign to account')}
              </Button>
            ) : null}
            {canAllocate ? (
              <Button type="button" onClick={() => setDialog('allocate')}>
                {t('billing.payments.actions.allocate', 'Allocate')}
              </Button>
            ) : null}
            {isUnmatched && unallocated === Number.parseFloat(payment.amount) ? (
              <Button type="button" variant="outline" onClick={() => setDialog('convert')}>
                {t('billing.payments.actions.convert', 'Convert to top-up')}
              </Button>
            ) : null}
            {payment.status === 'matched' && !hasAllocations ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void action('unassign', { paymentId: id }, t('billing.payments.actions.unassigned', 'Payment unassigned'))}
              >
                {t('billing.payments.actions.unassign', 'Unassign')}
              </Button>
            ) : null}
            {['unmatched', 'matched'].includes(payment.status) && !hasAllocations ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void action('ignore', { paymentId: id }, t('billing.payments.actions.ignored', 'Payment ignored'))}
              >
                {t('billing.payments.actions.ignore', 'Ignore')}
              </Button>
            ) : null}
            {payment.status === 'ignored' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void action('restore', { paymentId: id }, t('billing.payments.actions.restored', 'Payment restored'))}
              >
                {t('billing.payments.actions.restore', 'Restore')}
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="space-y-6">
          <DetailCard>
            <DetailField label={t('billing.payments.columns.received', 'Received')}>{payment.received_at?.slice(0, 10)}</DetailField>
            <DetailField label={t('billing.payments.columns.unallocated', 'Unallocated')}>
              {formatMoney(payment.unallocated_amount, payment.currency_code)}
            </DetailField>
            <DetailField label={t('billing.payments.columns.account', 'Account')}>
              {payment.bill_account_id ? (
                <Link href={accountHref(payment.bill_account_id)} className="text-primary hover:underline">
                  {payment.bill_account_name ?? payment.bill_account_id}
                </Link>
              ) : (
                '—'
              )}
            </DetailField>
            <DetailField label={t('billing.payments.fields.match_reason', 'Match')}>{labels.reason(payment.match_reason)}</DetailField>
            <DetailField label={t('billing.payments.columns.reference', 'Reference')}>{payment.reference ?? '—'}</DetailField>
            <DetailField label={t('billing.payments.columns.payer', 'Payer')}>
              {[payment.payer_name, payment.payer_account].filter(Boolean).join(' · ') || '—'}
            </DetailField>
            <DetailField label={t('billing.payments.fields.source', 'Source')}>
              {payment.import_id ? (
                <Link href={`/backend/billing/payments/imports/${payment.import_id}`} className="text-primary hover:underline">
                  {t('billing.payments.source.csv', 'Bank CSV')}
                </Link>
              ) : payment.source === 'gateway' ? (
                t('billing.payments.source.gateway', 'Online payment')
              ) : (
                t('billing.payments.source.manual', 'Manual entry')
              )}
            </DetailField>
            {payment.topup_id ? (
              <DetailField label={t('billing.payments.fields.topup', 'Top-up')}>
                <Link href={`/backend/billing/topups/${payment.topup_id}`} className="text-primary hover:underline">
                  {t('billing.payments.fields.topup_open', 'Open top-up')}
                </Link>
              </DetailField>
            ) : null}
          </DetailCard>

          <div>
            <h2 className="mb-2 text-base font-semibold">{t('billing.payments.allocations.title', 'Allocations')}</h2>
            <DataTable
              columns={allocationColumns}
              data={allocations}
              isLoading={false}
              emptyState={t('billing.payments.allocations.empty', 'Not allocated to any invoice.')}
              rowActions={(row) => (
                <RowActions
                  items={[
                    {
                      id: 'unallocate',
                      label: t('billing.payments.allocations.remove', 'Un-allocate'),
                      destructive: true,
                      onSelect: () => {
                        void confirm({
                          title: t('billing.payments.allocations.remove_confirm', 'Remove this allocation?'),
                          text: t('billing.payments.allocations.remove_text', 'The invoice becomes unpaid by this amount again.'),
                          confirmText: t('billing.payments.allocations.remove', 'Un-allocate'),
                          variant: 'destructive',
                        }).then((ok) => {
                          if (ok) void action('unallocate', { allocationId: row.id }, t('billing.payments.allocations.removed', 'Allocation removed'))
                        })
                      },
                    },
                  ]}
                />
              )}
              pagination={{ page: 1, pageSize: Math.max(allocations.length, 1), total: allocations.length, totalPages: 1, onPageChange: () => undefined }}
            />
          </div>
        </div>

        <AccountActionDialog
          open={dialog === 'assign'}
          title={t('billing.payments.actions.assign', 'Assign to account')}
          confirmLabel={t('billing.payments.actions.assign_confirm', 'Assign')}
          billingMode="postpaid"
          currencyCode={payment.currency_code}
          onClose={() => setDialog(null)}
          onConfirm={(billAccountId) => action('assign', { paymentId: id, billAccountId }, t('billing.payments.actions.assigned', 'Payment assigned'))}
        />
        <AccountActionDialog
          open={dialog === 'convert'}
          title={t('billing.payments.actions.convert', 'Convert to top-up')}
          confirmLabel={t('billing.payments.actions.convert_confirm', 'Convert')}
          billingMode="prepaid"
          currencyCode={payment.currency_code}
          initialAccountId={payment.bill_account_mode === 'prepaid' ? payment.bill_account_id : null}
          onClose={() => setDialog(null)}
          onConfirm={(billAccountId) =>
            action('convert-to-topup', { paymentId: id, billAccountId }, t('billing.payments.actions.converted', 'Top-up created'))
          }
        />
        {payment.bill_account_id ? (
          <AllocatePaymentDialog
            open={dialog === 'allocate'}
            onClose={() => setDialog(null)}
            onDone={() => void load()}
            paymentId={id}
            billAccountId={payment.bill_account_id}
            unallocated={unallocated}
            currencyCode={payment.currency_code}
          />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
