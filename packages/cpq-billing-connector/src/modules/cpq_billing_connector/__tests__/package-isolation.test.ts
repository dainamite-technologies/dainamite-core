/**
 * Package isolation guard for @dainamite/cpq-billing-connector.
 *
 * Mirrors the @dainamite/billing variant. Allowed import prefixes
 * include `@dainamite/billing/...` since the connector imports
 * billing's entity classes (BillingAccount, BillingItem) for
 * read-side lookups — peer-dep, declared in package.json, fine.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const PACKAGE_ROOT = path.resolve(__dirname, '..')

const ALLOWED_IMPORT_PREFIXES = [
  './',
  '../',
  '@open-mercato/',
  '@mikro-orm/',
  '@dainamite/',
  'awilix',
  'lucide-react',
  'next',
  'next/',
  'react',
  'react/',
  'react-dom',
  'react-dom/',
  'zod',
  'node:',
]

const NODE_BUILTINS = new Set([
  'crypto',
  'fs',
  'path',
  'os',
  'util',
  'stream',
  'buffer',
  'http',
  'https',
  'url',
  'querystring',
  'child_process',
  'zlib',
  'events',
  'assert',
])

const FORBIDDEN_PREFIXES = [
  '@/modules/',
  'src/modules/',
  '../../../../catalog/',
  '../../../../sales/',
  '../../../../customers/',
  '../../../../auth/',
  '../../../../directory/',
  '../../../../demo_',
  '../../../../portal/',
  '../../../../customer_accounts/',
  '../../../../example/',
]

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    if (entry.name === '__tests__' || entry.name === '__integration__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc)
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+(?:[^'"]+\s+from\s+)|import\s*\(\s*)["']([^"']+)["']/g

function extractImports(source: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = IMPORT_RE.exec(source)) !== null) {
    out.push(m[1])
  }
  return out
}

function isAllowedSpecifier(spec: string): boolean {
  if (NODE_BUILTINS.has(spec)) return true
  return ALLOWED_IMPORT_PREFIXES.some((p) => spec === p || spec.startsWith(p))
}

function isForbiddenSpecifier(spec: string): boolean {
  return FORBIDDEN_PREFIXES.some((p) => spec.startsWith(p))
}

describe('@dainamite/cpq-billing-connector package isolation', () => {
  let allFiles: string[] = []
  let importsByFile = new Map<string, string[]>()

  beforeAll(async () => {
    allFiles = await walk(PACKAGE_ROOT)
    importsByFile = new Map()
    for (const file of allFiles) {
      const source = await fs.readFile(file, 'utf-8')
      importsByFile.set(file, extractImports(source))
    }
  })

  it('metadata.requires lists cpq + billing (peer-dep modules)', () => {
    expect(metadata.requires).toEqual(
      expect.arrayContaining(['cpq', 'billing']),
    )
  })

  it('does not import from sibling app modules', () => {
    const violations: Array<{ file: string; spec: string }> = []
    for (const [file, specs] of importsByFile) {
      for (const spec of specs) {
        if (isForbiddenSpecifier(spec)) {
          violations.push({ file: path.relative(PACKAGE_ROOT, file), spec })
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Forbidden cross-module imports:\n${violations
          .map((v) => `  ${v.file} → ${v.spec}`)
          .join('\n')}`,
      )
    }
  })

  it('only uses allowed import prefixes', () => {
    const violations: Array<{ file: string; spec: string }> = []
    for (const [file, specs] of importsByFile) {
      for (const spec of specs) {
        if (!isAllowedSpecifier(spec)) {
          violations.push({ file: path.relative(PACKAGE_ROOT, file), spec })
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Imports outside the allowed prefix set:\n${violations
          .map((v) => `  ${v.file} → ${v.spec}`)
          .join('\n')}`,
      )
    }
  })

  it('contains no ORM relations (FK string only, peer-dep contract)', async () => {
    const relRe = /@(ManyToOne|OneToMany|ManyToMany|OneToOne)\s*\(/g
    const violations: Array<{ file: string; line: number }> = []
    for (const file of allFiles) {
      const source = await fs.readFile(file, 'utf-8')
      const lines = source.split('\n')
      lines.forEach((line, idx) => {
        if (line.match(relRe)) {
          violations.push({ file: path.relative(PACKAGE_ROOT, file), line: idx + 1 })
        }
      })
    }
    if (violations.length > 0) {
      throw new Error(
        `Cross-entity ORM relations forbidden in connector:\n${violations
          .map((v) => `  ${v.file}:${v.line}`)
          .join('\n')}`,
      )
    }
  })

  it('module index.ts loads without throwing', async () => {
    const mod = await import('../index')
    expect(mod.metadata).toBeDefined()
    expect(mod.metadata.name).toBe('cpq_billing_connector')
    expect(mod.features).toBeDefined()
  })
})
