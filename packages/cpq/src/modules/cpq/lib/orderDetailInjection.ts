/**
 * Injection spot for extra tabs on the CPQ order detail page. Widgets get
 * `CpqOrderDetailInjectionContext` as `context` and the order API result as
 * `data` (it changes after activation, so widgets can react to the status).
 */
export const CPQ_ORDER_DETAIL_TABS_SPOT = 'cpq.order.detail:tabs'

export type CpqOrderDetailInjectionContext = {
  /** CPQ order id (`CpqOrderConfiguration.id`). */
  orderId: string
  salesOrderId: string
  cpqStatus: string
  customerId: string
  currencyCode: string
  quoteType: string
}
