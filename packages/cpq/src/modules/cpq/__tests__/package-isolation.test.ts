/**
 * Package isolation guard for @dainamite/cpq.
 *
 * Proves the package can be loaded and described without any sibling
 * `src/modules/<x>` modules being present. Catches three classes of leak:
 *
 *   1. import paths that escape the package boundary (relative `../../../../<other>`,
 *      absolute `@/modules/<other>`, deep `src/modules/<other>`)
 *   2. deep imports into `@open-mercato/core/modules/<x>` for modules that aren't
 *      declared in `metadata.requires`
 *   3. side-effect-only imports that pull in non-CPQ entities at module load time
 *
 * These checks are static (read package source) — no DI bootstrap is
 * attempted, so the test is fast and runs in plain Node + jest.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Must mirror peerDependencies in packages/cpq/package.json (plus relatives + node builtins).
// Adding a prefix here without adding it to peerDependencies = silent runtime failure for
// consumers that don't happen to have the dep transitively.
const ALLOWED_IMPORT_PREFIXES = [
  './',
  '../',
  '@open-mercato/',
  '@mikro-orm/',
  'awilix',
  'bcryptjs',
  'lucide-react',
  'next',
  'next/',
  'react',
  'react/',
  'react-dom',
  'react-dom/',
  'zod',
  '@dainamite/',
  'node:',
  // UI table primitive — listed across @tanstack so future submodules
  // (e.g. @tanstack/react-virtual) also pass without revisits.
  '@tanstack/',
  // Excel import/export on the pricing-tables detail page.
  'xlsx',
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
  '../../../../dictionaries/',
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

function extractCoreModuleSubpath(spec: string): string | null {
  const prefix = '@open-mercato/core/modules/'
  if (!spec.startsWith(prefix)) return null
  const rest = spec.slice(prefix.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? rest : rest.slice(0, slash)
}

describe('@dainamite/cpq package isolation', () => {
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

  it('declares all required modules in metadata.requires', () => {
    expect(metadata.requires).toEqual(
      expect.arrayContaining(['auth', 'directory', 'catalog', 'sales', 'customers', 'dictionaries']),
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
        `Forbidden cross-module imports found:\n${violations
          .map((v) => `  ${v.file} → ${v.spec}`)
          .join('\n')}`,
      )
    }
  })

  it('only uses allowed import prefixes (no surprise package leaks)', () => {
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
          .join('\n')}\n` +
          `If a new prefix is legitimate, add it to ALLOWED_IMPORT_PREFIXES in this test.`,
      )
    }
  })

  it('only deep-imports from core modules declared in metadata.requires', () => {
    const declared = new Set<string>(metadata.requires ?? [])
    const violations: Array<{ file: string; spec: string; module: string }> = []
    for (const [file, specs] of importsByFile) {
      for (const spec of specs) {
        const subModule = extractCoreModuleSubpath(spec)
        if (subModule && !declared.has(subModule)) {
          violations.push({ file: path.relative(PACKAGE_ROOT, file), spec, module: subModule })
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Deep imports into @open-mercato/core/modules/<x> for modules not in metadata.requires:\n${violations
          .map((v) => `  ${v.file} → ${v.spec} (add '${v.module}' to requires)`)
          .join('\n')}`,
      )
    }
  })

  it('contains no @ManyToOne / @OneToMany / @ManyToMany / @OneToOne ORM relations', async () => {
    const relRe = /@(ManyToOne|OneToMany|ManyToMany|OneToOne)\s*\(/g
    const violations: Array<{ file: string; line: number; match: string }> = []
    for (const file of allFiles) {
      const source = await fs.readFile(file, 'utf-8')
      const lines = source.split('\n')
      lines.forEach((line, idx) => {
        const m = line.match(relRe)
        if (m) {
          violations.push({ file: path.relative(PACKAGE_ROOT, file), line: idx + 1, match: m.join(', ') })
        }
      })
    }
    if (violations.length > 0) {
      throw new Error(
        `Cross-entity ORM relations forbidden in @dainamite/cpq (use FK string columns):\n${violations
          .map((v) => `  ${v.file}:${v.line} — ${v.match}`)
          .join('\n')}`,
      )
    }
  })

  it('module index.ts loads without throwing', async () => {
    const mod = await import('../index')
    expect(mod.metadata).toBeDefined()
    expect(mod.metadata.name).toBe('cpq')
    expect(mod.features).toBeDefined()
    expect(Array.isArray(mod.features)).toBe(true)
  })
})
