'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'

/** Shown when a status change hit `409 STALE_REVISION`: prices moved since the page loaded. */
export function StaleRevisionBanner({ onReload }: { onReload: () => void }) {
  const t = useT()
  return (
    <Alert variant="warning" data-testid="cpq-stale-revision">
      <AlertDescription>
        {t('cpq.quoteCosts.stale', 'Prices changed since you opened the quote — reload')}
        <Button variant="outline" size="sm" className="ml-2" onClick={onReload}>{t('cpq.quoteCosts.staleReload', 'Reload')}</Button>
      </AlertDescription>
    </Alert>
  )
}
