/**
 * Test harness for the CPQ AI tools.
 *
 * The tools are API-backed: their handler builds an operation and hands it
 * to `createAiApiOperationRunner(ctx).run(...)`. Tests mock that factory (see
 * the `jest.mock` call in each test file) and route every operation through
 * `FakeApi`, so a test can assert the exact method / path / query / body a
 * tool produces and feed it a canned route response.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AiApiOperationRequest, AiApiOperationResponse } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { aiTools } from '../../ai-tools'
import type { CpqAiToolDefinition } from '../../ai-tools/_shared'

export const MODULE_ROOT = path.resolve(__dirname, '..', '..')

export const TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const ORG_ID = '22222222-2222-4222-8222-222222222222'
export const USER_ID = '33333333-3333-4333-8333-333333333333'

export const QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const OFFERING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export const OFFERING_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
export const CUSTOMER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
export const SPEC_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
export const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444'
export const ASSET_ID = '55555555-5555-4555-8555-555555555555'
export const ORDER_ID = '66666666-6666-4666-8666-666666666666'

export function makeCtx(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    container: {} as McpToolContext['container'],
    userFeatures: ['cpq.*'],
    isSuperAdmin: false,
    ...overrides,
  }
}

export function getTool(name: string): CpqAiToolDefinition {
  const tool = aiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`Tool ${name} is not registered in aiTools`)
  return tool
}

type Responder = (request: AiApiOperationRequest) => AiApiOperationResponse<unknown> | undefined

/** Records every operation and answers with the first responder that returns a response. */
export class FakeApi {
  readonly calls: AiApiOperationRequest[] = []
  private responders: Responder[] = []

  on(method: AiApiOperationRequest['method'], pathMatch: string | RegExp, data: unknown, statusCode = 200): this {
    this.responders.push((request) => {
      if (request.method !== method) return undefined
      const matches = typeof pathMatch === 'string' ? request.path === pathMatch : pathMatch.test(request.path)
      if (!matches) return undefined
      return statusCode >= 200 && statusCode < 300
        ? { success: true, statusCode, data }
        : { success: false, statusCode, error: typeof data === 'string' ? data : 'Request failed' }
    })
    return this
  }

  run = async (request: AiApiOperationRequest): Promise<AiApiOperationResponse<unknown>> => {
    this.calls.push(request)
    for (const responder of this.responders) {
      const response = responder(request)
      if (response) return response
    }
    return { success: false, statusCode: 404, error: `No fake response for ${request.method} ${request.path}` }
  }

  /** The operations that are not the preview / pre-flight GET of a quote. */
  writes(): AiApiOperationRequest[] {
    return this.calls.filter((call) => call.method !== 'GET')
  }
}

/* -------------------------------------------------------------------------- */
/*  Route metadata (static parse, no route import)                            */
/* -------------------------------------------------------------------------- */

/**
 * Reads `requireFeatures` per method from a CPQ route file's `metadata`
 * export. Static parsing keeps the test fast and free of the route's
 * runtime imports (ORM entities, Next.js, services).
 */
export async function readRouteFeatures(routeFile: string): Promise<Record<string, string[]>> {
  const source = await fs.readFile(path.join(MODULE_ROOT, 'api', routeFile), 'utf-8')
  const start = source.indexOf('export const metadata')
  if (start === -1) throw new Error(`No metadata export in ${routeFile}`)
  const nextExport = source.indexOf('\nexport ', start + 1)
  const block = source.slice(start, nextExport === -1 ? undefined : nextExport)
  const out: Record<string, string[]> = {}
  for (const match of block.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*\{[^}]*?requireFeatures:\s*\[([^\]]*)\]/g)) {
    out[match[1]] = Array.from(match[2].matchAll(/'([^']+)'/g)).map((entry) => entry[1])
  }
  return out
}

/**
 * Converts a route file path (`quotes/[quoteId]/items/route.ts`) to a regex
 * matching the runner path the tool must produce (`/cpq/quotes/<id>/items`).
 */
export function routeFileToPathPattern(routeFile: string): RegExp {
  const dir = routeFile.replace(/\/?route\.ts$/, '')
  const pattern = dir
    .split('/')
    .map((segment) => (/^\[.+\]$/.test(segment) ? '[^/]+' : segment.replace(/[-.]/g, (c) => `\\${c}`)))
    .join('/')
  return new RegExp(`^/cpq/${pattern}$`)
}
