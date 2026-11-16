/**
 * `billing.operator_assistant`: allowlist integrity and default read-only
 * posture.
 */
import { aiAgents } from '../../ai-agents'
import { aiTools } from '../../ai-tools'
import { features } from '../../acl'
import { setup } from '../../setup'

const agent = aiAgents.find((entry) => entry.id === 'billing.operator_assistant')

describe('billing.operator_assistant', () => {
  it('is registered once under the billing module', () => {
    expect(agent).toBeDefined()
    expect(aiAgents.filter((entry) => entry.id === 'billing.operator_assistant')).toHaveLength(1)
    expect(agent!.moduleId).toBe('billing')
    expect(agent!.domain).toBe('billing')
  })

  it('lists only billing tools that exist in the billing tool pack', () => {
    const registered = new Set(aiTools.map((tool) => tool.name))
    const billingTools = agent!.allowedTools.filter((name) => name.startsWith('billing.'))
    expect(billingTools.length).toBeGreaterThan(0)
    for (const name of billingTools) expect(registered.has(name)).toBe(true)
  })

  it('exposes every billing tool and no tool from another domain module', () => {
    const allowed = new Set(agent!.allowedTools)
    for (const tool of aiTools) expect(allowed.has(tool.name)).toBe(true)
    for (const name of agent!.allowedTools) {
      expect(name).toMatch(/^(billing|search|attachments|meta)\./)
    }
    expect(allowed.has('meta.update_task_plan')).toBe(false)
  })

  it('is write-capable only through the confirm-required approval flow', () => {
    expect(agent!.readOnly).toBe(false)
    expect(agent!.mutationPolicy).toBe('confirm-required')
  })

  it('requires a declared billing view feature that the default roles grant', () => {
    const declared = new Set(features.map((feature) => feature.id))
    expect(agent!.requiredFeatures).toEqual(['billing.account.view'])
    expect(declared.has('billing.account.view')).toBe(true)
    const roleGrants = Object.values(setup.defaultRoleFeatures ?? {}).flat()
    expect(roleGrants.some((grant) => grant === 'billing.account.view' || grant === 'billing.*')).toBe(true)
  })

  it('tells the model never to invent amounts and never to propose real runs', () => {
    expect(agent!.systemPrompt).toMatch(/Never state an amount/)
    expect(agent!.systemPrompt).toMatch(/Never propose a real run/)
    expect(agent!.systemPrompt).toMatch(/in_advance/)
    expect(agent!.systemPrompt).toMatch(/in_arrears/)
    expect(agent!.suggestions?.length ?? 0).toBeGreaterThan(0)
  })
})
