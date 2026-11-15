"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InvoicesTable } from '../../../components/InvoicesTable'
import { BillingSettingsLink } from '../../../components/BillingSettingsLink'

/**
 * Billing Invoices list — what the operator opens every morning to review
 * and post drafts, and (Spec B) to chase overdue invoices.
 *
 * Billing documents only (`billing_invoices`); core Sales invoices are a
 * separate surface. The table itself is shared with the account page.
 */
export default function BillingInvoicesListPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <InvoicesTable title={t('billing.invoices.title', 'Billing Invoices')} tableId="billing-invoices"
          actions={<BillingSettingsLink />}
        />
      </PageBody>
    </Page>
  )
}
