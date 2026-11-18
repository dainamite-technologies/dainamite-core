/**
 * Every feature the CPQ module grants (setup.ts defaultRoleFeatures) or
 * requires (`requireFeatures` in api/ and backend/ metadata) must be declared
 * in acl.ts. An undeclared feature cannot be assigned to a role in the RBAC
 * UI, and a route guarded by one is reachable only through the seeded roles.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import features from '../acl'
import setup from '../setup'

const MODULE_ROOT = path.resolve(__dirname, '..')
const SCANNED_DIRS = ['api', 'backend']

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(full)
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
    }),
  )
  return files.flat()
}

function extractRequiredFeatures(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/requireFeatures:\s*\[([^\]]*)\]/g)) {
    for (const id of match[1].matchAll(/'([^']+)'/g)) found.push(id[1])
  }
  return found
}

const declared = new Set(features.map((feature) => feature.id))

function isCovered(id: string): boolean {
  if (declared.has(id)) return true
  // A wildcard grant such as `cpq.*` is valid when it covers a declared feature.
  if (id.endsWith('.*')) {
    const prefix = id.slice(0, -1)
    return [...declared].some((feature) => feature.startsWith(prefix))
  }
  return false
}

describe('cpq acl consistency', () => {
  it('declares every feature granted in setup.ts', () => {
    const granted = Object.values(setup.defaultRoleFeatures ?? {}).flat() as string[]
    const cpqGranted = granted.filter((id) => id.startsWith('cpq.'))
    expect(cpqGranted.length).toBeGreaterThan(0)
    expect(cpqGranted.filter((id) => !isCovered(id))).toEqual([])
  })

  it('declares every feature required by api and backend metadata', async () => {
    const files = (
      await Promise.all(SCANNED_DIRS.map((dir) => listSourceFiles(path.join(MODULE_ROOT, dir))))
    ).flat()
    const missing: string[] = []
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      for (const id of extractRequiredFeatures(source)) {
        if (id.startsWith('cpq.') && !isCovered(id)) {
          missing.push(`${path.relative(MODULE_ROOT, file)}: ${id}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
