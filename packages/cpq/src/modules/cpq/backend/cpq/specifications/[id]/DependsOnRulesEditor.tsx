"use client"
import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { DependsOnEffect, DependsOnRule } from './page'

// ─── Helpers ─────────────────────────────────────────────────────

type AttributeOption = { value: string; label: string }

function thenInitialFor(effect: DependsOnEffect): unknown {
  switch (effect) {
    case 'filter_options':
      return [] as string[]
    case 'set_value':
      return ''
    case 'toggle_required':
      return false
  }
}

function thenAsCsv(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'string') return value
  return ''
}

function csvAsArray(input: string): string[] {
  return input
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

// ─── Component ───────────────────────────────────────────────────

export type DependsOnRulesEditorProps = {
  effect: DependsOnEffect
  rules: DependsOnRule[]
  onChange: (rules: DependsOnRule[]) => void
  /** Options of the parent attribute (used as "When" dropdown if available). */
  parentOptions?: AttributeOption[] | null
  /**
   * Options of the **child** (= this attribute being edited). Only used by
   * `filter_options` so the "then" picker offers checkboxes instead of CSV.
   */
  childOptions?: AttributeOption[] | null
}

/**
 * Renders the rule rows for an attribute dependency. The shape of each
 * rule's `then` field depends on the effect type — see `page.tsx`
 * `DependsOnRule` doc for the full contract.
 *
 * Each effect type has tailored input affordances:
 *   - `filter_options`: child options shown as checkboxes (or CSV input if
 *     the child has no enumerated options).
 *   - `set_value`: free-text value input.
 *   - `toggle_required`: required on/off checkbox.
 */
export function DependsOnRulesEditor({
  effect,
  rules,
  onChange,
  parentOptions,
  childOptions,
}: DependsOnRulesEditorProps) {
  const updateRule = (index: number, patch: Partial<DependsOnRule>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onChange(next)
  }

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }

  const addRule = () => {
    onChange([...rules, { when: '', then: thenInitialFor(effect) }])
  }

  if (rules.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No rules yet. Add at least one to make this dependency effective.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addRule}>
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {rules.map((rule, idx) => (
          <RuleRow
            key={idx}
            effect={effect}
            rule={rule}
            parentOptions={parentOptions}
            childOptions={childOptions}
            onWhenChange={(when) => updateRule(idx, { when })}
            onThenChange={(then) => updateRule(idx, { then })}
            onRemove={() => removeRule(idx)}
          />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        <Plus className="h-3.5 w-3.5" />
        Add rule
      </Button>
    </div>
  )
}

// ─── Single rule row (decomposed for readability) ────────────────

type RuleRowProps = {
  effect: DependsOnEffect
  rule: DependsOnRule
  parentOptions?: AttributeOption[] | null
  childOptions?: AttributeOption[] | null
  onWhenChange: (when: string) => void
  onThenChange: (then: unknown) => void
  onRemove: () => void
}

function RuleRow({
  effect,
  rule,
  parentOptions,
  childOptions,
  onWhenChange,
  onThenChange,
  onRemove,
}: RuleRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2 rounded-md border bg-muted/20 p-2">
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          When parent =
        </label>
        {parentOptions && parentOptions.length > 0 ? (
          <select
            value={rule.when}
            onChange={(e) => onWhenChange(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— Select value —</option>
            {parentOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={rule.when}
            onChange={(e) => onWhenChange(e.target.value)}
            placeholder="Parent value"
          />
        )}
      </div>
      <div className="mt-5 self-center text-muted-foreground">→</div>
      <ThenInput
        effect={effect}
        value={rule.then}
        childOptions={childOptions}
        onChange={onThenChange}
      />
      <button
        type="button"
        onClick={onRemove}
        className="mt-5 self-start rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Remove rule"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Effect-specific "then" inputs ───────────────────────────────

type ThenInputProps = {
  effect: DependsOnEffect
  value: unknown
  childOptions?: AttributeOption[] | null
  onChange: (next: unknown) => void
}

function ThenInput({ effect, value, childOptions, onChange }: ThenInputProps) {
  if (effect === 'toggle_required') {
    const isRequired = value === true
    return (
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          Then required is
        </label>
        <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm cursor-pointer">
          <Checkbox
            checked={isRequired}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <span>{isRequired ? 'Required' : 'Optional'}</span>
        </label>
      </div>
    )
  }

  if (effect === 'set_value') {
    return (
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          Then set value to
        </label>
        {childOptions && childOptions.length > 0 ? (
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— Select value —</option>
            {childOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Value"
          />
        )}
      </div>
    )
  }

  // effect === 'filter_options'
  const selected = Array.isArray(value) ? (value as string[]) : []
  if (childOptions && childOptions.length > 0) {
    const toggle = (optValue: string) => {
      onChange(
        selected.includes(optValue)
          ? selected.filter((v) => v !== optValue)
          : [...selected, optValue],
      )
    }
    return (
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          Then allow only
        </label>
        <div className="flex flex-wrap gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm min-h-[34px]">
          {childOptions.map((opt) => {
            const isOn = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="cursor-pointer"
              >
                <Tag
                  variant={isOn ? 'success' : 'neutral'}
                  dot={isOn}
                  className="px-2 text-xs"
                >
                  {opt.label}
                </Tag>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // No enumerated child options — fall back to CSV.
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
        Then allow only (comma-separated)
      </label>
      <Input
        value={thenAsCsv(value)}
        onChange={(e) => onChange(csvAsArray(e.target.value))}
        placeholder="value1, value2, value3"
      />
    </div>
  )
}
