'use client'

import * as React from 'react'
import type { ChargeOption } from './CostFormBody'
import type { FullQuoteCost, QuoteCostsResponse, RedactedQuoteCost } from '../../../../../lib/quoteCostView'
import type { SourcingPermissions } from '../../../../../lib/costSourcingView'

/** Cost write actions, present when the user may manage costs. Each opens a dialog or asks for confirmation. */
export type CostActions = {
  add: (line: CostLineRef) => void
  edit: (cost: FullQuoteCost, line: CostLineRef) => void
  confirm: (cost: FullQuoteCost, line: CostLineRef) => void
  remove: (cost: FullQuoteCost) => void
  overrideMarkup: (line: CostLineRef) => void
}
export type CostLineRef = { lineId: string; lineName: string }

/** Supplier sourcing actions on a cost row (feature spec §UI/UX). Each opens a dialog or asks for confirmation. */
export type SourcingActionHandlers = {
  request: (cost: FullQuoteCost) => void
  cancel: (cost: FullQuoteCost) => void
  answer: (cost: FullQuoteCost, line: CostLineRef) => void
  decline: (cost: FullQuoteCost, line: CostLineRef) => void
  apply: (cost: FullQuoteCost) => void
}
export type SourcingUi = {
  permissions: SourcingPermissions
  /** The quote is rejected / cancelled / converted: no sourcing write is possible. */
  closed: boolean
  handlers: SourcingActionHandlers
}

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
  /** Present when the user holds any sourcing permission. */
  sourcing?: SourcingUi
}

const Context = React.createContext<QuoteCostsUi | null>(null)
export const QuoteCostsProvider = Context.Provider
export const useQuoteCostsUi = () => React.useContext(Context)
