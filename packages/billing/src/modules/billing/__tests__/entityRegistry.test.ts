/**
 * Shipped entity-id registry (`packages/billing/generated/`).
 *
 * A standalone Open Mercato app only registers billing's entity ids if the
 * package ships `generated/entities.ids.generated.ts` — the compiled
 * `dist/.../data/entities.js` uses `export { … }`, which the CLI's class
 * scanner cannot see, so without the registry the app gets
 * `"billing": {}`. Two things then break:
 *   - the query-index subscriber rejects every billing write
 *     (`QueryIndexScopeError: Query index entity type is not registered`);
 *   - `mercato entities install` registers the ids as virtual custom
 *     entities and the query engine stops reading the billing tables.
 *
 * These tests pin the registry contents, check it is in sync with its
 * sources, run the real `@open-mercato/cli` generator over the package,
 * and feed the ids through the framework functions that failed, against
 * billing's real MikroORM metadata (discovered without a database) — down
 * to what `billing.accounts.create` hands the real data engine.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { EntityManager } from '@mikro-orm/postgresql'
import { MikroORM } from '@mikro-orm/postgresql'
import {
  QueryIndexScopeError,
  resolveQueryIndexSourceMetadata,
} from '@open-mercato/core/modules/query_index/lib/subscriber-scope'
import { DefaultDataEngine, isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { isEventDeclared } from '@open-mercato/shared/modules/events'

import { createAccountCommand } from '../commands/accounts'
import '../events'
import * as billingEntities from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import { E, M } from '../../../../generated/entities.ids.generated'

const PACKAGE_ROOT = path.resolve(__dirname, '../../../..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const GENERATED_ROOT = path.join(PACKAGE_ROOT, 'generated')

const ALL_IDS = Object.values(billingEntityIds)
const suffixOf = (id: string) => id.split(':')[1]

/** Every billing id → the table the framework must resolve it to. */
const EXPECTED_TABLES: Record<string, string> = {
  [billingEntityIds.account]: 'billing_accounts',
  [billingEntityIds.item]: 'billing_items',
  [billingEntityIds.usage]: 'billing_account_usage',
  [billingEntityIds.run]: 'billing_runs',
  [billingEntityIds.runOutcome]: 'billing_run_outcomes',
  [billingEntityIds.draftInvoiceEdit]: 'billing_draft_invoice_edits',
  [billingEntityIds.balance]: 'billing_account_balances',
  [billingEntityIds.transaction]: 'billing_account_transactions',
  [billingEntityIds.topup]: 'billing_topups',
  [billingEntityIds.statement]: 'billing_statements',
}

/** PascalCase of an id suffix — the class name the framework looks up. */
const classNameOf = (id: string) =>
  suffixOf(id)
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

/** A registry as a real app would have it: core ids present, billing empty (the bug). */
const REGISTRY_WITHOUT_BILLING = {
  directory: { tenant: 'directory:tenant', organization: 'directory:organization' },
  billing: {},
}

function readShippedColumns(key: string): string[] {
  const file = path.join(GENERATED_ROOT, 'entities', key, 'index.ts')
  const source = fs.readFileSync(file, 'utf8')
  return Array.from(source.matchAll(/^export const \w+ = "([^"]+)"$/gm), (m) => m[1])
}

let orm: MikroORM
let em: EntityManager

beforeAll(() => {
  // Every runtime export of data/entities.ts is an entity class.
  const entityClasses = Object.values(billingEntities)
  // The constructor discovers metadata synchronously; no connection is opened.
  orm = new MikroORM({ entities: entityClasses, dbName: 'billing_entity_registry_test' })
  em = orm.em.fork() as EntityManager
})

afterAll(async () => {
  await orm.close(true)
})

describe('shipped registry — generated/entities.ids.generated.ts', () => {
  it('declares the billing module', () => {
    expect(M).toEqual({ billing: 'billing' })
  })

  it('lists every billingEntityIds value under its id suffix, and nothing else', () => {
    // The CLI ignores the values and registers `billing:<key>`, so the keys
    // are what matters.
    const expected = Object.fromEntries(ALL_IDS.map((id) => [suffixOf(id), id]))
    expect(E.billing).toEqual(expected)
    expect(Object.keys(E.billing)).toHaveLength(10)
  })

  it('ships one column file per entity, matching the ORM columns', () => {
    const shippedDirs = fs.readdirSync(path.join(GENERATED_ROOT, 'entities')).sort()
    expect(shippedDirs).toEqual(ALL_IDS.map(suffixOf).sort())

    for (const id of ALL_IDS) {
      const table = EXPECTED_TABLES[id]
      const meta = orm.getMetadata().getAll()
      const entityMeta = Array.from(meta.values()).find((candidate) => candidate.tableName === table)
      expect(entityMeta).toBeDefined()
      const ormColumns = entityMeta!.props.flatMap((prop) => prop.fieldNames ?? [])
      expect({ id, columns: readShippedColumns(suffixOf(id)).sort() }).toEqual({ id, columns: [...ormColumns].sort() })
    }
  })

  it('is in sync with data/entityIds.ts and data/entities.ts', () => {
    // Throws (exit 1) and names the stale files when generated/ drifted.
    expect(() =>
      execFileSync(process.execPath, [path.join(PACKAGE_ROOT, 'scripts', 'generate-entity-registry.mjs'), '--check'], {
        cwd: PACKAGE_ROOT,
        stdio: 'pipe',
        timeout: 60_000,
      }),
    ).not.toThrow()
  })

  it('is what `mercato generate` registers for billing in a standalone app', () => {
    // Runs the real @open-mercato/cli entity-ids generator over the package,
    // resolved the way a standalone app resolves it (dist/modules when built,
    // else src/modules). Without the registry this yields `billing: {}` (dist)
    // or class-derived ids such as `billing:bill_run` (src).
    const script = `
      import fs from 'node:fs'
      import os from 'node:os'
      import path from 'node:path'
      import { createRequire } from 'node:module'
      const [repoRoot] = process.argv.slice(1)
      const require = createRequire(path.join(repoRoot, 'package.json'))
      const { generateEntityIds } = await import(require.resolve('@open-mercato/cli/lib/generators/entity-ids'))
      const pkgRoot = path.join(repoRoot, 'node_modules', '@dainamite', 'billing')
      const distModules = path.join(pkgRoot, 'dist', 'modules')
      const pkgModules = fs.existsSync(distModules) ? distModules : path.join(pkgRoot, 'src', 'modules')
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-entity-ids-'))
      try {
        await generateEntityIds({
          quiet: true,
          resolver: {
            isMonorepo: () => false,
            getOutputDir: () => out,
            getPackageOutputDir: () => out,
            loadEnabledModules: () => [{ id: 'billing', from: '@dainamite/billing' }],
            getModulePaths: (entry) => ({
              appBase: path.join(repoRoot, 'src', 'modules', entry.id),
              pkgBase: path.join(pkgModules, entry.id),
            }),
            getModuleImportBase: (entry) => ({ appBase: '@/modules/' + entry.id, pkgBase: entry.from + '/modules/' + entry.id }),
            getPackageRoot: (from) => path.join(repoRoot, 'node_modules', from),
          },
        })
        const source = fs.readFileSync(path.join(out, 'entities.ids.generated.ts'), 'utf8')
        const match = source.match(/E = (\\{[\\s\\S]*?\\}) as const/)
        process.stdout.write(match ? match[1] : 'null')
      } finally {
        fs.rmSync(out, { recursive: true, force: true })
      }
    `
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    const generated = JSON.parse(output) as { billing?: Record<string, string> }
    expect(generated.billing).toEqual(E.billing)
  }, 90_000)
})

describe('entity id → ORM table (resolveRegisteredEntityTableName)', () => {
  it.each(ALL_IDS)('resolves %s to its table', (id) => {
    expect(resolveRegisteredEntityTableName(em, id)).toBe(EXPECTED_TABLES[id])
  })

  it.each(ALL_IDS)('%s matches its entity class name', (id) => {
    // The class-name lookup is the only path that works on Open Mercato 0.9
    // (see the canary below). `billing_run` was `BillRun` until 0.20.0.
    expect(classNameOf(id) in billingEntities).toBe(true)
    // Look up by class-name string, as the framework does (MikroORM 7 types
    // only admit class references here, but the runtime accepts names).
    expect(orm.getMetadata().find(classNameOf(id) as never)?.tableName).toBe(EXPECTED_TABLES[id])
  })

  it('canary: the framework table-name fallback never matches on MikroORM 7', () => {
    // `billing:runs` → candidate table `billing_runs`, which exists. The
    // fallback iterates `MetadataStorage.getAll()` as an array, but MikroORM 7
    // returns a Map, so it finds nothing. If this starts failing, upstream
    // fixed it — the class-name rule in scripts/generate-entity-registry.mjs
    // can then be relaxed.
    expect(resolveRegisteredEntityTableName(em, 'billing:runs')).toBeNull()
  })
})

describe('query index accepts billing writes', () => {
  it('rejects billing ids while the app registry has `billing: {}` (the bug)', () => {
    registerEntityIds(REGISTRY_WITHOUT_BILLING as never)
    expect(() => resolveQueryIndexSourceMetadata(em, billingEntityIds.account)).toThrow(QueryIndexScopeError)
    expect(() => resolveQueryIndexSourceMetadata(em, billingEntityIds.account)).toThrow(
      'Query index entity type is not registered: billing:billing_account',
    )
  })

  it.each(ALL_IDS)('resolves the tenant-scoped source of %s once the shipped registry is registered', (id) => {
    registerEntityIds({ ...REGISTRY_WITHOUT_BILLING, ...E } as never)
    expect(resolveQueryIndexSourceMetadata(em, id)).toEqual({
      table: EXPECTED_TABLES[id],
      organizationColumn: 'organization_id',
      tenantColumn: 'tenant_id',
    })
  })
})

describe('query engine reads billing ids from their tables', () => {
  // The hybrid query engine checks `isOrmBackedSystemEntityId` before it
  // consults `custom_entities`. Only a registered id short-circuits there, so
  // an active `custom_entities` row (written by `mercato entities install`)
  // can no longer route billing reads to custom-entity storage.
  it('does not treat billing ids as ORM-backed while the registry has `billing: {}`', () => {
    registerEntityIds(REGISTRY_WITHOUT_BILLING as never)
    for (const id of ALL_IDS) {
      expect({ id, ormBacked: isOrmBackedSystemEntityId(em, id) }).toEqual({ id, ormBacked: false })
    }
  })

  it('treats every billing id as ORM-backed with the shipped registry', () => {
    registerEntityIds({ ...REGISTRY_WITHOUT_BILLING, ...E } as never)
    for (const id of ALL_IDS) {
      expect({ id, ormBacked: isOrmBackedSystemEntityId(em, id) }).toEqual({ id, ormBacked: true })
    }
  })
})

describe('billing.accounts.create side effects', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111'
  const ORG = '22222222-2222-4222-8222-222222222222'
  const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

  it('emits a declared CRUD event and a query-index upsert the index accepts', async () => {
    registerEntityIds({ ...REGISTRY_WITHOUT_BILLING, ...E } as never)

    const emitted: Array<{ event: string; payload: Record<string, unknown> }> = []
    const eventBus = {
      emitEvent: jest.fn(async (event: string, payload: Record<string, unknown>) => {
        emitted.push({ event, payload })
      }),
    }
    const commandEm = {
      fork: () => commandEm,
      create: (_entity: unknown, data: Record<string, unknown>) => ({ id: ACCOUNT_ID, ...data }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'eventBus') return eventBus
        if (name === 'em') return commandEm
        if (name === 'dataEngine') return dataEngine
        throw new Error(`unexpected resolve(${name})`)
      },
    }
    // The real data engine: it turns the command's side effects into the
    // CRUD event and the `query_index.upsert_one` call.
    const dataEngine = new DefaultDataEngine(em as never, container as never)

    await createAccountCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        customerId: 'cust-1',
        name: 'Acme',
        currencyCode: 'EUR',
        billCycle: 'monthly',
        billCycleAnchor: '1',
        invoiceEmail: 'billing@acme.test',
        invoiceLanguage: 'en',
        invoiceAddress: { line1: 'Main St 1', city: 'Berlin', postal_code: '10115', country: 'DE' },
        nextBillDate: '2026-12-01',
      } as never,
      { auth: null, container } as never,
    )
    // The command bus flushes queued side effects after `execute`.
    await dataEngine.flushOrmEntityChanges()

    const crudEvent = emitted.find((entry) => entry.event.startsWith('billing.'))
    expect(crudEvent?.event).toBe('billing.account.created')
    expect(isEventDeclared('billing.account.created')).toBe(true)

    const upsert = emitted.find((entry) => entry.event === 'query_index.upsert_one')
    expect(upsert?.payload).toMatchObject({
      entityType: 'billing:billing_account',
      recordId: ACCOUNT_ID,
      tenantId: TENANT,
      organizationId: ORG,
    })
    // The first thing the `query_index.upsert_one` subscriber does — the
    // call that threw QueryIndexScopeError and wrote `indexer_error_logs`.
    expect(resolveQueryIndexSourceMetadata(em, String(upsert!.payload.entityType))).toEqual({
      table: 'billing_accounts',
      organizationColumn: 'organization_id',
      tenantColumn: 'tenant_id',
    })
  })
})
