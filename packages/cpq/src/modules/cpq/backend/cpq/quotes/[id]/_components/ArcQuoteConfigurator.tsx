"use client"
import * as React from 'react'
import { NumberInput as BaseNumberInput } from '../../../../../components/NumberInput'

// XD-250 — ARC configurator drawer.
//
// Self-contained right-side drawer: action selection → target picker →
// renew/cancel config → review → submit. The host quote detail page renders
// it on demand and refetches when the drawer reports `onChanged`.

type ArcType = 'amend' | 'renew' | 'cancel'
type Step =
  | 'pick-action'
  | 'pick-targets'
  | 'config-renew'
  | 'config-cancel'
  | 'review'
  | 'submitting'
  | 'done'

type EligibleSub = {
  id: string
  code: string
  name: string
  status: string
  currencyCode: string
  billingCycle: string
  currentTermEnd: string | null
  mrcAmount: number
}

export type AttachedTarget = {
  id: string
  subscriptionId: string
  quoteType: string
  mergeAction: string | null
  newTermStart: string | null
  newTermEnd: string | null
  newTermMonths: number | null
  subscription: {
    code: string
    name: string
    currencyCode: string
    billingCycle: string
    mrcAmount: number
  } | null
}

export interface ArcQuoteConfiguratorProps {
  quoteId: string
  customerId: string
  customerName: string | null
  currencyCode: string
  initialType: 'new' | ArcType
  initialTargets: AttachedTarget[]
  editable: boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
}

const REASON_CODES = [
  { value: 'upgrade', label: 'Upgrade' },
  { value: 'downgrade', label: 'Downgrade' },
  { value: 'config-change', label: 'Configuration change' },
  { value: 'price-adjustment', label: 'Price adjustment' },
  { value: 'term-extension', label: 'Term extension' },
  { value: 'term-reduction', label: 'Term reduction' },
  { value: 'consolidation', label: 'Consolidation' },
  { value: 'customer-request', label: 'Customer request' },
  { value: 'non-payment', label: 'Non-payment' },
  { value: 'contract-breach', label: 'Contract breach' },
  { value: 'other', label: 'Other' },
] as const

export default function ArcQuoteConfigurator(
  props: ArcQuoteConfiguratorProps,
): React.ReactElement {
  const {
    quoteId,
    customerId,
    customerName,
    currencyCode,
    initialType,
    initialTargets,
    editable,
    onClose,
    onChanged,
  } = props

  const [step, setStep] = React.useState<Step>(
    initialType === 'new' ? 'pick-action' : 'pick-targets',
  )
  const [type, setType] = React.useState<ArcType | null>(
    initialType === 'new' ? null : (initialType as ArcType),
  )
  const [eligible, setEligible] = React.useState<EligibleSub[]>([])
  const [eligibleLoading, setEligibleLoading] = React.useState(false)
  const [picked, setPicked] = React.useState<Record<string, EligibleSub>>(() => {
    const seed: Record<string, EligibleSub> = {}
    for (const t of initialTargets) {
      if (t.subscription) {
        seed[t.subscriptionId] = {
          id: t.subscriptionId,
          code: t.subscription.code,
          name: t.subscription.name,
          status: 'active',
          currencyCode: t.subscription.currencyCode,
          billingCycle: t.subscription.billingCycle,
          currentTermEnd: null,
          mrcAmount: t.subscription.mrcAmount,
        }
      }
    }
    return seed
  })
  // Renew config (per-target term for standalone, quote-level for merge).
  const [singleTerm, setSingleTerm] = React.useState<{ start: string; end: string; months: string }>(() => ({
    start: initialTargets[0]?.newTermStart?.slice(0, 10) ?? '',
    end: initialTargets[0]?.newTermEnd?.slice(0, 10) ?? '',
    months: initialTargets[0]?.newTermMonths != null ? String(initialTargets[0].newTermMonths) : '',
  }))
  const [mergeTerm, setMergeTerm] = React.useState({
    start: '',
    end: '',
    months: '',
    code: '',
    name: '',
  })
  // Cancel config.
  const [cancelMeta, setCancelMeta] = React.useState({
    reasonCode: '',
    reasonText: '',
    etfAmount: '',
    etfCurrency: currencyCode,
  })
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // ESC closes the drawer.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch eligible subscriptions when step requires it.
  React.useEffect(() => {
    if (step !== 'pick-targets') return
    setEligibleLoading(true)
    fetch(`/api/cpq/inventory/subscriptions?customerId=${customerId}&pageSize=100`)
      .then((r) => r.json())
      .then((data) => {
        const items: EligibleSub[] = (data.items ?? []).map((s: EligibleSub) => ({
          ...s,
          mrcAmount: Number(s.mrcAmount ?? 0),
        }))
        setEligible(items)
      })
      .catch(() => setEligible([]))
      .finally(() => setEligibleLoading(false))
  }, [step, customerId])

  const pickedList = Object.values(picked)
  const isMergeRenew = type === 'renew' && pickedList.length >= 2
  const billingCycles = new Set(pickedList.map((s) => s.billingCycle))
  const cyclesMatch = billingCycles.size <= 1
  const currenciesMatch = pickedList.every((s) => s.currencyCode === currencyCode)

  // Validation gates.
  const canProceedFromTargets = pickedList.length > 0 && currenciesMatch
  const canProceedFromRenew =
    isMergeRenew
      ? !!mergeTerm.start && !!mergeTerm.end && mergeTerm.start < mergeTerm.end && cyclesMatch
      : !!singleTerm.start && !!singleTerm.end && singleTerm.start < singleTerm.end
  const canProceedFromCancel = !!cancelMeta.reasonCode

  const submit = React.useCallback(async () => {
    setStep('submitting')
    setSubmitError(null)
    try {
      // Step 1 — set quote type when transitioning from 'new'.
      if (initialType === 'new' && type) {
        const r = await fetch(`/api/cpq/quotes/${quoteId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteType: type }),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `PATCH /quotes/${quoteId} failed`)
        }
      }

      // Step 2 — detach removed targets.
      const initialTargetIds = new Set(initialTargets.map((t) => t.subscriptionId))
      const pickedIds = new Set(pickedList.map((s) => s.id))
      for (const t of initialTargets) {
        if (!pickedIds.has(t.subscriptionId)) {
          await fetch(`/api/cpq/quotes/${quoteId}/target-subscriptions/${t.id}`, { method: 'DELETE' })
        }
      }

      // Step 3 — attach new targets.
      for (const s of pickedList) {
        if (!initialTargetIds.has(s.id) && type) {
          const body: Record<string, unknown> = {
            subscriptionId: s.id,
            quoteType: type,
          }
          if (type === 'renew' && !isMergeRenew) {
            body.mergeAction = 'standalone'
            body.newTermStart = singleTerm.start
            body.newTermEnd = singleTerm.end
            if (singleTerm.months) body.newTermMonths = Number(singleTerm.months)
          } else if (type === 'renew' && isMergeRenew) {
            body.mergeAction = 'absorb'
          }
          const r = await fetch(`/api/cpq/quotes/${quoteId}/target-subscriptions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!r.ok) {
            const errBody = await r.json().catch(() => ({}))
            throw new Error(errBody.error ?? `POST /target-subscriptions failed`)
          }
        }
      }

      // Step 4 — for merge renew, stamp quote-level merge meta.
      if (type === 'renew' && isMergeRenew) {
        const body: Record<string, unknown> = {
          newTermStart: mergeTerm.start,
          newTermEnd: mergeTerm.end,
        }
        if (mergeTerm.months) body.newTermMonths = Number(mergeTerm.months)
        if (mergeTerm.code) body.newSubCode = mergeTerm.code
        if (mergeTerm.name) body.newSubName = mergeTerm.name
        const r = await fetch(`/api/cpq/quotes/${quoteId}/merge-meta`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) {
          const errBody = await r.json().catch(() => ({}))
          throw new Error(errBody.error ?? `POST /merge-meta failed`)
        }
      }

      // Step 5 — for cancel, stamp meta.
      if (type === 'cancel') {
        const body: Record<string, unknown> = { reasonCode: cancelMeta.reasonCode }
        if (cancelMeta.reasonText) body.reasonText = cancelMeta.reasonText
        if (cancelMeta.etfAmount) body.etfAmount = cancelMeta.etfAmount
        if (cancelMeta.etfCurrency) body.etfCurrency = cancelMeta.etfCurrency
        const r = await fetch(`/api/cpq/quotes/${quoteId}/cancel-meta`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) {
          const errBody = await r.json().catch(() => ({}))
          throw new Error(errBody.error ?? `POST /cancel-meta failed`)
        }
      }

      await onChanged()
      setStep('done')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
      setStep('review')
    }
  }, [
    quoteId,
    type,
    initialType,
    initialTargets,
    pickedList,
    isMergeRenew,
    singleTerm,
    mergeTerm,
    cancelMeta,
    onChanged,
  ])

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Overlay */}
      <button
        aria-label="Close drawer"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="ml-auto h-full w-full max-w-2xl bg-card shadow-xl border-l overflow-y-auto relative flex flex-col">
        <header className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Modify subscription</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {customerName ?? customerId.slice(0, 12) + '…'} • {currencyCode}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 px-5 py-4 space-y-4">
          {/* Step indicator */}
          <p className="text-xs text-muted-foreground">
            Step: <span className="font-mono">{step}</span>
            {type && <span> • {type}</span>}
            {pickedList.length > 0 && <span> • {pickedList.length} target(s)</span>}
          </p>

          {step === 'pick-action' && (
            <div className="space-y-3">
              <p className="text-sm">Pick the kind of change you want to make:</p>
              {(['amend', 'renew', 'cancel'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    setType(opt)
                    setStep('pick-targets')
                  }}
                  className="block w-full text-left rounded-md border border-input px-4 py-3 hover:bg-muted"
                >
                  <span className="font-medium capitalize">{opt}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {opt === 'amend' && 'Add or remove items on existing subscriptions. Term untouched.'}
                    {opt === 'renew' && 'Extend term. With 2+ targets, merges them into a new contract.'}
                    {opt === 'cancel' && 'Terminate one or more subscriptions.'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'pick-targets' && type && (
            <div className="space-y-3">
              {eligibleLoading ? (
                <div className="text-sm text-muted-foreground">Loading subscriptions…</div>
              ) : eligible.length === 0 ? (
                <div className="text-sm text-muted-foreground">No subscriptions for this customer.</div>
              ) : (
                <div className="space-y-1">
                  {eligible.map((s) => {
                    const currencyMismatch = s.currencyCode !== currencyCode
                    const isPicked = !!picked[s.id]
                    return (
                      <label
                        key={s.id}
                        className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                          currencyMismatch
                            ? 'opacity-50 border-dashed'
                            : isPicked
                              ? 'border-primary bg-primary/5'
                              : 'border-input hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={currencyMismatch}
                          checked={isPicked}
                          onChange={(e) => {
                            setPicked((prev) => {
                              const next = { ...prev }
                              if (e.target.checked) next[s.id] = s
                              else delete next[s.id]
                              return next
                            })
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {s.name}{' '}
                            <span className="text-xs font-mono text-muted-foreground">{s.code}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {s.status} • {s.billingCycle} • MRC {s.mrcAmount.toFixed(2)} {s.currencyCode}
                            {s.currentTermEnd
                              ? ` • Term ends ${new Date(s.currentTermEnd).toLocaleDateString()}`
                              : ''}
                          </div>
                          {currencyMismatch && (
                            <div className="text-xs text-orange-600 mt-1">
                              Currency mismatch ({s.currencyCode} vs {currencyCode}) — cannot include
                            </div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {!cyclesMatch && (
                <div className="rounded-md bg-orange-50 border border-orange-200 p-2 text-xs text-orange-800">
                  Picked targets have different billing cycles — merge requires matching cycles.
                </div>
              )}
              {isMergeRenew && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                  Merging {pickedList.length} contracts into a new one — sources will be marked Merged at activation.
                </div>
              )}
            </div>
          )}

          {step === 'config-renew' && type === 'renew' && !isMergeRenew && (
            <div className="space-y-3">
              <p className="text-sm">New contract term for {pickedList[0]?.name}:</p>
              <p className="text-xs text-muted-foreground">
                Pre-filled with same length as the current term, starting at the
                current term end. Type a new value in <span className="font-medium">Months</span> to
                auto-shift the end date, or edit start/end directly.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <DateInput
                  label="Start"
                  value={singleTerm.start}
                  onChange={(v) => {
                    // If months is set, slide end too so the contract length stays.
                    const months = singleTerm.months ? Number(singleTerm.months) : null
                    const end = months && v ? addMonthsToIso(v, months) : singleTerm.end
                    setSingleTerm({ ...singleTerm, start: v, end })
                  }}
                />
                <DateInput
                  label="End"
                  value={singleTerm.end}
                  onChange={(v) => setSingleTerm({ ...singleTerm, end: v })}
                />
                <NumberInput
                  label="Months"
                  value={singleTerm.months}
                  onChange={(v) => {
                    // Recompute end = start + months when both are present.
                    const months = v ? Number(v) : null
                    const end = months && singleTerm.start
                      ? addMonthsToIso(singleTerm.start, months)
                      : singleTerm.end
                    setSingleTerm({ ...singleTerm, months: v, end })
                  }}
                />
              </div>
            </div>
          )}

          {step === 'config-renew' && type === 'renew' && isMergeRenew && (
            <div className="space-y-3">
              <p className="text-sm">
                New contract details (merge of {pickedList.length} subscriptions):
              </p>
              <p className="text-xs text-muted-foreground">
                Type a value into <span className="font-medium">Months</span> to
                auto-fill both dates — start defaults to today, end is start + months.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <DateInput
                  label="Start"
                  value={mergeTerm.start}
                  onChange={(v) => {
                    const months = mergeTerm.months ? Number(mergeTerm.months) : null
                    const end = months && v ? addMonthsToIso(v, months) : mergeTerm.end
                    setMergeTerm({ ...mergeTerm, start: v, end })
                  }}
                />
                <DateInput
                  label="End"
                  value={mergeTerm.end}
                  onChange={(v) => setMergeTerm({ ...mergeTerm, end: v })}
                />
                <NumberInput
                  label="Months"
                  value={mergeTerm.months}
                  onChange={(v) => {
                    const months = v ? Number(v) : null
                    const start = mergeTerm.start || todayIso()
                    const end = months ? addMonthsToIso(start, months) : mergeTerm.end
                    setMergeTerm({ ...mergeTerm, months: v, start, end })
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="New contract code (optional — auto-generated if blank)"
                  value={mergeTerm.code}
                  onChange={(v) => setMergeTerm({ ...mergeTerm, code: v })}
                />
                <TextInput
                  label="New contract name (optional)"
                  value={mergeTerm.name}
                  onChange={(v) => setMergeTerm({ ...mergeTerm, name: v })}
                />
              </div>
            </div>
          )}

          {step === 'config-cancel' && type === 'cancel' && (
            <div className="space-y-3">
              <p className="text-sm">Reason for cancellation:</p>
              <div className="space-y-2">
                <label className="block text-xs text-muted-foreground">Reason code</label>
                <select
                  value={cancelMeta.reasonCode}
                  onChange={(e) => setCancelMeta({ ...cancelMeta, reasonCode: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— pick one —</option>
                  {REASON_CODES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <TextInput
                label="Free text (optional)"
                value={cancelMeta.reasonText}
                onChange={(v) => setCancelMeta({ ...cancelMeta, reasonText: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="ETF amount (optional)"
                  value={cancelMeta.etfAmount}
                  onChange={(v) => setCancelMeta({ ...cancelMeta, etfAmount: v })}
                />
                <TextInput
                  label="ETF currency"
                  value={cancelMeta.etfCurrency}
                  onChange={(v) => setCancelMeta({ ...cancelMeta, etfCurrency: v })}
                />
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <p className="text-sm">Review and submit:</p>
              <ul className="text-sm space-y-1 list-disc pl-5">
                <li>Action: {type}</li>
                <li>Targets: {pickedList.length}</li>
                {pickedList.map((s) => (
                  <li key={s.id} className="text-muted-foreground">
                    {s.code} — {s.name}
                  </li>
                ))}
                {type === 'renew' && !isMergeRenew && (
                  <li>
                    Term: {singleTerm.start} → {singleTerm.end}
                    {singleTerm.months ? ` (${singleTerm.months}m)` : ''}
                  </li>
                )}
                {type === 'renew' && isMergeRenew && (
                  <li>
                    Merge term: {mergeTerm.start} → {mergeTerm.end}
                    {mergeTerm.code ? ` • code=${mergeTerm.code}` : ''}
                    {mergeTerm.name ? ` • name=${mergeTerm.name}` : ''}
                  </li>
                )}
                {type === 'cancel' && (
                  <li>
                    Reason: {cancelMeta.reasonCode}
                    {cancelMeta.etfAmount
                      ? ` • ETF ${cancelMeta.etfAmount} ${cancelMeta.etfCurrency}`
                      : ''}
                  </li>
                )}
              </ul>
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-2 text-xs text-yellow-800">
                Submitting locks the quote type. Lines will be edited on the host page after this completes.
              </div>
              {submitError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {step === 'submitting' && (
            <div className="text-sm text-muted-foreground">Submitting…</div>
          )}

          {step === 'done' && (
            <div className="text-sm text-green-700">
              Done — close to return to the quote.
            </div>
          )}
        </div>

        <footer className="border-t px-5 pt-3 pb-20 flex items-center justify-between">
          <button
            onClick={() => {
              if (step === 'pick-action') return
              if (step === 'pick-targets') {
                setStep(initialType === 'new' ? 'pick-action' : 'pick-targets')
              } else if (step === 'config-renew' || step === 'config-cancel') {
                setStep('pick-targets')
              } else if (step === 'review') {
                if (type === 'renew') setStep('config-renew')
                else if (type === 'cancel') setStep('config-cancel')
                else setStep('pick-targets')
              }
            }}
            disabled={
              step === 'pick-action' ||
              step === 'submitting' ||
              step === 'done' ||
              (step === 'pick-targets' && initialType !== 'new')
            }
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            ← Back
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            {step === 'pick-targets' && (
              <button
                disabled={!canProceedFromTargets || !editable}
                onClick={() => {
                  if (type === 'renew') setStep('config-renew')
                  else if (type === 'cancel') setStep('config-cancel')
                  else setStep('review')
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Next
              </button>
            )}
            {(step === 'config-renew' || step === 'config-cancel') && (
              <button
                disabled={
                  (step === 'config-renew' && !canProceedFromRenew) ||
                  (step === 'config-cancel' && !canProceedFromCancel)
                }
                onClick={() => setStep('review')}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Next
              </button>
            )}
            {step === 'review' && (
              <button
                disabled={!editable}
                onClick={submit}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Submit
              </button>
            )}
            {step === 'done' && (
              <button
                onClick={onClose}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                Close
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

function DateInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{props.label}</label>
      <input
        type="date"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
    </div>
  )
}

// Local "labelled number" wrapper kept as a string-in/string-out facade so
// the surrounding code (which threads `value` through `mergeTerm.months` as
// a string) doesn't have to change. The actual input behaviour comes from
// the shared `NumberInput` component (select-on-focus + internal string
// state — see components/NumberInput.tsx for the rationale).
function NumberInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{props.label}</label>
      <BaseNumberInput
        integer
        min={1}
        value={props.value === '' ? null : Number(props.value)}
        onChange={(n) => props.onChange(n == null ? '' : String(n))}
      />
    </div>
  )
}

function TextInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{props.label}</label>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
    </div>
  )
}

// Add `months` whole calendar months to an ISO date string (YYYY-MM-DD) and
// return the result in the same format. Used by the renew config step so the
// operator can edit just the months field and have the end date auto-update.
function addMonthsToIso(iso: string, months: number): string {
  if (!iso) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

// Today as YYYY-MM-DD — used as the default `Start` when the operator types
// a `Months` value first on a brand-new merge contract.
function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}
