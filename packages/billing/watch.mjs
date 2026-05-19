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

function buildRewriteImportsPlugin() {
  return {
    name: 'add-js-extension',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          console.error(`[billing:watch] Build failed with ${result.errors.length} error(s)`)
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
        console.log(`[billing:watch] Rebuilt ${outputFiles.length} files at ${new Date().toLocaleTimeString()}`)
      })
    },
  }
}

let currentContext = null

async function createContext() {
  const entryPoints = await listEntryPoints()
  if (entryPoints.length === 0) {
    console.error('[billing:watch] No source entry points found!')
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
      console.error('[billing:watch] Failed to dispose previous context:', err?.message ?? err)
    }
  }
  console.log(`[billing:watch] ${reason} — restarting esbuild context`)
  const { ctx, entryPointCount } = await createContext()
  currentContext = ctx
  await ctx.rebuild()
  await ctx.watch()
  console.log(`[billing:watch] Tracking ${entryPointCount} entry points`)
}

console.log(`[billing:watch] Starting watcher`)
const initial = await createContext()
currentContext = initial.ctx
console.log(`[billing:watch] Found ${initial.entryPointCount} source entry points`)

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

await initial.ctx.rebuild()
console.log('[billing:watch] READY')

await initial.ctx.watch()
console.log('[billing:watch] Watching for changes — Ctrl+C to stop')

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
    if (!stats) return false
    if (stats.isDirectory()) return false
    return !isRelevantSourceFile(path)
  },
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
})

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
