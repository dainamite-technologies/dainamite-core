/**
 * Contract tests for the `cpq.quoting_assistant` and `cpq.catalog_assistant`
 * agent definitions.
 */
import aiAgentsDefault, {
  CPQ_CATALOG_ASSISTANT_ID,
  CPQ_CATALOG_READ_TOOLS,
  CPQ_CATALOG_WRITE_TOOLS,
  CPQ_CUSTOMER_TOOLS,
  CPQ_GENERAL_TOOLS,
  CPQ_QUOTING_ASSISTANT_ID,
  CPQ_READ_TOOLS,
  CPQ_WRITE_TOOLS,
  aiAgents,
  cpqCatalogAssistant,
  cpqQuotingAssistant,
} from '../../ai-agents'
import { aiTools } from '../../ai-tools'
import { aiTools as customersAiTools } from '@open-mercato/core/modules/customers/ai-tools'
import features from '../../acl'
import setup from '../../setup'

const toolByName = new Map(aiTools.map((tool) => [tool.name, tool]))

describe('cpq.quoting_assistant', () => {
  it('is exported by the module next to the catalog assistant', () => {
    expect(aiAgents).toEqual([cpqQuotingAssistant, cpqCatalogAssistant])
    expect(aiAgentsDefault).toBe(aiAgents)
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

  it('exposes every registered CPQ tool except the catalog writes (#128)', () => {
    expect(cpqQuotingAssistant.allowedTools.filter((name) => name.startsWith('cpq.')).sort()).toEqual(
      aiTools.map((tool) => tool.name).filter((name) => !CPQ_CATALOG_WRITE_TOOLS.includes(name)).sort(),
    )
    for (const name of CPQ_CATALOG_WRITE_TOOLS) expect(cpqQuotingAssistant.allowedTools).not.toContain(name)
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
    expect([...CPQ_WRITE_TOOLS, ...CPQ_CATALOG_WRITE_TOOLS].sort()).toEqual(flagged)
  })

  it('can look up customers and deals, read-only, for cpq.create_quote', () => {
    const customersByName = new Map(customersAiTools.map((tool) => [tool.name, tool]))
    for (const name of CPQ_CUSTOMER_TOOLS) {
      expect(cpqQuotingAssistant.allowedTools).toContain(name)
      const tool = customersByName.get(name)
      expect({ name, registered: Boolean(tool), isMutation: tool?.isMutation === true }).toEqual({
        name,
        registered: true,
        isMutation: false,
      })
    }
    const customerWrites = customersAiTools.filter((tool) => tool.isMutation === true).map((tool) => tool.name)
    for (const name of customerWrites) expect(cpqQuotingAssistant.allowedTools).not.toContain(name)
    expect(cpqQuotingAssistant.systemPrompt).toContain('customers.list_companies')
  })

  it('keeps the general-purpose framework packs on the allowlist', () => {
    for (const name of CPQ_GENERAL_TOOLS) expect(cpqQuotingAssistant.allowedTools).toContain(name)
    expect(cpqQuotingAssistant.allowedTools).not.toContain('meta.update_task_plan')
  })

  it('requires cpq.quotes.view, declared in acl.ts and granted to the default roles', () => {
    expect(cpqQuotingAssistant.requiredFeatures).toEqual(['cpq.quotes.view'])
    const declared = new Set<string>(features.map((feature) => feature.id))
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

  it('proposes one write at a time so cards do not go stale (seen in a live run)', () => {
    for (const agent of [cpqQuotingAssistant, cpqCatalogAssistant]) {
      expect(agent.systemPrompt).toMatch(/Propose ONE write at a time/)
      expect(agent.systemPrompt).toMatch(/Never call two write tools in the same turn/)
      expect(agent.systemPrompt).toMatch(/propose\s+that one write again with a new tool call/)
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

describe('cpq.catalog_assistant (#128)', () => {
  it('has a stable id in the cpq module', () => {
    expect(cpqCatalogAssistant.id).toBe(CPQ_CATALOG_ASSISTANT_ID)
    expect(cpqCatalogAssistant.id).toBe('cpq.catalog_assistant')
    expect(cpqCatalogAssistant.moduleId).toBe('cpq')
  })

  it('allows the catalog reads and writes and nothing from quotes', () => {
    const cpqTools = cpqCatalogAssistant.allowedTools.filter((name) => name.startsWith('cpq.')).sort()
    expect(cpqTools).toEqual([...CPQ_CATALOG_READ_TOOLS, ...CPQ_CATALOG_WRITE_TOOLS].sort())
    for (const name of cpqTools) expect({ name, registered: toolByName.has(name) }).toEqual({ name, registered: true })
    for (const name of CPQ_CATALOG_READ_TOOLS) expect(CPQ_READ_TOOLS).toContain(name)
    for (const name of CPQ_CATALOG_WRITE_TOOLS) expect(toolByName.get(name)?.isMutation).toBe(true)
    for (const name of CPQ_GENERAL_TOOLS) expect(cpqCatalogAssistant.allowedTools).toContain(name)
  })

  it('is write-capable with confirmation and only for catalog admins', () => {
    expect(cpqCatalogAssistant.readOnly).toBe(false)
    expect(cpqCatalogAssistant.mutationPolicy).toBe('confirm-required')
    expect(cpqCatalogAssistant.requiredFeatures).toEqual(['cpq.offerings.manage'])
    expect(new Set<string>(features.map((feature) => feature.id)).has('cpq.offerings.manage')).toBe(true)
    expect(cpqCatalogAssistant.systemPrompt).toMatch(/approval card/)
  })

  it('forbids invented ids and writes claimed without a tool call (seen in a live run)', () => {
    expect(cpqCatalogAssistant.systemPrompt).toMatch(/every id you use or show must come\s+from a tool result/)
    expect(cpqCatalogAssistant.systemPrompt).toMatch(/unless you called the write tool in this turn/)
  })

  it('never contains long dashes in operator-facing text', () => {
    const texts = [
      cpqCatalogAssistant.systemPrompt,
      cpqCatalogAssistant.description,
      ...(cpqCatalogAssistant.suggestions ?? []).flatMap((s) => [s.label, s.prompt]),
    ]
    for (const text of texts) expect(text).not.toMatch(/[\u2013\u2014]/)
  })
})
