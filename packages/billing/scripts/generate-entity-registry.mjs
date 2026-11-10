#!/usr/bin/env node
/**
 * Generates `generated/` at the package root — the entity-id registry that
 * ships with @dainamite/billing.
 *
 * Why it exists: in a standalone Open Mercato app, `mercato generate`
 * (@open-mercato/cli → lib/generators/entity-ids) collects a package
 * module's entity ids from `<package>/generated/entities.ids.generated.ts`
 * (falling back to `<package>/dist/generated/`), or else by parsing
 * `export class` declarations in the module's `data/entities` file. The
 * compiled `dist/modules/billing/data/entities.js` uses `export { … }`, so
 * without a shipped registry billing ends up as `"billing": {}`. Then the
 * query-index subscriber rejects every billing write (QueryIndexScopeError)
 * and `mercato entities install` registers the billing ids as virtual
 * custom entities, which empties every billing list.
 *
 * Even the source-parsing path is wrong for billing: it derives ids from
 * class names, so `BillRun` would become `billing:bill_run` while the code
 * uses `billing:billing_run`.
 *
 * Inputs (single sources of truth):
 *   - src/modules/billing/data/entityIds.ts → ids. The CLI ignores the
 *     values and builds each id as `billing:<key>`, so the keys written here
 *     are the id suffixes of `billingEntityIds`.
 *   - src/modules/billing/data/entities.ts → per-entity column lists, parsed
 *     the same way the CLI parses entity sources.
 *
 * Outputs (committed, and listed in package.json `files`):
 *   - generated/entities.ids.generated.ts
 *   - generated/entities/<key>/index.ts
 *
 * Usage:
 *   node scripts/generate-entity-registry.mjs          # write
 *   node scripts/generate-entity-registry.mjs --check  # exit 1 on drift
 * build.mjs and watch.mjs call `generateEntityRegistry()` too.
 */
import * as esbuild from 'esbuild'
import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_ID = 'billing'
const ENTITY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/
const GENERATOR = '@dainamite/billing scripts/generate-entity-registry.mjs'

const DEFAULT_PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─── Name helpers — copies of the framework's, so mapping matches runtime ──

/** Same as @open-mercato/cli `toSnake` (lib/utils). */
function toSnake(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/(?:^_+|_+$)/g, '')
    .toLowerCase()
}

/** Same as @open-mercato/cli `toVar` (lib/utils). */
function toVar(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}

/** Same as `toPascalCase` in @open-mercato/shared lib/query/engine. */
function toPascalCase(value) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** Same as `pluralizeBaseName` in @open-mercato/shared lib/query/engine. */
function pluralizeBaseName(name) {
  if (!name) return name
  if (name.endsWith('s')) return name
  if (name.endsWith('y')) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

// ─── Inputs ───────────────────────────────────────────────────────

async function loadEntityIds(packageRoot) {
  const file = join(packageRoot, 'src', 'modules', MODULE_ID, 'data', 'entityIds.ts')
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const ids = mod.billingEntityIds
  if (!ids || typeof ids !== 'object' || Object.keys(ids).length === 0) {
    throw new Error(`${relative(packageRoot, file)} must export a non-empty \`billingEntityIds\` object`)
  }

  const keys = []
  for (const [alias, id] of Object.entries(ids)) {
    const [moduleId, key, ...rest] = String(id).split(':')
    if (moduleId !== MODULE_ID || !key || rest.length > 0 || !ENTITY_KEY_PATTERN.test(key)) {
      throw new Error(`billingEntityIds.${alias} = "${id}" is not a valid "${MODULE_ID}:<snake_case>" entity id`)
    }
    if (keys.includes(key)) {
      throw new Error(`billingEntityIds declares "${id}" more than once`)
    }
    keys.push(key)
  }
  return keys
}

function readStringProperty(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : undefined
    if (name === propertyName && ts.isStringLiteralLike(property.initializer)) {
      return property.initializer.text
    }
  }
  return undefined
}

function firstObjectArgument(decorator) {
  const expression = decorator.expression
  if (!ts.isCallExpression(expression)) return undefined
  const [first] = expression.arguments
  return first && ts.isObjectLiteralExpression(first) ? first : undefined
}

/**
 * Exported entity classes → `{ tableName, fields }`. Column names follow the
 * CLI's own source parser: a property's first decorator `name` option, else
 * the snake_cased property name.
 */
function parseEntityClasses(packageRoot) {
  const file = join(packageRoot, 'src', 'modules', MODULE_ID, 'data', 'entities.ts')
  const sourceFile = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const classes = new Map()

  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return
    if (!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return

    let tableName
    for (const decorator of ts.getDecorators(node) ?? []) {
      const callee = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : undefined
      if (!callee || !ts.isIdentifier(callee) || callee.text !== 'Entity') continue
      const options = firstObjectArgument(decorator)
      tableName = options ? readStringProperty(options, 'tableName') : undefined
    }
    if (!tableName) return

    const fields = []
    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name) continue
      if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue
      const propertyName = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : undefined
      if (!propertyName) continue
      const [firstDecorator] = ts.getDecorators(member) ?? []
      const options = firstDecorator ? firstObjectArgument(firstDecorator) : undefined
      const column = (options && readStringProperty(options, 'name')) || toSnake(propertyName)
      if (!fields.includes(column)) fields.push(column)
    }

    classes.set(node.name.text, { className: node.name.text, tableName, fields })
  })

  return classes
}

/**
 * Pick the entity class an id resolves to. Mirrors the class-name lookup of
 * `resolveRegisteredEntityTableName` (@open-mercato/shared lib/query/engine):
 * `billing:<key>` → class `PascalCase(key)` or `PascalCase(key)Entity`.
 *
 * Its table-name fallback is deliberately NOT accepted: on Open Mercato
 * 0.9.0 with MikroORM 7 it never matches (it iterates
 * `MetadataStorage.getAll()` as an array, but that returns a Map), so an id
 * that only resolves by table name is still rejected by the query index and
 * misread by the query engine at runtime. Failing the build here beats
 * shipping such an id.
 */
function resolveEntityClass(key, classes) {
  const base = toPascalCase(key)
  for (const candidate of [base, `${base}Entity`]) {
    const match = classes.get(candidate)
    if (match) return match
  }

  const byTable = [...classes.values()].find((entity) =>
    [`${MODULE_ID}_${key}`, pluralizeBaseName(key), `${MODULE_ID}_${pluralizeBaseName(key)}`].includes(entity.tableName),
  )
  throw new Error(
    `"${MODULE_ID}:${key}" does not match an entity class name in data/entities.ts — expected class ${base}` +
      (byTable ? ` (table ${byTable.tableName} belongs to ${byTable.className}; rename the class)` : ''),
  )
}

// ─── Rendering ────────────────────────────────────────────────────

function renderIdsFile(keys) {
  const lines = [
    `// AUTO-GENERATED by ${GENERATOR} — do not edit.`,
    '// Regenerate with `yarn workspace @dainamite/billing build`.',
    '//',
    "// Read by a consuming app's `mercato generate` (@open-mercato/cli entity-ids",
    '// generator), which takes the KEYS of `E.billing` and registers each id as',
    '// `billing:<key>`. Source of truth: src/modules/billing/data/entityIds.ts.',
    '',
    'export const M = {',
    `  ${MODULE_ID}: '${MODULE_ID}',`,
    '} as const',
    '',
    'export const E = {',
    `  ${MODULE_ID}: {`,
    ...keys.map((key) => `    ${key}: '${MODULE_ID}:${key}',`),
    '  },',
    '} as const',
    '',
    'export type KnownModuleId = keyof typeof M',
    'export type KnownEntities = typeof E',
    '',
  ]
  return lines.join('\n')
}

function renderFieldsFile(key, entity) {
  const lines = [
    `// AUTO-GENERATED by ${GENERATOR} — do not edit.`,
    `// Columns of ${MODULE_ID}:${key} (${entity.className}, table ${entity.tableName}).`,
    '',
    ...entity.fields.map((field) => `export const ${toVar(field)} = ${JSON.stringify(field)}`),
    '',
  ]
  return lines.join('\n')
}

// ─── Entry point ──────────────────────────────────────────────────

/**
 * @param {{ packageRoot?: string, check?: boolean }} [options]
 * @returns {Promise<{ entityKeys: string[], changed: string[] }>} `changed`
 *   lists package-relative paths that were (or, with `check`, would be)
 *   written or removed.
 */
export async function generateEntityRegistry(options = {}) {
  const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT
  const check = options.check === true
  const generatedRoot = join(packageRoot, 'generated')
  const entitiesRoot = join(generatedRoot, 'entities')

  const keys = await loadEntityIds(packageRoot)
  const classes = parseEntityClasses(packageRoot)

  const desired = new Map([[join(generatedRoot, 'entities.ids.generated.ts'), renderIdsFile(keys)]])
  for (const key of keys) {
    desired.set(join(entitiesRoot, key, 'index.ts'), renderFieldsFile(key, resolveEntityClass(key, classes)))
  }

  const changed = []
  for (const [file, content] of desired) {
    if (existsSync(file) && readFileSync(file, 'utf8') === content) continue
    changed.push(relative(packageRoot, file))
    if (!check) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
  }

  if (existsSync(entitiesRoot)) {
    for (const entry of readdirSync(entitiesRoot, { withFileTypes: true })) {
      if (keys.includes(entry.name)) continue
      const stale = join(entitiesRoot, entry.name)
      changed.push(relative(packageRoot, stale))
      if (!check) rmSync(stale, { recursive: true, force: true })
    }
  }

  return { entityKeys: keys, changed }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const check = process.argv.includes('--check')
  try {
    const { entityKeys, changed } = await generateEntityRegistry({ check })
    if (check && changed.length > 0) {
      console.error(
        `@dainamite/billing generated/ is out of date (${changed.join(', ')}).\n` +
          'Run `yarn workspace @dainamite/billing build` and commit the result.',
      )
      process.exit(1)
    }
    const verb = check ? 'up to date' : changed.length > 0 ? `written (${changed.length} changed)` : 'unchanged'
    console.log(`@dainamite/billing entity registry ${verb}: ${entityKeys.length} entity ids`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
