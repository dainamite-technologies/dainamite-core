"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { PaymentsTable } from '../../../components/PaymentsTable'
import { PaymentUploadDialog } from '../../../components/PaymentUploadDialog'
import { ManualPaymentDialog } from '../../../components/ManualPaymentDialog'

/**
 * Payments (Spec C): the billing payment register. Upload a bank CSV (each
 * row becomes a payment, matched by invoice number), or record one manually.
 * Unmatched payments are fixed on the payment page.
 */
export default function BillingPaymentsPage() {
  const t = useT()
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [manualOpen, setManualOpen] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  return (
    <Page>
      <PageBody>
        <PaymentsTable
          title={t('billing.payments.title', 'Payments')}
          tableId="billing-payments"
          reloadKey={reloadKey}
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setManualOpen(true)}>
                <Plus size={16} />
                {t('billing.payments.manual.action', 'Record payment')}
              </Button>
              <Button type="button" onClick={() => setUploadOpen(true)}>
                <Upload size={16} />
                {t('billing.payments.import.open', 'Upload CSV')}
              </Button>
            </div>
          }
        />
        <PaymentUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onImported={() => setReloadKey((k) => k + 1)}
        />
        <ManualPaymentDialog
          open={manualOpen}
          onClose={() => setManualOpen(false)}
          onCreated={(paymentId) => router.push(`/backend/billing/payments/${encodeURIComponent(paymentId)}`)}
        />
      </PageBody>
    </Page>
  )
}
