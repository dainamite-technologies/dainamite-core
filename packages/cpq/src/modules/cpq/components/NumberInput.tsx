"use client"
import * as React from 'react'
import { Input, type InputProps } from '@open-mercato/ui/primitives/input'

// ─── Why this exists ─────────────────────────────────────────────
//
// Plain `<input type="number" value={state}>` is hostile when `state === 0`:
// the field renders "0", the caret lands AFTER it, and typing "5" produces
// "05" which most browsers normalise back to `5` — the user typed five but
// the field swallowed the digit they wanted to keep. Same trap when editing
// any single-digit existing value.
//
// NumberInput fixes this with two layered behaviours:
//
//   1. **Select on focus.** Tabbing or clicking into the field selects the
//      whole text, so the next keystroke replaces the existing value
//      instead of prepending to it. This single change removes ~95 % of the
//      friction without changing the controlled-component contract.
//
//   2. **Internal string state.** The input is rendered with a string we
//      own, not `String(numericState)`. That lets intermediate edits like
//      `"-"`, `"1."`, or empty stay visible while the parent only ever sees
//      a parsed `number | null`. Parent updates (programmatic reset after
//      save, form initial load) still flow in via the effect below.
//
// It also drops `type="number"` in favour of `type="text"` +
// `inputMode={'numeric' | 'decimal'}` so we get the right mobile keyboard
// without the spinner buttons and the silent step/min/max coercion that
// HTML number inputs apply on blur.

export type NumberInputProps = Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'inputMode' | 'defaultValue'
> & {
  /**
   * Numeric value. `null`/`undefined` renders the field empty — that's how
   * callers signal "no value yet" without colliding with `0` as a real
   * default.
   */
  value: number | null | undefined
  /** Called with the parsed number, or `null` when the field is cleared. */
  onChange: (value: number | null) => void
  /** Selects the input contents on focus. Default true. */
  selectOnFocus?: boolean
  /** Restrict input to integers (rejects `.`, `e`, etc). Default false. */
  integer?: boolean
  /** Optional minimum (enforced on commit, not while typing). */
  min?: number
  /** Optional maximum (enforced on commit, not while typing). */
  max?: number
}

function isIntermediateInput(raw: string, integer: boolean): boolean {
  // Allow the user to type these without us replacing the field mid-edit.
  // - empty / lone `-`           → not parseable yet
  // - trailing `.` for decimals  → not parseable yet
  // - trailing `e` / `e-`        → scientific notation in progress
  if (raw === '' || raw === '-') return true
  if (!integer && (raw.endsWith('.') || raw.endsWith('e') || raw.endsWith('e-'))) return true
  return false
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      onChange,
      selectOnFocus = true,
      integer = false,
      min,
      max,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const [text, setText] = React.useState<string>(value == null ? '' : String(value))
    const lastEmittedRef = React.useRef<number | null | undefined>(value)

    // Sync external updates (form reset after save, initial load, etc.) into
    // the local text state — but only when the parent's value actually
    // diverges from what we last emitted, so we don't clobber intermediate
    // text like "1." while the user is mid-edit.
    React.useEffect(() => {
      if (lastEmittedRef.current === value) return
      setText(value == null ? '' : String(value))
      lastEmittedRef.current = value
    }, [value])

    const clamp = React.useCallback(
      (n: number): number => {
        let result = n
        if (typeof min === 'number' && result < min) result = min
        if (typeof max === 'number' && result > max) result = max
        return result
      },
      [max, min],
    )

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.currentTarget.value

        // Strip characters that are never valid in our numeric formats; this
        // lets us keep `type="text"` while still rejecting alphabetic input.
        const allowed = integer ? /[^\d-]/g : /[^\d.\-eE]/g
        const cleaned = raw.replace(allowed, '')

        if (isIntermediateInput(cleaned, integer)) {
          setText(cleaned)
          // Treat intermediates as "no committed value yet" — emit null so
          // the parent doesn't store a half-typed number. The full value
          // commits on the next valid keystroke or on blur.
          if (lastEmittedRef.current !== null) {
            lastEmittedRef.current = null
            onChange(null)
          }
          return
        }

        const parsed = integer ? parseInt(cleaned, 10) : parseFloat(cleaned)
        if (Number.isNaN(parsed)) return // Reject — keep previous state.

        setText(cleaned)
        const next = clamp(parsed)
        if (lastEmittedRef.current !== next) {
          lastEmittedRef.current = next
          onChange(next)
        }
      },
      [clamp, integer, onChange],
    )

    const handleBlur = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        // On blur, normalise the displayed text to match the committed value
        // (e.g. "01" → "1", "1." → "1"). Empty stays empty.
        if (lastEmittedRef.current == null) {
          if (text !== '') setText('')
        } else {
          const normalised = String(lastEmittedRef.current)
          if (text !== normalised) setText(normalised)
        }
        onBlur?.(e)
      },
      [onBlur, text],
    )

    return (
      <Input
        ref={ref}
        {...rest}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        onFocus={(e) => {
          if (selectOnFocus) e.currentTarget.select()
          onFocus?.(e)
        }}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    )
  },
)
