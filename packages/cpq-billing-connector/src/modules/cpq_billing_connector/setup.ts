import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * No tenant-init work: no dictionaries, no seed data. Role defaults mirror
 * CPQ's order permissions — whoever activates CPQ orders (admin) sets their
 * billing up; whoever can view CPQ orders (employee) can see it.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['cpq_billing_connector.*'],
    employee: ['cpq_billing_connector.order_setup.view'],
  },
}

export default setup
