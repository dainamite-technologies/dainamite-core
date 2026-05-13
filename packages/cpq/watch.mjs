import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outdir = join(__dirname, 'dist')

// Do NOT clear dist on start — incremental rebuilds in place.
// (build.mjs wipes dist for clean publish artifacts; watch.mjs must not,
// otherwise the parallel `next dev` momentarily sees missing module files
// during initial compile, which Turbopack can cache as "module not found".)
mkdirSync(outdir, { recursive: true })

const srcEntryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  ignore: [
    '**/__tests__/**',
    '**/__integration__/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],
  absolute: true,
})

if (srcEntryPoints.length === 0) {
  console.error('No source entry points found!')
  process.exit(1)
}

console.log(`[cpq:watch] Found ${srcEntryPoints.length} source entry points`)

const addJsExtension = {
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

const ctx = await esbuild.context({
  entryPoints: srcEntryPoints,
  outdir,
  outbase: join(__dirname, 'src'),
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Copy JSON files once at startup (esbuild won't watch them anyway)
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
await ctx.rebuild()
console.log('[cpq:watch] READY')

await ctx.watch()
console.log('[cpq:watch] Watching for changes — Ctrl+C to stop')
