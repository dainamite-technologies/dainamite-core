#!/usr/bin/env node
// Renders a Jest run summary to $GITHUB_STEP_SUMMARY.
// Reads ./jest-results.json (--outputFile from yarn test). Tolerant to
// partial / malformed shapes — never throws, so it can't fail the CI step.

import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const REPORT = './jest-results.json'
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

const total = r?.numTotalTests ?? 0
const pass = r?.numPassedTests ?? 0
const fail = r?.numFailedTests ?? 0
const skip = r?.numPendingTests ?? 0

const failedNames = []
for (const suite of r?.testResults ?? []) {
  const fileName = String(suite?.name ?? '').split(/[\\/]/).slice(-2).join('/')
  for (const t of suite?.testResults ?? []) {
    if (t?.status === 'failed') {
      const fullName = String(t?.fullName ?? t?.title ?? 'unknown')
      failedNames.push(`${fileName} › ${fullName}`)
    }
  }
}

let md = '## Unit tests (Jest)\n\n'
md += '| | |\n|---|---:|\n'
md += `| ✅ Passed | ${pass} |\n`
md += `| ❌ Failed | ${fail} |\n`
md += `| ⏭️ Skipped | ${skip} |\n`
md += `| **Total** | **${total}** |\n`
if (failedNames.length) {
  md += `\n### Failed (${failedNames.length})\n\n`
  md += failedNames.slice(0, 30).map((n) => `- \`${n}\``).join('\n') + '\n'
  if (failedNames.length > 30) md += `\n_…and ${failedNames.length - 30} more_\n`
}

try {
  appendFileSync(OUT, md)
  console.log(`Wrote ${md.length} bytes to GITHUB_STEP_SUMMARY`)
} catch (err) {
  console.warn(`Failed to write summary: ${err.message}`)
}
