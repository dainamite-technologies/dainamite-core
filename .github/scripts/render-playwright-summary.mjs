#!/usr/bin/env node
// Renders a Playwright run summary to $GITHUB_STEP_SUMMARY.
// Reads .ai/qa/test-results/results.json. Tolerant to partial shapes.

import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const REPORT = '.ai/qa/test-results/results.json'
const OUT = process.env.GITHUB_STEP_SUMMARY

if (!OUT) {
  console.warn('GITHUB_STEP_SUMMARY not set — nothing to render to')
  process.exit(0)
}

if (!existsSync(REPORT)) {
  console.warn(`${REPORT} not found — skipping summary`)
  process.exit(0)
}

let r
try {
  r = JSON.parse(readFileSync(REPORT, 'utf8'))
} catch (err) {
  console.warn(`Failed to parse ${REPORT}: ${err.message}`)
  process.exit(0)
}

let pass = 0
let fail = 0
let skip = 0
const failedTitles = []

const walk = (suite) => {
  for (const sub of suite?.suites ?? []) walk(sub)
  for (const spec of suite?.specs ?? []) {
    const file = String(spec?.file ?? '').split(/[\\/]/).slice(-1)[0]
    for (const t of spec?.tests ?? []) {
      const final = (t?.results ?? []).slice(-1)[0]
      if (!final) continue
      const status = String(final?.status ?? '')
      if (status === 'passed') pass++
      else if (status === 'skipped' || status === 'interrupted') skip++
      else {
        fail++
        failedTitles.push(`${file} › ${spec?.title ?? 'unknown'}`)
      }
    }
  }
}
for (const top of r?.suites ?? []) walk(top)

const total = pass + fail + skip

let md = '## Integration tests (Playwright)\n\n'
md += '| | |\n|---|---:|\n'
md += `| ✅ Passed | ${pass} |\n`
md += `| ❌ Failed | ${fail} |\n`
md += `| ⏭️ Skipped | ${skip} |\n`
md += `| **Total** | **${total}** |\n`
if (failedTitles.length) {
  const unique = [...new Set(failedTitles)]
  md += `\n### Failed (${unique.length})\n\n`
  md += unique.slice(0, 30).map((n) => `- \`${n}\``).join('\n') + '\n'
  if (unique.length > 30) md += `\n_…and more_\n`
}

try {
  appendFileSync(OUT, md)
  console.log(`Wrote ${md.length} bytes to GITHUB_STEP_SUMMARY`)
} catch (err) {
  console.warn(`Failed to write summary: ${err.message}`)
}
