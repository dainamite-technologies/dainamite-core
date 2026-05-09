import type { EntityManager } from '@mikro-orm/postgresql'
import type { SeedScope } from './_types'

const WIZARDS = [
  {
    code: 'puffin-sales-led-quote',
    name: 'Puffin — Sales-Led Quote',
    description:
      'Backend wizard for sales reps to walk a customer from contract model selection through line configuration to review.',
    surface: 'backend',
    applicability: { specCodes: ['SPEC-PUFFIN-VPS', 'SPEC-PUFFIN-COMPUTE', 'SPEC-PUFFIN-MANAGED-DB'], priority: 30 },
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
        transitions: [{ targetStepId: 'choose-contract', isDefault: true }],
      },
      {
        stepId: 'choose-contract',
        type: 'context_select',
        title: 'Contract Model',
        description: 'On-Demand / Reserved 1y / Reserved 3y.',
        config: {
          contextField: 'contract_model',
          options: [
            { value: 'on_demand', label: 'On-Demand' },
            { value: 'reserved_1y', label: 'Reserved 1 year (−22%)' },
            { value: 'reserved_3y', label: 'Reserved 3 years (−38%)' },
          ],
        },
        transitions: [{ targetStepId: 'add-products', isDefault: true }],
      },
      {
        stepId: 'add-products',
        type: 'offering_select',
        title: 'Add Products',
        description: 'Add one or more lines to the quote.',
        config: { displayMode: 'grid' },
        transitions: [{ targetStepId: 'review', isDefault: true }],
      },
      {
        stepId: 'review',
        type: 'review',
        title: 'Review & Send',
        description: 'Validate the configuration and price the quote.',
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

export async function seedPuffinWizards(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqWizardDefinition } = await import('@dainamite/cpq/modules/cpq/data/entities')
  try {
    for (const wz of WIZARDS) {
      const existing = await em.findOne(CpqWizardDefinition, { ...scope, code: wz.code })
      if (existing) continue
      em.persist(
        em.create(CpqWizardDefinition, {
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
        }),
      )
    }
    await em.flush()
  } catch {
    const conn = em.getConnection()
    for (const wz of WIZARDS) {
      const existing = await conn.execute(
        `SELECT id FROM cpq_wizard_definitions WHERE tenant_id = ? AND organization_id = ? AND code = ? LIMIT 1`,
        [scope.tenantId, scope.organizationId, wz.code],
      )
      if (Array.isArray(existing) && existing.length > 0) continue
      await conn.execute(
        `INSERT INTO cpq_wizard_definitions (id, organization_id, tenant_id, code, name, description, version, steps, applicability, params_schema, surface, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, 1, ?::jsonb, ?::jsonb, ?::jsonb, ?, true, now(), now())`,
        [
          scope.organizationId,
          scope.tenantId,
          wz.code,
          wz.name,
          wz.description,
          JSON.stringify(wz.steps),
          JSON.stringify(wz.applicability),
          JSON.stringify(wz.paramsSchema),
          wz.surface,
        ],
      )
    }
  }
}
