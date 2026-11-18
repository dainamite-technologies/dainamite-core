import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { syncWorkflowDefinitionPrincipal } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import { COST_SOURCING_WORKFLOW_DEFINITION, COST_SOURCING_WORKFLOW_ID, seedGixCostSourcingWorkflow } from '../cost-sourcing-workflow'

jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({ syncWorkflowDefinitionPrincipal: jest.fn().mockResolvedValue(undefined) }))

const scope = { tenantId: 't', organizationId: 'o' }

function fakeEm() {
  const rows: Array<Record<string, unknown>> = []
  return {
    rows,
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'wf-1', ...data })),
    persist: jest.fn((row: Record<string, unknown>) => { rows.push(row) }),
    flush: jest.fn(async () => undefined),
  }
}

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => undefined); (syncWorkflowDefinitionPrincipal as jest.Mock).mockClear() })
afterEach(() => jest.restoreAllMocks())

describe('seedGixCostSourcingWorkflow', () => {
  it('seeds the cpq_cost_sourcing definition disabled, with its execution grant provisioned', async () => {
    const em = fakeEm()
    await seedGixCostSourcingWorkflow(em as never, {} as never, scope)
    expect(em.create).toHaveBeenCalledWith(WorkflowDefinition, expect.objectContaining({ workflowId: COST_SOURCING_WORKFLOW_ID, enabled: false, ...scope }))
    expect(em.rows).toHaveLength(1)
    expect(em.rows[0].grantedFeatures).toEqual(['cpq.costs.view', 'cpq.costs.manage'])
    expect(syncWorkflowDefinitionPrincipal).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a second run creates nothing', async () => {
    const em = fakeEm()
    await seedGixCostSourcingWorkflow(em as never, {} as never, scope)
    em.create.mockClear()
    await seedGixCostSourcingWorkflow(em as never, {} as never, scope)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.rows).toHaveLength(1)
    expect(syncWorkflowDefinitionPrincipal).toHaveBeenCalledTimes(1)
  })

  it('does not fail the seed when the principal cannot be provisioned', async () => {
    ;(syncWorkflowDefinitionPrincipal as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    await expect(seedGixCostSourcingWorkflow(fakeEm() as never, {} as never, scope)).resolves.toBeUndefined()
  })
})

describe('COST_SOURCING_WORKFLOW_DEFINITION', () => {
  it('passes the framework definition schema', () => {
    const parsed = workflowDefinitionDataSchema.safeParse(COST_SOURCING_WORKFLOW_DEFINITION)
    expect(parsed.success).toBe(true)
  })

  it('triggers on cost_requested for the partner tail and maps the request into the context', () => {
    const [trigger] = COST_SOURCING_WORKFLOW_DEFINITION.triggers ?? []
    expect(trigger).toMatchObject({ eventPattern: 'cpq.quote.cost_requested', enabled: true })
    expect(trigger.config?.filterConditions).toEqual([{ field: 'costKey', operator: 'eq', value: 'partner_tail' }])
    expect(trigger.config?.contextMapping?.map((m) => m.targetKey)).toEqual(['quoteId', 'costLineId', 'costRequestId', 'attributes'])
  })

  it('has the user task for admins, an IF_ELSE on the outcome, and two CALL_API steps with the schema-shaped bodies', () => {
    const steps = COST_SOURCING_WORKFLOW_DEFINITION.steps
    const task = steps.find((step) => step.stepType === 'USER_TASK')
    expect(task.stepName).toBe('Obtain carrier quote')
    expect(task.userTaskConfig.assignedToRoles).toEqual(['admin'])
    expect(task.userTaskConfig.formSchema.fields.map((f: { name: string }) => f.name))
      .toEqual(['outcome', 'unitAmount', 'currencyCode', 'supplierQuoteRef', 'validUntil', 'reason'])
    expect(steps.filter((step) => step.stepType === 'IF_ELSE')).toHaveLength(1)
    const calls = steps.filter((step) => step.stepType === 'AUTOMATED').map((step) => step.activities[0])
    expect(calls.map((call) => [call.activityType, call.config.method, call.config.endpoint])).toEqual([
      ['CALL_API', 'POST', '/api/cpq/quotes/{{context.quoteId}}/costs/{{context.costLineId}}/answer'],
      ['CALL_API', 'POST', '/api/cpq/quotes/{{context.quoteId}}/costs/{{context.costLineId}}/decline'],
    ])
    expect(Object.keys(calls[0].config.body).sort()).toEqual(['costRequestId', 'currencyCode', 'supplierQuoteRef', 'unitAmount', 'validUntil'])
    expect(Object.keys(calls[1].config.body).sort()).toEqual(['costRequestId', 'reason'])
    const gate = COST_SOURCING_WORKFLOW_DEFINITION.transitions.filter((t) => t.fromStepId === 'outcome_gate')
    expect(gate.find((t) => t.toStepId === 'post_answer')?.condition).toEqual({ operator: 'AND', rules: [{ field: 'outcome', operator: '==', value: 'answer' }] })
    expect(gate.find((t) => t.toStepId === 'post_decline')?.condition).toBeUndefined()
  })
})
