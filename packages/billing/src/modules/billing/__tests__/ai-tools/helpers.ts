import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

export const MODULE_ROOT = path.resolve(__dirname, '..', '..')

export function makeToolContext(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    container: {} as AwilixContainer,
    userFeatures: ['billing.*'],
    isSuperAdmin: false,
    ...overrides,
  }
}

/**
 * Reads `requireFeatures` for one HTTP method from a route file's `metadata`
 * literal (`GET: { requireAuth: true, requireFeatures: ['a', 'b'] }`). Parsing
 * the source keeps the test free of the route's runtime imports (ORM, DI).
 */
export async function readRouteFeatures(routeFile: string, method: string): Promise<string[]> {
  const source = await fs.readFile(path.join(MODULE_ROOT, routeFile), 'utf-8')
  const match = source.match(new RegExp(`\\b${method}:\\s*\\{[^}]*requireFeatures:\\s*\\[([^\\]]*)\\]`))
  if (!match) throw new Error(`No ${method} requireFeatures in ${routeFile}`)
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
}

export async function routeHasOpenApi(routeFile: string): Promise<boolean> {
  const source = await fs.readFile(path.join(MODULE_ROOT, routeFile), 'utf-8')
  return /export const openApi\b/.test(source)
}
