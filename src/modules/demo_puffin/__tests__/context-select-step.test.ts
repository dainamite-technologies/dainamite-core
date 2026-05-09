/**
 * Verifies that demo_puffin registers the `context_select` wizard step type
 * into the CPQ workflow registry. Regression guard for the XD-275 companion
 * fix — without this registration the puffin-sales-led-quote wizard crashes
 * at step 2 with "Unknown step type: context_select".
 */

describe('context_select wizard step registration', () => {
  it('registers `context_select` in the CPQ step registry on import', async () => {
    const { registerPuffinStepTypes } = await import('../workflows/steps')
    registerPuffinStepTypes()

    const { getStepType } = await import('@dainamite/cpq/modules/cpq/workflows/registry')
    const stepType = getStepType('context_select')

    expect(stepType).toBeDefined()
    expect(stepType?.type).toBe('context_select')
    expect(stepType?.label).toBe('Context Select')
    expect(typeof stepType?.component).toBe('function')
  })

  it('registration is idempotent', async () => {
    const { registerPuffinStepTypes } = await import('../workflows/steps')
    registerPuffinStepTypes()
    registerPuffinStepTypes()
    registerPuffinStepTypes()

    const { getStepType } = await import('@dainamite/cpq/modules/cpq/workflows/registry')
    expect(getStepType('context_select')).toBeDefined()
  })

  it('demo_puffin/setup side-effect imports the step type registration', async () => {
    await import('../setup')

    const { getStepType } = await import('@dainamite/cpq/modules/cpq/workflows/registry')
    expect(getStepType('context_select')).toBeDefined()
  })

  it('puffin-sales-led-quote seed declares a context_select step that can now resolve', async () => {
    const { default: wizardsSource } = await import('fs').then((m) => ({
      default: m.readFileSync(
        require.resolve('../seeds/seeders/wizards.ts'),
        'utf8',
      ),
    }))
    expect(wizardsSource).toContain("type: 'context_select'")
    expect(wizardsSource).toContain("contextField: 'contract_model'")

    const { registerPuffinStepTypes } = await import('../workflows/steps')
    registerPuffinStepTypes()
    const { getStepType } = await import('@dainamite/cpq/modules/cpq/workflows/registry')
    expect(getStepType('context_select')).toBeDefined()
  })
})
