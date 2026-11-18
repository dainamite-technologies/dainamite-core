import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WorkflowDefinition, type WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import { syncWorkflowDefinitionPrincipal } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import { COST_ELEMENTS } from './data/cost-plus'

const log = (msg: string) => console.log(`    [demo_gix:cost-sourcing-workflow] ${msg}`)

export const COST_SOURCING_WORKFLOW_ID = 'cpq_cost_sourcing'

/**
 * Least-privilege ceiling of the recipe's runs. The event-triggered run has no human initiator (`initiatedBy` is
 * `trigger:<id>`), and CALL_API refuses to run without a traceable principal, so the definition declares its own
 * execution principal that may do exactly what the two CALL_API steps do: call the answer / decline routes.
 */
export const COST_SOURCING_WORKFLOW_GRANT = ['cpq.costs.view', 'cpq.costs.manage'] as const

const costRoute = (action: 'answer' | 'decline') => `/api/cpq/quotes/{{context.quoteId}}/costs/{{context.costLineId}}/${action}`

/**
 * Recipe: a supplier cost request for the partner tail becomes a user task for procurement; the outcome (answer or
 * decline) is then posted to the cost API with the request id the event carried. Form fields are merged FLAT into the
 * workflow context on task completion, so the CALL_API bodies read them as `{{context.<field>}}`.
 */
export const COST_SOURCING_WORKFLOW_DEFINITION: WorkflowDefinitionData = {
  steps: [
    { stepId: 'start', stepName: 'Cost requested', stepType: 'START' },
    {
      stepId: 'obtain_carrier_quote',
      stepName: 'Obtain carrier quote',
      stepType: 'USER_TASK',
      description: 'Get the partner tail price from the carrier, then answer the request or decline it. Amount, currency and quote reference are required for an answer, the reason for a decline.',
      userTaskConfig: {
        assignedToRoles: ['admin'],
        formSchema: {
          fields: [
            { name: 'outcome', type: 'select', label: 'Outcome', required: true, options: ['answer', 'decline'] },
            { name: 'unitAmount', type: 'number', label: 'Amount (monthly cost)' },
            { name: 'currencyCode', type: 'text', label: 'Currency (ISO 4217, e.g. USD)' },
            { name: 'supplierQuoteRef', type: 'text', label: 'Supplier quote reference' },
            { name: 'validUntil', type: 'date', label: 'Valid until' },
            { name: 'reason', type: 'textarea', label: 'Reason (when declining)' },
          ],
        },
      },
    },
    { stepId: 'outcome_gate', stepName: 'Answered or declined?', stepType: 'IF_ELSE' },
    {
      stepId: 'post_answer',
      stepName: 'Post the answer',
      stepType: 'AUTOMATED',
      activities: [{
        activityId: 'answer_cost_request',
        activityName: 'POST answer',
        activityType: 'CALL_API',
        config: {
          endpoint: costRoute('answer'),
          method: 'POST',
          body: {
            costRequestId: '{{context.costRequestId}}',
            unitAmount: '{{context.unitAmount}}',
            currencyCode: '{{context.currencyCode}}',
            supplierQuoteRef: '{{context.supplierQuoteRef}}',
            validUntil: '{{context.validUntil}}',
          },
        },
        retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maxIntervalMs: 10000 },
      }],
    },
    {
      stepId: 'post_decline',
      stepName: 'Post the decline',
      stepType: 'AUTOMATED',
      activities: [{
        activityId: 'decline_cost_request',
        activityName: 'POST decline',
        activityType: 'CALL_API',
        config: {
          endpoint: costRoute('decline'),
          method: 'POST',
          body: { costRequestId: '{{context.costRequestId}}', reason: '{{context.reason}}' },
        },
        retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maxIntervalMs: 10000 },
      }],
    },
    { stepId: 'end', stepName: 'Request closed', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'start_to_task', fromStepId: 'start', toStepId: 'obtain_carrier_quote', trigger: 'auto', priority: 100 },
    { transitionId: 'task_to_gate', fromStepId: 'obtain_carrier_quote', toStepId: 'outcome_gate', trigger: 'auto', priority: 100 },
    {
      transitionId: 'gate_to_answer', transitionName: 'Answered', fromStepId: 'outcome_gate', toStepId: 'post_answer', trigger: 'auto', priority: 100,
      condition: { operator: 'AND', rules: [{ field: 'outcome', operator: '==', value: 'answer' }] },
    },
    // Unconditioned "otherwise" route: wins only when the cased route does not match.
    { transitionId: 'gate_to_decline', transitionName: 'Declined', fromStepId: 'outcome_gate', toStepId: 'post_decline', trigger: 'auto', priority: 0 },
    { transitionId: 'answer_to_end', fromStepId: 'post_answer', toStepId: 'end', trigger: 'auto', priority: 100 },
    { transitionId: 'decline_to_end', fromStepId: 'post_decline', toStepId: 'end', trigger: 'auto', priority: 100 },
  ],
  triggers: [{
    triggerId: 'cost_requested_partner_tail',
    name: 'Partner tail cost requested',
    description: 'Starts when a supplier cost request is opened for the partner tail cost',
    eventPattern: 'cpq.quote.cost_requested',
    config: {
      filterConditions: [{ field: 'costKey', operator: 'eq', value: COST_ELEMENTS.partnerTail }],
      contextMapping: [
        { targetKey: 'quoteId', sourceExpression: 'quoteId' },
        { targetKey: 'costLineId', sourceExpression: 'costLineId' },
        { targetKey: 'costRequestId', sourceExpression: 'costRequestId' },
        { targetKey: 'attributes', sourceExpression: 'attributes' },
      ],
    },
    enabled: true,
    priority: 0,
  }],
}

/**
 * Seeds the `cpq_cost_sourcing` recipe DISABLED (`enabled: false`; an operator enables it in the workflows
 * studio). Idempotent: an existing definition (including a soft-deleted one) is never touched. The definition's
 * execution principal is provisioned with `syncWorkflowDefinitionPrincipal` so the event-triggered run can call the API.
 */
export async function seedGixCostSourcingWorkflow(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const existing = await em.findOne(WorkflowDefinition, { workflowId: COST_SOURCING_WORKFLOW_ID, ...scope })
  if (existing) { log(`Skipping "${COST_SOURCING_WORKFLOW_ID}" — already present.`); return }
  const definition = em.create(WorkflowDefinition, {
    workflowId: COST_SOURCING_WORKFLOW_ID,
    workflowName: 'CPQ — obtain carrier quote for partner tail',
    description: 'Procurement task opened for each partner tail supplier cost request; posts the answer or decline to the CPQ cost API.',
    version: 1,
    enabled: false,
    definition: COST_SOURCING_WORKFLOW_DEFINITION,
    metadata: { category: 'CPQ', tags: ['cpq', 'cost-sourcing'], icon: 'truck' },
    grantedFeatures: [...COST_SOURCING_WORKFLOW_GRANT],
    ...scope,
  })
  em.persist(definition)
  await em.flush()
  try {
    await syncWorkflowDefinitionPrincipal(container, definition)
  } catch (error) {
    // Fails closed at runtime (the run refuses without a principal); re-saving the definition in the studio re-provisions it.
    log(`Could not provision the execution principal (${error instanceof Error ? error.message : String(error)}).`)
  }
  log(`Seeded "${COST_SOURCING_WORKFLOW_ID}" (disabled).`)
}
