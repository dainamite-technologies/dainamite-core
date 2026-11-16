/**
 * Contract tests for the `cpq.quoting_assistant` agent definition.
 */
import aiAgentsDefault, {
  CPQ_GENERAL_TOOLS,
  CPQ_QUOTING_ASSISTANT_ID,
  CPQ_READ_TOOLS,
  CPQ_WRITE_TOOLS,
  aiAgents,
  cpqQuotingAssistant,
} from '../../ai-agents'
import { aiTools } from '../../ai-tools'
import features from '../../acl'
import setup from '../../setup'

const toolByName = new Map(aiTools.map((tool) => [tool.name, tool]))

describe('cpq.quoting_assistant', () => {
  it('is the single agent exported by the module', () => {
    expect(aiAgents).toHaveLength(1)
    expect(aiAgentsDefault).toBe(aiAgents)
    expect(aiAgents[0]).toBe(cpqQuotingAssistant)
    expect(cpqQuotingAssistant.id).toBe(CPQ_QUOTING_ASSISTANT_ID)
    expect(cpqQuotingAssistant.id).toBe('cpq.quoting_assistant')
    expect(cpqQuotingAssistant.moduleId).toBe('cpq')
    expect(cpqQuotingAssistant.domain).toBe('cpq')
  })

  it('every cpq.* tool in allowedTools exists in aiTools', () => {
    const cpqTools = cpqQuotingAssistant.allowedTools.filter((name) => name.startsWith('cpq.'))
    expect(cpqTools.length).toBeGreaterThan(0)
    for (const name of cpqTools) expect({ name, registered: toolByName.has(name) }).toEqual({ name, registered: true })
  })

  it('exposes every registered CPQ tool', () => {
    expect(cpqQuotingAssistant.allowedTools.filter((name) => name.startsWith('cpq.')).sort()).toEqual(
      aiTools.map((tool) => tool.name).sort(),
    )
  })

  it('is write-capable with confirmation, so tenant overrides can still lock it to read-only', () => {
    // Tenant mutation-policy overrides can only restrict the code-declared
    // policy; a read-only declaration would make the write tools unusable.
    expect(cpqQuotingAssistant.readOnly).toBe(false)
    expect(cpqQuotingAssistant.mutationPolicy).toBe('confirm-required')
    expect(cpqQuotingAssistant.systemPrompt).toMatch(/approval card/)
  })

  it('splits read and write tools by their isMutation flag', () => {
    for (const name of CPQ_WRITE_TOOLS) {
      expect(cpqQuotingAssistant.allowedTools).toContain(name)
      expect({ name, isMutation: toolByName.get(name)?.isMutation }).toEqual({ name, isMutation: true })
    }
    for (const name of CPQ_READ_TOOLS) {
      expect({ name, isMutation: toolByName.get(name)?.isMutation === true }).toEqual({ name, isMutation: false })
    }
    const flagged = aiTools.filter((tool) => tool.isMutation === true).map((tool) => tool.name).sort()
    expect([...CPQ_WRITE_TOOLS].sort()).toEqual(flagged)
  })

  it('keeps the general-purpose framework packs on the allowlist', () => {
    for (const name of CPQ_GENERAL_TOOLS) expect(cpqQuotingAssistant.allowedTools).toContain(name)
    expect(cpqQuotingAssistant.allowedTools).not.toContain('meta.update_task_plan')
  })

  it('requires cpq.quotes.view, declared in acl.ts and granted to the default roles', () => {
    expect(cpqQuotingAssistant.requiredFeatures).toEqual(['cpq.quotes.view'])
    const declared = new Set(features.map((feature) => feature.id))
    expect(declared.has('cpq.quotes.view')).toBe(true)
    const grants = Object.values(setup.defaultRoleFeatures ?? {}).flat()
    expect(grants.some((grant) => grant === 'cpq.quotes.view' || grant === 'cpq.*' || grant === 'cpq.quotes.*')).toBe(true)
  })

  it('teaches the CPQ vocabulary and the pricing rule', () => {
    const prompt = cpqQuotingAssistant.systemPrompt
    for (const term of ['specification', 'Offering', 'Configuration', 'price rules', 'amend', 'renew', 'cancel', 'in_approval']) {
      expect(prompt).toContain(term)
    }
    expect(prompt).toMatch(/NEVER guess, estimate or compute a price/)
    expect(prompt).toContain('cpq.calculate_price')
  })

  it('ships keywords and starter suggestions', () => {
    expect(cpqQuotingAssistant.keywords).toEqual(expect.arrayContaining(['cpq', 'quote', 'pricing']))
    expect(cpqQuotingAssistant.suggestions?.length).toBeGreaterThanOrEqual(3)
    for (const suggestion of cpqQuotingAssistant.suggestions ?? []) {
      expect(suggestion.label.length).toBeGreaterThan(0)
      expect(suggestion.prompt.length).toBeGreaterThan(0)
    }
  })

  it('never contains long dashes in operator-facing text', () => {
    const texts = [
      cpqQuotingAssistant.systemPrompt,
      cpqQuotingAssistant.description,
      ...(cpqQuotingAssistant.suggestions ?? []).flatMap((s) => [s.label, s.prompt]),
      ...aiTools.map((tool) => tool.description),
    ]
    for (const text of texts) expect(text).not.toMatch(/[\u2013\u2014]/)
  })
})
