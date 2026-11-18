/**
 * Optional payment-gateway integration (Spec 0, E-D1).
 *
 * Billing no longer requires the `payment_gateways` module. When it is
 * installed, online top-ups open a checkout session through its
 * `paymentGatewayService`; when it isn't, top-ups via the gateway are
 * unavailable (501) and the UI hides the "Top up" button. Bank-transfer
 * top-ups are recorded through payments (billing Spec C).
 *
 * The structural type below covers only what billing calls, so billing never
 * deep-imports the gateway module's types.
 */

export type GatewaySessionRequest = {
  providerKey: string
  paymentId: string
  amount: number
  currencyCode: string
  captureMethod: 'automatic' | 'manual'
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  organizationId: string
  tenantId: string
}

export type GatewaySessionResult = {
  transaction: { id: string }
  session: { redirectUrl?: string | null; clientSecret?: string | null; sessionId?: string | null }
}

export type TopupPaymentGateway = {
  createPaymentSession(request: GatewaySessionRequest): Promise<GatewaySessionResult>
}

type ContainerLike = {
  hasRegistration?: (name: string) => boolean
  resolve: (name: string) => unknown
}

export const PAYMENT_GATEWAY_SERVICE = 'paymentGatewayService'

export function isPaymentGatewayAvailable(container: ContainerLike): boolean {
  return typeof container.hasRegistration === 'function' && container.hasRegistration(PAYMENT_GATEWAY_SERVICE)
}

/** The gateway service, or null when the `payment_gateways` module isn't installed. */
export function resolvePaymentGateway(container: ContainerLike): TopupPaymentGateway | null {
  if (!isPaymentGatewayAvailable(container)) return null
  const service = container.resolve(PAYMENT_GATEWAY_SERVICE) as Partial<TopupPaymentGateway> | null
  return service && typeof service.createPaymentSession === 'function' ? (service as TopupPaymentGateway) : null
}
