'use client'

import * as React from 'react'
import type { ChargeOption } from './CostFormBody'
import type { FullQuoteCost, QuoteCostsResponse, RedactedQuoteCost } from '../../../../../lib/quoteCostView'

/** Cost write actions, present when the user may manage costs. Each opens a dialog or asks for confirmation. */
export type CostActions = {
  add: (line: CostLineRef) => void
  edit: (cost: FullQuoteCost, line: CostLineRef) => void
  confirm: (cost: FullQuoteCost, line: CostLineRef) => void
  remove: (cost: FullQuoteCost) => void
  overrideMarkup: (line: CostLineRef) => void
}
export type CostLineRef = { lineId: string; lineName: string }

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
  /** Cost-plus charges of a line (markup override targets) and all its charges (cost targets). */
  chargesFor?: (lineId: string) => ChargeOption[]
  actions?: CostActions
}

const Context = React.createContext<QuoteCostsUi | null>(null)
export const QuoteCostsProvider = Context.Provider
export const useQuoteCostsUi = () => React.useContext(Context)
