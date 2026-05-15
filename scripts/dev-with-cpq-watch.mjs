// Wrapper around scripts/dev.mjs that also spawns `@dainamite/cpq` esbuild watch
// so edits in `packages/cpq/src/` rebuild `packages/cpq/dist/` live without the
// developer having to `yarn workspace @dainamite/cpq build` after each change.
//
// Flow:
//   1. Spawn `packages/cpq/watch.mjs` and tee its stdout to a log file.
//   2. Wait for `[cpq:watch] READY` (blocking initial build finished).
//   3. Spawn the original `scripts/dev.mjs` with stdio inherit so the splash
//      UI is unaffected. Subsequent watch logs go only to the log file.
//
// This ordering matters: if `next dev` starts BEFORE the first esbuild build
// completes, Turbopack can compile while `dist/` is still being written and
// permanently cache "module not found" entries — every /backend/* route
// then 404s until cache is cleared.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(__dirname)
const logDir = join(repoRoot, '.mercato')
fs.mkdirSync(logDir, { recursive: true })
const watchLogPath = join(logDir, 'cpq-watch.log')
const watchLogStream = fs.createWriteStream(watchLogPath, { flags: 'a' })
watchLogStream.write(`\n=== ${new Date().toISOString()} dev-with-cpq-watch starting ===\n`)

const watchScript = join(repoRoot, 'packages', 'cpq', 'watch.mjs')

const watcher = spawn(process.execPath, [watchScript], {
  cwd: repoRoot,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let shuttingDown = false
let dev = null

const cleanup = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  try {
    watcher.kill('SIGTERM')
  } catch {}
  if (dev) {
    try {
      dev.kill('SIGTERM')
    } catch {}
  }
  try {
    watchLogStream.end()
  } catch {}
  process.exit(code)
}

process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))
process.on('SIGHUP', () => cleanup(0))

watcher.on('exit', (code, signal) => {
  if (code !== 0 && code !== null && !shuttingDown) {
    process.stderr.write(`[cpq:watch] exited with code ${code}${signal ? ` (signal ${signal})` : ''}\n`)
    cleanup(code ?? 1)
  }
})

watcher.stderr?.on('data', (chunk) => {
  process.stderr.write(`[cpq:watch] ${chunk}`)
  watchLogStream.write(chunk)
})

// Wait for the watcher's first build to finish before starting `next dev`.
let ready = false
const readyTimeoutMs = 60_000
const readyTimer = setTimeout(() => {
  if (!ready) {
    process.stderr.write(`[cpq:watch] did not become READY within ${readyTimeoutMs / 1000}s — starting dev anyway\n`)
    startDev()
  }
}, readyTimeoutMs)

watcher.stdout?.on('data', (chunk) => {
  watchLogStream.write(chunk)
  const text = chunk.toString()
  if (!ready && text.includes('[cpq:watch] READY')) {
    ready = true
    clearTimeout(readyTimer)
    process.stdout.write('[cpq:watch] initial build complete, starting app\n')
    startDev()
  }
})

function startDev() {
  if (dev) return
  const devScript = join(__dirname, 'dev.mjs')
  dev = spawn(process.execPath, [devScript, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  dev.on('exit', (code) => cleanup(code ?? 0))
}
