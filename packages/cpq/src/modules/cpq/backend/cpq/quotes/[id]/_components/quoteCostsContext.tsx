'use client'

import * as React from 'react'
import type { FullQuoteCost, QuoteCostsResponse, RedactedQuoteCost } from '../../../../../lib/quoteCostView'

export type QuoteCostsUi = {
  quoteId: string
  cpqStatus: string
  locked: boolean
  /** `cpq.costs.view`: sees values, margin and the Costs panel. Display gating only; the API enforces. */
  canView: boolean
  /** `cpq.costs.manage` (plus quote manage): may add / edit / confirm costs and override markup. */
  canManage: boolean
  data: QuoteCostsResponse | null
  costsFor: (lineId: string) => Array<RedactedQuoteCost | FullQuoteCost>
  reload: () => Promise<void>
}

const Context = React.createContext<QuoteCostsUi | null>(null)
export const QuoteCostsProvider = Context.Provider
export const useQuoteCostsUi = () => React.useContext(Context)
