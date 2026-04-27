import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqWizardDefinition } from '../data/entities'

export type CpqSeedScope = { tenantId: string; organizationId: string }

// ─── Wizard Definitions ────────────────────────────────────────

const WIZARDS = [
  {
    code: 'gix-access-port-bundle',
    name: 'GIX Access Port — Full Configuration',
    description: 'Guided 4-step flow: select customer, configure access port, choose additional services, review summary.',
    surface: 'backend',
    applicability: { specCodes: ['SPEC-GIX-ACCESS-PORT'], priority: 20 },
    paramsSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', format: 'uuid' },
        quoteId: { type: 'string', format: 'uuid' },
      },
    },
    steps: [
      {
        stepId: 'select-customer',
        type: 'customer_select',
        title: 'Select Customer',
        description: 'Choose the customer for this quote.',
        config: {},
        transitions: [
          {
            targetStepId: 'configure-port',
            condition: { field: 'params.companyId', operator: 'exists' },
            label: 'Configure Port',
          },
          { targetStepId: 'configure-port', isDefault: true },
        ],
      },
      {
        stepId: 'configure-port',
        type: 'product_configure',
        title: 'Configure Access Port',
        description: 'Select the port size for the GIX access port.',
        config: {
          offeringCode: 'OFFER-GIX-ACCESS-PORT',
          attributeGroups: [
            { label: 'Port Configuration', attributeCodes: ['data_centre', 'port_size'] },
          ],
        },
        transitions: [{ targetStepId: 'select-services', isDefault: true }],
      },
      {
        stepId: 'select-services',
        type: 'offering_select',
        title: 'Additional Services',
        description: 'Choose additional services: Internet Peering, Mobile Peering, or Cloud Connect.',
        config: {
          offeringFilter: { offeringCodes: ['OFFER-GIX-INTERNET-PEERING', 'OFFER-GIX-MOBILE-PEERING', 'OFFER-GIX-CLOUD-CONNECT'] },
          enableConfiguration: true,
          displayMode: 'grid',
        },
        transitions: [{ targetStepId: 'review', isDefault: true }],
      },
      {
        stepId: 'review',
        type: 'review',
        title: 'Summary',
        description: 'Review all items and pricing before submitting the quote.',
        config: {
          recalculateOnEnter: true,
          showChargeBreakdown: true,
          showAdjustments: true,
          submitAction: 'save',
          submitLabel: 'Create Quote',
        },
        transitions: [],
      },
    ],
  },
]

// ─── Main seed function ─────────────────────────────────────────

export async function seedCpqDefaults(em: EntityManager, scope: CpqSeedScope) {
  console.log('    Seeding wizard definitions...')
  try {
    for (const wz of WIZARDS) {
      em.persist(em.create(CpqWizardDefinition, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        code: wz.code,
        name: wz.name,
        description: wz.description,
        version: 1,
        steps: wz.steps as any,
        applicability: wz.applicability as any,
        paramsSchema: wz.paramsSchema as any,
        surface: wz.surface,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    }
    await em.flush()
  } catch {
    // Wizard entities may not be in MikroORM metadata when run from CLI bundle — seed via raw SQL
    console.log('    Wizard entity metadata not available, seeding via raw SQL...')
    const conn = em.getConnection()
    for (const wz of WIZARDS) {
      await conn.execute(
        `INSERT INTO cpq_wizard_definitions (id, organization_id, tenant_id, code, name, description, version, steps, applicability, params_schema, surface, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, 1, ?::jsonb, ?::jsonb, ?::jsonb, ?, true, now(), now())`,
        [scope.organizationId, scope.tenantId, wz.code, wz.name, wz.description, JSON.stringify(wz.steps), JSON.stringify(wz.applicability), JSON.stringify(wz.paramsSchema), wz.surface],
      )
    }
  }
  console.log('    Wizard seed complete.')
}
