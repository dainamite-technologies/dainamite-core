import type { ModuleCli } from '@open-mercato/shared/modules/registry'

const seedCommand: ModuleCli = {
  command: 'seed',
  async run() {
    console.log('CPQ seed: no default seed data. Configure specifications, offerings, and pricing via the admin UI.')
  },
}

export default [seedCommand]
