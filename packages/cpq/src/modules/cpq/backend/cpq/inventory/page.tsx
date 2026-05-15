"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CpqInteractionStyles } from '../../../components/CpqListView'
import { SubscriptionsTable } from './SubscriptionsTable'
import { AssetsTable } from './AssetsTable'

type TabKey = 'subscriptions' | 'assets'

export default function InventoryPage() {
  const t = useT()
  const [activeTab, setActiveTab] = React.useState<TabKey>('subscriptions')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'subscriptions', label: t('cpq.inventory.subscriptions', 'Subscriptions') },
    { key: 'assets', label: t('cpq.inventory.assets', 'Assets') },
  ]

  return (
    <Page>
      <PageBody className="cpq-list-view space-y-6">
        <CpqInteractionStyles />
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('cpq.inventory.title', 'Customer Inventory')}</h1>
        </div>

        <div className="flex gap-1 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`cursor-pointer px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'subscriptions' ? <SubscriptionsTable /> : <AssetsTable />}
      </PageBody>
    </Page>
  )
}
