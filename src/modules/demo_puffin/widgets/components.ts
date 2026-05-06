import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { registerPuffinStepTypes } from '../workflows/steps'

// Side-effect: register demo_puffin's CPQ wizard step types into the
// process-local registry. This file is statically imported by the generated
// component-overrides registry, which is itself loaded by the client-side
// ComponentOverridesBootstrap component mounted in AppProviders. As a result,
// the registration runs on every client render before any wizard page mounts.
registerPuffinStepTypes()

export const componentOverrides: ComponentOverride[] = []

export default componentOverrides
