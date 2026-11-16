"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { PaymentsTable } from './PaymentsTable'
import { paymentDetailHref } from '../lib/navigation'
import { ManualPaymentDialog } from './ManualPaymentDialog'

/**
 * Account Payments section (Spec C): the account's payments plus "Record
 * payment" (pre-filled account and currency). Self-contained so Spec E's
 * Payments tab can reuse it.
 */
export function AccountPaymentsSection({ accountId, currencyCode }: { accountId: string; currencyCode: string }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  return (
    <div className="mt-6">
      <PaymentsTable
        title={t('billing.accounts.detail.payments', 'Payments')}
        tableId="billing-account-payments"
        billAccountId={accountId}
        pageSize={10}
        actions={
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <Plus size={16} />
            {t('billing.payments.manual.action', 'Record payment')}
          </Button>
        }
      />
      <ManualPaymentDialog
        open={open}
        onClose={() => setOpen(false)}
        billAccountId={accountId}
        currencyCode={currencyCode}
        onCreated={(paymentId) => router.push(paymentDetailHref(paymentId, { fromAccountId: accountId }))}
      />
    </div>
  )
}
