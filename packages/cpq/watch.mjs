import * as esbuild from 'esbuild'
import { glob } from 'glob'
import chokidar from 'chokidar'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outdir = join(__dirname, 'dist')

// Do NOT clear dist on start — incremental rebuilds in place.
// (build.mjs wipes dist for clean publish artifacts; watch.mjs must not,
// otherwise the parallel `next dev` momentarily sees missing module files
// during initial compile, which Turbopack can cache as "module not found".)
mkdirSync(outdir, { recursive: true })

const SRC_GLOB_PATTERN = 'src/**/*.{ts,tsx}'
const SRC_IGNORE_PATTERNS = [
  '**/__tests__/**',
  '**/__integration__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
]

async function listEntryPoints() {
  return glob(SRC_GLOB_PATTERN, {
    cwd: __dirname,
    ignore: SRC_IGNORE_PATTERNS,
    absolute: true,
  })
}

// ─── Post-build plugin: rewrite relative imports to `.js` ────────
//
// esbuild emits ESM with bare relative specifiers (`./foo`), but Node ESM
// runtime needs explicit extensions (`./foo.js`). This plugin sweeps every
// emitted file once a build completes and rewrites the imports. The same
// logic lives in `build.mjs` — kept duplicated on purpose so changing one
// doesn't accidentally break the other.

function buildRewriteImportsPlugin() {
  return {
    name: 'add-js-extension',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          console.error(`[cpq:watch] Build failed with ${result.errors.length} error(s)`)
          return
        }
        const outputFiles = await glob('dist/**/*.js', { cwd: __dirname, absolute: true })
        for (const file of outputFiles) {
          const fileDir = dirname(file)
          let content = readFileSync(file, 'utf-8')

          content = content.replace(
            /from\s+["'](\.[^"']+)["']/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json')) return match
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `from "${path}/index.js"`
              }
              return `from "${path}.js"`
            },
          )
          content = content.replace(
            /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json')) return match
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `import("${path}/index.js")`
              }
              return `import("${path}.js")`
            },
          )
          content = content.replace(
            /import\s+["'](\.[^"']+)["'];/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json')) return match
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `import "${path}/index.js";`
              }
              return `import "${path}.js";`
            },
          )
          writeFileSync(file, content)
        }
        console.log(`[cpq:watch] Rebuilt ${outputFiles.length} files at ${new Date().toLocaleTimeString()}`)
      })
    },
  }
}

// ─── esbuild context lifecycle ───────────────────────────────────
//
// esbuild's `ctx.watch()` only watches the import graph reachable from the
// entry points captured at context creation. New top-level files (a new
// migration, a new component) won't be picked up because they aren't in
// any entry point's graph yet. We solve that by treating `add` / `unlink`
// events from chokidar as triggers to dispose the current context and
// rebuild it with a fresh entry-point list.

let currentContext = null

async function createContext() {
  const entryPoints = await listEntryPoints()
  if (entryPoints.length === 0) {
    console.error('[cpq:watch] No source entry points found!')
    process.exit(1)
  }
  const ctx = await esbuild.context({
    entryPoints,
    outdir,
    outbase: join(__dirname, 'src'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    jsx: 'automatic',
    plugins: [buildRewriteImportsPlugin()],
  })
  return { ctx, entryPointCount: entryPoints.length }
}

async function rebootContext(reason) {
  if (currentContext) {
    try {
      await currentContext.dispose()
    } catch (err) {
      console.error('[cpq:watch] Failed to dispose previous context:', err?.message ?? err)
    }
  }
  console.log(`[cpq:watch] ${reason} — restarting esbuild context`)
  const { ctx, entryPointCount } = await createContext()
  currentContext = ctx
  // Blocking initial rebuild so dist/ is fully populated before we let
  // watch() take over — same reason as the very first build below.
  await ctx.rebuild()
  await ctx.watch()
  console.log(`[cpq:watch] Tracking ${entryPointCount} entry points`)
}

// ─── Initial build ───────────────────────────────────────────────

console.log(`[cpq:watch] Starting watcher`)
const initial = await createContext()
currentContext = initial.ctx
console.log(`[cpq:watch] Found ${initial.entryPointCount} source entry points`)

// Copy JSON files once at startup (esbuild won't watch them anyway).
const jsonFiles = await glob('src/**/*.json', {
  cwd: __dirname,
  ignore: ['**/node_modules/**'],
  absolute: true,
})
for (const jsonFile of jsonFiles) {
  const relativePath = relative(join(__dirname, 'src'), jsonFile)
  const destPath = join(outdir, relativePath)
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(jsonFile, destPath)
}

// Blocking initial build so dist/ is fully populated before the wrapper
// spawns `next dev`. Otherwise Turbopack can compile while dist/ is still
// being written and cache "module not found" entries.
await initial.ctx.rebuild()
console.log('[cpq:watch] READY')

await initial.ctx.watch()
console.log('[cpq:watch] Watching for changes — Ctrl+C to stop')

// ─── Chokidar: detect added / removed files ──────────────────────
//
// esbuild watch handles modifications to files already in the import
// graph. Chokidar fills the gap for `add` and `unlink` — those events
// require a fresh entry-point list, so we reboot the esbuild context.
//
// `ignoreInitial: true` is critical: without it, chokidar fires `add` for
// every existing file on startup and we'd reboot the context dozens of
// times before any real work happens.

// chokidar v4 dropped glob support — pass the src/ directory directly and
// filter in handlers. The `ignored` predicate filters out non-source files
// (dist, dotfiles, tests, JSON, etc.) so we don't reboot on irrelevant changes.
const isRelevantSourceFile = (path) => {
  if (!path) return false
  if (!/\.(ts|tsx)$/.test(path)) return false
  if (/[\\/]__tests__[\\/]/.test(path)) return false
  if (/[\\/]__integration__[\\/]/.test(path)) return false
  if (/\.(test|spec)\.tsx?$/.test(path)) return false
  return true
}

const fsWatcher = chokidar.watch(join(__dirname, 'src'), {
  ignored: (path, stats) => {
    if (!stats) return false // unknown — let chokidar inspect
    if (stats.isDirectory()) return false
    return !isRelevantSourceFile(path)
  },
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
})

// Debounce reboots: many editors emit several `add` events in quick
// succession when generating files (think `mercato db generate` writing
// migration + snapshot). One reboot per burst is enough.
let rebootTimer = null
function scheduleReboot(reason) {
  if (rebootTimer) clearTimeout(rebootTimer)
  rebootTimer = setTimeout(() => {
    rebootTimer = null
    void rebootContext(reason)
  }, 200)
}

fsWatcher.on('add', (path) => {
  scheduleReboot(`New file detected: ${path}`)
})

fsWatcher.on('unlink', (path) => {
  // Remove the stale `.js` + `.js.map` so stale modules don't linger in dist.
  const rel = path
  const distJs = join(outdir, rel.replace(/\.tsx?$/, '.js'))
  const distMap = `${distJs}.map`
  for (const p of [distJs, distMap]) {
    if (existsSync(p)) {
      try {
        rmSync(p)
      } catch {
        // ignore — best effort
      }
    }
  }
  scheduleReboot(`File removed: ${path}`)
})

// ─── Clean shutdown ──────────────────────────────────────────────

const shutdown = async () => {
  try {
    await fsWatcher.close()
  } catch {}
  if (currentContext) {
    try {
      await currentContext.dispose()
    } catch {}
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)
