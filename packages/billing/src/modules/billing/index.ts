import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

// Side-effect import — registers every CRUD command in the global
// command bus at module load time. The makeCrudRoute factory looks up
// `actions.<verb>.commandId` against this registry at request time, so
// without this import every billing write returns "command not found".
// Pattern mirrors `@open-mercato/core/src/modules/customers/index.ts`.
import './commands'

export const metadata: ModuleInfo = {
  name: 'billing',
  title: 'Billing',
  version: '0.1.0',
  description:
    'Lightweight recurring-billing engine — collects one-time / recurring / usage items, runs Bill Runs and issues its own invoices, memos and top-up receipts (no core sales dependency).',
  author: 'Dainamite',
  license: 'MIT',
  // Spec 0: billing owns its documents. `payment_gateways` is optional
  // (online top-ups only, resolved at runtime); no sales / configs /
  // dictionaries dependency. Spec B: `attachments` (platform module) stores
  // frozen invoice PDFs and the document logo.
  requires: ['auth', 'directory', 'attachments'],
  ejectable: false,
}

export { features } from './acl'
