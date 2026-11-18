import type { BillCycle } from './billCycle'

/**
 * Account form → API payload for the bill cycle (create + edit pages).
 * `nextBillDate` is sent only when the operator set it by hand — otherwise the
 * API derives it from the bill cycle day (create) or re-aligns it when the
 * cycle changed (edit).
 */
export type BillCycleFormValues = {
  billCycle: BillCycle
  /** Text input value — "every N". */
  billCycleInterval: string
  /** '' for daily cycles. */
  billCycleDay: string
  nextBillDateOverride: boolean
  nextBillDate: string
}

export type BillCyclePayload = {
  billCycle: BillCycle
  billCycleInterval: number
  billCycleDay: string | null
  nextBillDate?: string
}

export function parseCycleInterval(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number.parseInt(trimmed, 10)
  return n >= 1 ? n : null
}

export function billCyclePayload(values: BillCycleFormValues): BillCyclePayload {
  const payload: BillCyclePayload = {
    billCycle: values.billCycle,
    billCycleInterval: parseCycleInterval(values.billCycleInterval) ?? 1,
    billCycleDay: values.billCycle === 'daily' || !values.billCycleDay ? null : values.billCycleDay,
  }
  if (values.nextBillDateOverride && values.nextBillDate) payload.nextBillDate = values.nextBillDate
  return payload
}
