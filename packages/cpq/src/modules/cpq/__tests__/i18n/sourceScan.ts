import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

/**
 * Static source scans backing the CPQ i18n guardrails
 * (spec .ai/specs/2026-11-15-cpq-multi-language.md):
 *
 *   - `collectTranslationKeys` — every literal `t('cpq.…')` key and every
 *     template-literal key prefix (`t(\`cpq.x.${v}\`)`) used in source;
 *   - `collectHardcodedStrings` — user-facing English literals that bypass
 *     `t()`: JSX text, string-valued UI attributes, and `label` / `title` /
 *     `header` / `placeholder` / `description` properties in UI files.
 */

export const MODULE_ROOT = join(__dirname, '..', '..')
const SKIP_DIRS = new Set(['__tests__', '__integration__', 'migrations', 'i18n', 'node_modules'])
/** Directories whose files render UI. */
export const UI_DIRS = ['backend', 'components', 'widgets', 'workflows']

export function listSourceFiles(dir: string, exts = /\.(tsx?|mts)$/): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...listSourceFiles(full, exts))
    } else if (exts.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

const TRANSLATE_CALLEES = new Set(['t', 'translate', 'tr'])

export function collectTranslationKeys(files: string[]): { keys: Set<string>; prefixes: Set<string> } {
  const keys = new Set<string>()
  const prefixes = new Set<string>()
  for (const file of files) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRANSLATE_CALLEES.has(node.expression.text)) {
        const first = node.arguments[0]
        const key = literalText(first)
        if (key?.startsWith('cpq.')) keys.add(key)
        if (first && ts.isTemplateExpression(first) && first.head.text.startsWith('cpq.')) prefixes.add(first.head.text)
      }
      // `*Key` props (page meta, breadcrumbs) and injection-table `groupLabel`s the host translates.
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && /(Key|^groupLabel)$/.test(node.name.text)) {
        const key = literalText(node.initializer)
        if (key?.startsWith('cpq.')) keys.add(key)
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(file))
  }
  return { keys, prefixes }
}

const UI_ATTRIBUTES = new Set(['label', 'placeholder', 'title', 'aria-label', 'description', 'emptyLabel', 'emptyMessage', 'alt'])
const UI_PROPERTIES = new Set(['label', 'title', 'header', 'placeholder', 'description', 'emptyLabel', 'emptyMessage'])
/** Natural-language text: two letters in a row, not a code-ish token (snake_case, dotted, kebab, path, CSS). */
function isProse(text: string): boolean {
  const value = text.trim()
  if (!/[A-Za-z]{2}/.test(value)) return false
  if (/^[a-z0-9]+([._/-][a-z0-9]+)+$/i.test(value) && !/\s/.test(value)) return false
  return true
}

export type HardcodedHit = { file: string; line: number; text: string }

export function collectHardcodedStrings(files: string[]): HardcodedHit[] {
  const hits: HardcodedHit[] = []
  for (const file of files) {
    const sf = parse(file)
    const rel = relative(MODULE_ROOT, file)
    const hit = (node: ts.Node, text: string) =>
      hits.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim().slice(0, 80) })
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && isProse(node.text)) hit(node, node.text)
      if (ts.isJsxAttribute(node) && UI_ATTRIBUTES.has(node.name.getText())) {
        const init = node.initializer
        const text = init && ts.isStringLiteral(init) ? init.text : init && ts.isJsxExpression(init) ? literalText(init.expression) : null
        if (text && isProse(text)) hit(node, text)
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && UI_PROPERTIES.has(node.name.text)) {
        const text = literalText(node.initializer)
        // `{ label: 'X', labelKey: 'cpq.x' }` (page meta, breadcrumbs) is translated by the host.
        const parent = node.parent
        const hasKeySibling =
          ts.isObjectLiteralExpression(parent) &&
          parent.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === `${node.name.getText()}Key`)
        if (text && isProse(text) && !hasKeySibling) hit(node, text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return hits
}
