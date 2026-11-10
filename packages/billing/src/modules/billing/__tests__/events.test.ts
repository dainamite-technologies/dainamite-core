/**
 * CRUD event declarations.
 *
 * Commands emit CRUD events indirectly: `emitCrudSideEffects({ action,
 * events: { module: 'billing', entity } })` makes the data engine emit
 * `billing.<entity>.<action>`. An id missing from events.ts is still emitted,
 * but logs "Emitting undeclared event" and stays invisible to the event
 * registry (workflow triggers, subscriber discovery).
 *
 * The scan below reads every `emitCrudSideEffects` / `emitCrudUndoSideEffects`
 * call in commands/ and requires the declared `crud` events to match exactly:
 * nothing emitted is undeclared, nothing declared is never emitted.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { isEventDeclared } from '@open-mercato/shared/modules/events'

import eventsConfig from '../events'

const COMMANDS_DIR = path.resolve(__dirname, '../commands')
const SIDE_EFFECT_HELPERS = new Set(['emitCrudSideEffects', 'emitCrudUndoSideEffects'])

type Emission = { eventId: string; file: string }

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrap(expression.expression)
  }
  return expression
}

function propertyOf(objectLiteral: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return unwrap(property.initializer)
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
      return property.name
    }
  }
  return undefined
}

function stringValue(expression: ts.Expression | undefined): string | undefined {
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined
}

/** Every `billing.<entity>.<action>` a command file emits through the CRUD helpers. */
function scanCommandFile(file: string): Emission[] {
  const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)

  // Module-level `const xEvents = { module, entity, … } as const`.
  const eventConfigs = new Map<string, ts.ObjectLiteralExpression>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const initializer = unwrap(declaration.initializer)
      if (ts.isObjectLiteralExpression(initializer)) eventConfigs.set(declaration.name.text, initializer)
    }
  }

  const emissions: Emission[] = []
  const relativeFile = path.relative(COMMANDS_DIR, file)
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SIDE_EFFECT_HELPERS.has(node.expression.text) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(unwrap(node.arguments[0]))
    ) {
      const options = unwrap(node.arguments[0]) as ts.ObjectLiteralExpression
      const eventsExpression = propertyOf(options, 'events')
      if (eventsExpression) {
        const config = ts.isIdentifier(eventsExpression)
          ? eventConfigs.get(eventsExpression.text)
          : ts.isObjectLiteralExpression(eventsExpression)
            ? eventsExpression
            : undefined
        const moduleId = config ? stringValue(propertyOf(config, 'module')) : undefined
        const entity = config ? stringValue(propertyOf(config, 'entity')) : undefined
        const action = stringValue(propertyOf(options, 'action'))
        if (!moduleId || !entity || !action) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
          throw new Error(
            `${relativeFile}:${line + 1}: cannot statically read the CRUD event of this ${node.expression.text} call — ` +
              'use a literal `action` and a module-level `events` config so this test can check it',
          )
        }
        emissions.push({ eventId: `${moduleId}.${entity}.${action}`, file: relativeFile })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return emissions
}

const emissions = fs
  .readdirSync(COMMANDS_DIR)
  .filter((name) => name.endsWith('.ts'))
  .flatMap((name) => scanCommandFile(path.join(COMMANDS_DIR, name)))
const emittedIds = Array.from(new Set(emissions.map((emission) => emission.eventId))).sort()
const declaredCrudIds = eventsConfig.events
  .filter((event) => event.category === 'crud')
  .map((event) => event.id)
  .sort()

describe('billing CRUD events', () => {
  it('finds the CRUD emissions in commands/', () => {
    // Guards the scanner itself: if it silently found nothing, the checks
    // below would pass vacuously.
    expect(emittedIds).toEqual(
      expect.arrayContaining(['billing.account.created', 'billing.item.updated', 'billing.topup.created']),
    )
  })

  it.each(emittedIds)('declares %s, which a command emits', (eventId) => {
    expect(declaredCrudIds).toContain(eventId)
    expect(isEventDeclared(eventId)).toBe(true)
  })

  it('declares no CRUD event that no command emits', () => {
    expect(declaredCrudIds).toEqual(emittedIds)
  })

  it('declares every CRUD event against the entity in its id', () => {
    for (const event of eventsConfig.events.filter((candidate) => candidate.category === 'crud')) {
      expect({ id: event.id, entity: event.entity }).toEqual({ id: event.id, entity: event.id.split('.')[1] })
    }
  })

  it('keeps the per-upload usage event out of workflow triggers, like billing.usage.rated', () => {
    const byId = new Map(eventsConfig.events.map((event) => [event.id, event]))
    expect(byId.get('billing.usage.created')?.excludeFromTriggers).toBe(true)
    expect(byId.get('billing.usage.rated')?.excludeFromTriggers).toBe(true)
  })
})
