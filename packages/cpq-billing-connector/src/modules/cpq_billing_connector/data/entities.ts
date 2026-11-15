import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Billing setup of one CPQ order: which billing account the order's
 * subscription bills to, overrides for a new account, and the bill start
 * per line. Spec `2026-11-15-cpq-billing-connector-order-billing-setup`.
 *
 * Owned by the connector because it is the only package that knows both
 * CPQ and billing. Every cross-package reference is an FK string:
 *   - `cpq_order_id` → `CpqOrderConfiguration.id` (@dainamite/cpq)
 *   - `billing_account_id` / `applied_billing_account_id` →
 *     `BillingAccount.id` (@dainamite/billing)
 *   - `line_bill_starts` keys → sales order line ids, i.e. the `lineId`
 *     the CPQ order API exposes (`CpqOrderLineConfiguration.orderLineId`)
 *
 * Once the activation subscriber applies the setup (`applied_at`), the row
 * is read-only and records the account actually used.
 */
@Entity({ tableName: 'cpq_billing_connector_order_setups' })
@Index({
  name: 'cpq_billing_connector_order_setups_order_unique',
  properties: ['organizationId', 'tenantId', 'cpqOrderId'],
  expression:
    'CREATE UNIQUE INDEX "cpq_billing_connector_order_setups_order_unique" ON "cpq_billing_connector_order_setups" ("organization_id", "tenant_id", "cpq_order_id") WHERE "deleted_at" IS NULL',
})
@Index({
  name: 'cpq_billing_connector_order_setups_customer_idx',
  properties: ['organizationId', 'tenantId', 'customerId'],
})
export class CpqBillingOrderSetup {
  [OptionalProps]?:
    | 'billingAccountId'
    | 'accountOverrides'
    | 'defaultBillStartDate'
    | 'lineBillStarts'
    | 'appliedAt'
    | 'appliedBillingAccountId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'cpq_order_id', type: 'uuid' })
  cpqOrderId!: string

  @Property({ name: 'customer_id', type: 'text' })
  customerId!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  /** `existing` = bill to `billing_account_id`; `new` = create an account at activation. */
  @Property({ name: 'account_mode', type: 'text' })
  accountMode!: 'existing' | 'new'

  @Property({ name: 'billing_account_id', type: 'text', nullable: true })
  billingAccountId?: string | null

  /** Only the new-account fields the operator changed; the rest come from the customer. */
  @Property({ name: 'account_overrides', type: 'jsonb', default: '{}' })
  accountOverrides: Record<string, unknown> = {}

  /** `null` = bill from the activation date. */
  @Property({ name: 'default_bill_start_date', type: 'date', columnType: 'date', nullable: true })
  defaultBillStartDate?: string | null

  /** `{ [salesOrderLineId]: 'YYYY-MM-DD' }` — only lines the operator overrode. */
  @Property({ name: 'line_bill_starts', type: 'jsonb', default: '{}' })
  lineBillStarts: Record<string, string> = {}

  @Property({ name: 'applied_at', type: Date, nullable: true })
  appliedAt?: Date | null

  @Property({ name: 'applied_billing_account_id', type: 'text', nullable: true })
  appliedBillingAccountId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
