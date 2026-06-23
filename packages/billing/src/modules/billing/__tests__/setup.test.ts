/**
 * Setup contract tests.
 *
 * These are structural tests on the exported `ModuleSetupConfig` — they
 * verify the seed contract surface (role grants, callable hooks) without
 * spinning up MikroORM. Behavioral idempotency of the dictionary / config
 * seeds is exercised end-to-end via the integration suite once Phase 1
 * lands a real REST API; the structural checks below catch the most
 * common drift (missing role grant, deleted hook, wrong feature spelled
 * differently from acl.ts).
 */

import { features } from '../acl'
import setup from '../setup'

const featureIds = new Set<string>(features.map((f) => f.id))

describe('billing setup — contract', () => {
  it('exports onTenantCreated and seedDefaults hooks', () => {
    expect(typeof setup.onTenantCreated).toBe('function')
    expect(typeof setup.seedDefaults).toBe('function')
  })

  it('does not declare seedExamples (billing ships no demo data)', () => {
    expect(setup.seedExamples).toBeUndefined()
  })

  it('grants the admin role the billing.* wildcard', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual(['billing.*'])
  })

  it('billing_admin role gets every concrete billing feature', () => {
    const grants = setup.defaultRoleFeatures?.billing_admin ?? []
    for (const id of featureIds) {
      expect(grants).toContain(id)
    }
  })

  it('billing_finance_user is read-only + dry-run (no posting / no real trigger)', () => {
    const grants = setup.defaultRoleFeatures?.billing_finance_user ?? []
    // Read-only baseline
    expect(grants).toEqual(
      expect.arrayContaining([
        'billing.account.view',
        'billing.item.view',
        'billing.usage.view',
        'billing.run.view',
        'billing.invoice.view',
      ]),
    )
    // Dry-run preview is explicitly granted
    expect(grants).toContain('billing.run.dry_run')
    // …but not the real trigger / posting / editing
    expect(grants).not.toContain('billing.run.trigger')
    expect(grants).not.toContain('billing.invoice.post')
    expect(grants).not.toContain('billing.invoice.edit_draft')
    expect(grants).not.toContain('billing.usage.ingest')
  })

  it('billing_usage_writer is narrow scope: usage.ingest only', () => {
    expect(setup.defaultRoleFeatures?.billing_usage_writer).toEqual(['billing.usage.ingest'])
  })

  it('every feature granted to any default role exists in acl.ts (no typos)', () => {
    for (const [role, grants] of Object.entries(setup.defaultRoleFeatures ?? {})) {
      for (const grant of grants ?? []) {
        // Wildcards (`billing.*`) bypass the typo check by design.
        if (grant.endsWith('.*')) continue
        if (!featureIds.has(grant)) {
          throw new Error(
            `Role "${role}" grants unknown feature "${grant}" — not declared in acl.ts`,
          )
        }
      }
    }
  })
})

describe('billing acl — surface', () => {
  it('exports exactly 19 features (12 Phase 0 + 7 SPEC-002 prepaid)', () => {
    expect(features).toHaveLength(19)
  })

  it('all feature IDs are prefixed `billing.` (no leaking module boundary)', () => {
    for (const f of features) {
      expect(f.id.startsWith('billing.')).toBe(true)
      expect(f.module).toBe('billing')
    }
  })

  it.each([
    'billing.account.manage',
    'billing.account.view',
    'billing.item.manage',
    'billing.item.view',
    'billing.usage.ingest',
    'billing.usage.view',
    'billing.run.trigger',
    'billing.run.dry_run',
    'billing.run.view',
    'billing.invoice.post',
    'billing.invoice.edit_draft',
    'billing.invoice.view',
    // SPEC-002 prepaid
    'billing.balance.view',
    'billing.balance.adjust',
    'billing.topup.create',
    'billing.topup.view',
    'billing.statement.view',
    'billing.statement.generate',
    'billing.credit.view',
  ])('declares feature %s', (id) => {
    expect(featureIds.has(id)).toBe(true)
  })
})

describe('billing setup — prepaid read grants (SPEC-002)', () => {
  it('billing_finance_user can read prepaid balances, top-ups, statements, credit', () => {
    const grants = setup.defaultRoleFeatures?.billing_finance_user ?? []
    expect(grants).toEqual(
      expect.arrayContaining([
        'billing.balance.view',
        'billing.credit.view',
        'billing.topup.view',
        'billing.statement.view',
      ]),
    )
    // …but cannot adjust balances or initiate top-ups (read-only persona)
    expect(grants).not.toContain('billing.balance.adjust')
    expect(grants).not.toContain('billing.topup.create')
    expect(grants).not.toContain('billing.statement.generate')
  })
})
