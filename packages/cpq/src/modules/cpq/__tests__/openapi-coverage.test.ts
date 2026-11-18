/**
 * OpenAPI coverage guard for CPQ API routes.
 *
 * Every `api/**\/route.ts` MUST export `openApi` in the typed
 * `OpenApiRouteDoc` form (`{ methods: { GET: ... } }`). The Open Mercato
 * generator reads `routeDoc.methods[method]` and takes the path from the file
 * location, so a raw OpenAPI object keyed by '/api/...' is silently ignored:
 * the endpoint then shows up without params or bodies in the generated spec
 * and in the AI assistant's MCP endpoint search.
 *
 * Static check (reads source), no module loading.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const API_ROOT = path.resolve(__dirname, '..', 'api')

async function findRouteFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__integration__') return []
        return findRouteFiles(full)
      }
      return entry.name === 'route.ts' ? [full] : []
    }),
  )
  return nested.flat()
}

/** Source text of the `export const openApi ...` declaration up to the end of the file. */
function openApiDeclaration(source: string): string | null {
  const match = /export const openApi\b[^=]*=/.exec(source)
  return match ? source.slice(match.index) : null
}

describe('CPQ API routes openApi coverage', () => {
  let routeFiles: string[] = []

  beforeAll(async () => {
    routeFiles = (await findRouteFiles(API_ROOT)).sort()
  })

  it('finds CPQ route files', () => {
    expect(routeFiles.length).toBeGreaterThan(0)
  })

  it('every route exports a typed openApi doc with a methods map', async () => {
    const problems: string[] = []
    for (const file of routeFiles) {
      const rel = path.relative(API_ROOT, file)
      const source = await fs.readFile(file, 'utf8')
      const decl = openApiDeclaration(source)
      if (!decl) {
        problems.push(`${rel}: missing \`export const openApi\``)
        continue
      }
      if (!/^export const openApi\s*:\s*OpenApiRouteDoc\s*=/.test(decl)) {
        problems.push(`${rel}: openApi must be typed as OpenApiRouteDoc`)
      }
      if (!/\bmethods\s*:/.test(decl)) {
        problems.push(`${rel}: openApi has no \`methods\` key`)
      }
      if (/^\s*['"]\/api\//m.test(decl)) {
        problems.push(`${rel}: openApi is keyed by an '/api/...' path; use { methods: { ... } }`)
      }
    }
    expect(problems).toEqual([])
  })
})
