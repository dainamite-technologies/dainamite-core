import { registerStepType } from '@dainamite/cpq/modules/cpq/workflows/registry'
import { ContextSelectStep } from './ContextSelectStep'

let registered = false

/**
 * Registers demo_puffin's wizard step types in the CPQ step registry.
 *
 * The CPQ registry is a process-local Map, so this must run in both the
 * server bootstrap (via setup.ts) and the client bundle (via the
 * widgets/components.ts side-effect entrypoint that ComponentOverridesBootstrap
 * pulls into every app render). registration is idempotent — guarded so a
 * second invocation is a no-op.
 */
export function registerPuffinStepTypes() {
  if (registered) return
  registered = true
  registerStepType({
    type: 'context_select',
    label: 'Context Select',
    description: 'Set a value on quoteContext.<field> from a list of options.',
    component: ContextSelectStep,
  })
}
