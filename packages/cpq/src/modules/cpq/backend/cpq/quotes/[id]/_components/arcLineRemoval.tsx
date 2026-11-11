'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { isArcCancelledLine, removalCancelsItem, type ArcRemovalLine } from '../../../../../services/arcLineRemoval'

type RemovableLine = Pick<ArcRemovalLine, 'action' | 'configuration'> & { lineId: string; offeringName: string }

export type ArcLineRemovalUi = {
  /** The line is an existing subscription item marked for removal. */
  isRemoved: (line: Pick<RemovableLine, 'action'>) => boolean
  restore: (lineId: string) => void
}

const ArcLineRemovalContext = React.createContext<ArcLineRemovalUi | null>(null)

export const ArcLineRemovalProvider = ArcLineRemovalContext.Provider

export function useArcLineRemovalUi(): ArcLineRemovalUi | null {
  return React.useContext(ArcLineRemovalContext)
}

/**
 * Line removal on the quote page. On an Amend / Renew quote, removing a line
 * that mirrors a live subscription item asks for confirmation and marks the
 * item for removal (server turns it into a `cancel` line); it can be restored.
 * Other lines are deleted as before.
 */
export function useArcLineRemoval<Q extends { id: string; lines: RemovableLine[] }>({ quote, quoteType, onQuote, onError }: {
  quote: Q | null
  quoteType: string
  onQuote: (quote: Q) => void
  onError: (message: string | null) => void
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const send = React.useCallback(async (url: string, method: 'DELETE' | 'POST') => {
    onError(null)
    const call = await apiCall<Q & { error?: string }>(url, { method })
    if (call.ok && call.result) onQuote(call.result)
    else onError(call.result?.error ?? t('cpq.quotes.lineUpdateFailed', 'Could not update the line'))
  }, [onError, onQuote, t])

  const remove = React.useCallback(async (lineId: string) => {
    if (!quote) return
    const line = quote.lines.find((candidate) => candidate.lineId === lineId)
    if (line && removalCancelsItem(line, quoteType)) {
      const ok = await confirm({
        title: t('cpq.quotes.arc.removeConfirm.title', 'Remove {name} from the subscription?').replace('{name}', line.offeringName),
        text: t(
          'cpq.quotes.arc.removeConfirm.text',
          'This item already exists on the subscription. Removing it here does not delete it from the quote — it stays as a "remove" line, and when the order is activated the item (and its components) is cancelled on the subscription and its recurring charge stops. You can restore it until then.',
        ),
        confirmText: t('cpq.quotes.arc.removeConfirm.confirm', 'Remove item'),
        variant: 'destructive',
      })
      if (!ok) return
    }
    await send(`/api/cpq/quotes/${quote.id}/items/${lineId}`, 'DELETE')
  }, [confirm, quote, quoteType, send, t])

  const restore = React.useCallback((lineId: string) => {
    if (!quote) return
    void send(`/api/cpq/quotes/${quote.id}/items/${lineId}/restore`, 'POST')
  }, [quote, send])

  const ui = React.useMemo<ArcLineRemovalUi>(() => ({
    isRemoved: (line) => isArcCancelledLine(line, quoteType),
    restore,
  }), [quoteType, restore])

  return { remove, ui, ConfirmDialogElement }
}
