import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqWizardDefinition } from '../data/entities'
import type { TenantScope } from './types'
import type {
  WizardDefinitionResult,
  WizardResolveContext,
  WizardDefinitionFilter,
  WizardApplicability,
  WizardStepDefinition,
} from '../workflows/types'

// ─── Helpers ────────────────────────────────────────────────────

function toDefinitionResult(entity: CpqWizardDefinition): WizardDefinitionResult {
  return {
    id: entity.id,
    code: entity.code,
    name: entity.name,
    description: entity.description ?? null,
    version: entity.version,
    steps: entity.steps as unknown as WizardStepDefinition[],
    applicability: (entity.applicability as WizardApplicability) ?? null,
    paramsSchema: entity.paramsSchema ?? null,
    surface: entity.surface,
    isActive: entity.isActive,
    metadata: entity.metadata ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  }
}

// ─── Service ────────────────────────────────────────────────────

export class DefaultCpqWizardService {
  constructor(private em: EntityManager) {}

  // ─── Definitions ────────────────────────────────────────────

  async listDefinitions(
    filter: WizardDefinitionFilter & {
      search?: string | null
      sortField?: 'createdAt' | 'updatedAt' | 'name' | 'code' | 'surface'
      sortDir?: 'asc' | 'desc'
    },
    scope: TenantScope,
    page = 1,
    pageSize = 50,
  ) {
    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }
    if (filter.surface && filter.surface !== 'any') where.surface = filter.surface
    if (filter.isActive !== undefined) where.isActive = filter.isActive

    const search = filter.search?.trim()
    if (search) {
      where.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
        { description: { $ilike: `%${search}%` } },
      ]
    }

    const sortField = filter.sortField ?? 'createdAt'
    const sortDir = filter.sortDir === 'asc' ? 'asc' : 'desc'

    const [items, total] = await this.em.findAndCount(CpqWizardDefinition, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    return {
      items: items.map(toDefinitionResult),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async getDefinition(idOrCode: string, scope: TenantScope): Promise<WizardDefinitionResult | null> {
    const baseWhere = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    // Try by UUID first, then by code
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode)
    const entity = await this.em.findOne(CpqWizardDefinition, {
      ...baseWhere,
      ...(isUuid ? { id: idOrCode } : { code: idOrCode }),
    })

    return entity ? toDefinitionResult(entity) : null
  }

  async createDefinition(
    input: {
      code: string
      name: string
      description?: string | null
      steps: Array<Record<string, unknown>>
      applicability?: Record<string, unknown> | null
      paramsSchema?: Record<string, unknown> | null
      surface?: string
      isActive?: boolean
      metadata?: Record<string, unknown> | null
    },
    scope: TenantScope,
  ): Promise<WizardDefinitionResult> {
    const entity = this.em.create(CpqWizardDefinition, {
      ...input,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    await this.em.flush()
    return toDefinitionResult(entity)
  }

  async updateDefinition(
    id: string,
    updates: Record<string, unknown>,
    scope: TenantScope,
  ): Promise<WizardDefinitionResult | null> {
    const entity = await this.em.findOne(CpqWizardDefinition, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!entity) return null

    // Increment version when steps or applicability change
    if (updates.steps || updates.applicability) {
      updates.version = entity.version + 1
    }

    this.em.assign(entity, updates)
    await this.em.flush()
    return toDefinitionResult(entity)
  }

  async deleteDefinition(id: string, scope: TenantScope): Promise<boolean> {
    const entity = await this.em.findOne(CpqWizardDefinition, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!entity) return false

    entity.deletedAt = new Date()
    await this.em.flush()
    return true
  }

  // ─── Resolution ─────────────────────────────────────────────

  async resolveWizard(
    context: WizardResolveContext,
    scope: TenantScope,
  ): Promise<WizardDefinitionResult | null> {
    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      deletedAt: null,
    }

    // Filter by surface: match exact or 'any'
    where.surface = { $in: [context.surface, 'any'] }

    const definitions = await this.em.find(CpqWizardDefinition, where)
    if (definitions.length === 0) return null

    // Score each definition by applicability match
    let bestMatch: CpqWizardDefinition | null = null
    let bestPriority = -Infinity

    for (const def of definitions) {
      const app = def.applicability as WizardApplicability | null
      const priority = app?.priority ?? 0

      // Check applicability conditions
      if (app) {
        if (app.surface && app.surface !== context.surface) continue
        if (app.specCodes?.length && context.specCode && !app.specCodes.includes(context.specCode)) continue
        if (app.offeringCodes?.length && context.offeringCode && !app.offeringCodes.includes(context.offeringCode)) continue
        if (app.customerSegments?.length && context.customerSegment && !app.customerSegments.includes(context.customerSegment)) continue
      }

      if (priority > bestPriority) {
        bestPriority = priority
        bestMatch = def
      }
    }

    return bestMatch ? toDefinitionResult(bestMatch) : null
  }
}
