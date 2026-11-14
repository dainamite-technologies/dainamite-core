"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import ArcQuoteConfigurator, {
  type AttachedTarget,
} from './_components/ArcQuoteConfigurator'
import { StatusPath } from '../../../../components/StatusPath'
import { ArrowRight, ExternalLink, Plus, RotateCcw } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import type { ActionItem } from '@open-mercato/ui/backend/forms/ActionsDropdown'
import { NumberInput } from '../../../../components/NumberInput'
import { ChargeBreakdownTable } from '../../../../components/ChargeBreakdownTable'
import { PricingSummaryCard } from '../../../../components/PricingSummaryCard'
import { ArcLineDiff, LineActionBadge } from '../../../../components/ArcLineDiff'
import { ADJUST_PRICE_FEATURE } from '../../../../lib/priceAdjustmentView'
import { arcRecurringDelta } from '../../../../lib/quoteSummaryView'
import { shouldShowRenewCostBanner } from '../../../../lib/arcRenewBanner'
import { usePriceAdjustments } from './_components/usePriceAdjustments'
import { PriceAdjustmentsPanel } from './_components/PriceAdjustmentsPanel'
import { ArcLineRemovalProvider, useArcLineRemoval, useArcLineRemovalUi } from './_components/arcLineRemoval'
import { AdjustChargeAction, DiscountLineAction, ManualAdjustmentActions, PriceAdjustmentProvider, usePriceAdjustmentUi } from './_components/priceAdjustmentContext'
import { useGrantedFeatures } from '../../../../components/useGrantedFeatures'
import { useQuoteCosts } from './_components/useQuoteCosts'
import { QuoteCostsProvider, useQuoteCostsUi, type QuoteCostsUi } from './_components/quoteCostsContext'
import { CostStatusBadges } from './_components/CostStatusBadges'
import { CostsPanel } from './_components/CostsPanel'
import { MarginCard } from './_components/MarginCard'
import { StaleRevisionBanner } from './_components/StaleRevisionBanner'
import { CostHeaderActions, CostRowActions } from './_components/CostActionButtons'
import { useCostActions } from './_components/useCostActions'
import { hasAnyCosts, isCostLocked, isQuoteIndicative, statusFailure, type RedactedQuoteCost } from '../../../../lib/quoteCostView'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { COSTS_MANAGE_FEATURE, COSTS_VIEW_FEATURE } from '../../../../data/costs'
import { canRecalculateQuote, QUOTE_MANAGE_FEATURE } from '../../../../lib/quotePermissions'
import {
  formatStatusLabel,
  quoteCpqStatusMap,
  type QuoteCpqStatus,
} from '../../../../components/statusMaps'

// ─── Types ───────────────────────────────────────────────────────

type ConstrainedAttribute = {
  code: string
  name: string
  attributeType: string
  isRequired: boolean
  options: Array<{ value: string; label: string }> | null
  constraints: Record<string, unknown> | null
  defaultValue: unknown | null
  helpText: string | null
}

type TierBreakdownEntry = { tier: number; from: number; to: number; pricePerUnit: number; quantity: number; subtotal: number }
type RuleAdjustment = {
  ruleCode: string; ruleName: string; ruleType: string; value: number; unitPriceBefore: number; unitPriceAfter: number; delta: number
  /** Negotiated-pricing fields; absent on legacy snapshots (treated as rules). */
  origin?: 'rule' | 'manual'; adjustmentId?: string; reasonCode?: string; createdByUserId?: string
}
type AdjustmentErrorEntry = { adjustmentId: string; quoteLineId: string; chargeCode?: string; code: string }

type ResolvedCharge = {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod?: 'flat' | 'tiered' | 'per_unit' | 'cost_plus'
  /** null = unpriced cost-plus charge (cost pending / missing / toggle off). */
  unitPrice: number | null
  /** Indicative fallback price of an unpriced cost-plus charge, when the API provides one. */
  fallbackPrice?: number | null
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  breakdown?: { tiers: TierBreakdownEntry[] } | null
  note?: string | null
  adjustments?: RuleAdjustment[] | null
  listUnitPrice?: number
  listTotalPrice?: number | null
  standardUnitPrice?: number
  standardTotalPrice?: number | null
  adjustmentErrors?: AdjustmentErrorEntry[]
}

type QuoteLineAction = 'add' | 'modify' | 'cancel'

type ArcLineSource = {
  subscriptionItemId: string
  name: string
  mrcAmount: number
  nrcAmount: number
  quantity: number
}

type QuoteLine = {
  lineId: string
  offeringId: string | null
  productId?: string | null
  offeringName: string
  offeringType: string | null
  parentLineId: string | null
  action: QuoteLineAction
  quantity: number
  configuration: Record<string, unknown>
  nrcTotal: number
  mrcTotal: number
  charges: ResolvedCharge[]
  isConfigured: boolean
  validationErrors: Array<{ message: string }> | null
  arcSource: ArcLineSource | null
  targetSubscriptionId: string | null
}

type QuoteResult = {
  id: string
  quoteId: string
  quoteNumber: string
  customerId: string
  customerName: string | null
  cpqStatus: string
  version: number
  pricingRevision?: number
  currencyCode: string
  convertedOrderId: string | null
  validationResult: { valid: boolean; errors: Array<{ message: string }> }
  adjustmentErrors?: AdjustmentErrorEntry[]
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number; note: string | null }>
    usageTotalEstimated: number | null
    currencyCode: string
    listNrcTotal?: number
    listMrcTotal?: number
    dealValue?: { list: number; standard: number; offer: number }
    discountDepth?: { rule: number | null; manual: number | null; total: number | null; maxLineManual: number | null }
    ruleDiscountTotal?: number
    manualDiscountTotal?: number
  }
  lines: QuoteLine[]
}

type Offering = {
  id: string
  code: string
  name: string
  description?: string | null
  specId: string
  lifecycleStatus: string
}

type BundleTreeSlot = {
  slotId: string
  componentGroup: string
  name: string
  cardinalityMin: number
  cardinalityMax: number | null
  components: Array<{
    componentId: string
    childOffering: { offeringId: string; offeringCode: string; offeringName: string; offeringType: string }
    isDefault: boolean
    sortOrder: number
  }>
}

type BundleTree = {
  offeringId: string
  offeringName: string
  offeringType: string
  slots: BundleTreeSlot[]
}

// ─── Constants ───────────────────────────────────────────────────

// `ALLOWED_TRANSITIONS` used to mirror the backend state machine on the
// client to gate the inline status menu. Per product decision the UI
// now lets the operator jump between any pair of statuses; the backend
// is the single source of truth, so the table is no longer needed here.

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`)
  return json as T
}

// ─── Header sub-components ─────────────────────────────────────

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}

// Pricing-summary figure: label, monospace amount, and an optional smaller
// bracketed note (discount depth / change %) inline after the amount.
function MoreActionsDropdown({ items }: { items: ActionItem[] }) {
  // Local dropdown — `ActionsDropdown` inside FormHeader.actionsContent
  // would conflict with the inline button placement. This is a thin
  // <details>-style trigger; menuActions on FormHeader would render it
  // inside the header layout, but here we want it adjacent to other
  // primary buttons.
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (items.length === 0) return null
  return (
    <div className="relative" ref={ref}>
      <Button type="button" variant="outline" onClick={() => setOpen((v) => !v)}>
        Actions
        <svg className="h-3 w-3 ml-1" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border bg-popover shadow-md py-1">
          {items.map((item) => {
            const isDelete = item.id === 'delete'
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setOpen(false); item.onSelect() }}
                disabled={item.disabled || item.loading}
                // Use bg-accent on hover (same token as Radix-style menu items in OM)
                // and tint delete with destructive colors so the affordance is obvious.
                className={
                  'w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ' +
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
                  (isDelete
                    ? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:outline-none'
                    : 'hover:bg-accent focus:bg-accent focus:outline-none')
                }
              >
                {item.icon ? <item.icon className="h-4 w-4 text-muted-foreground" /> : null}
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function buildMoreActions({
  recalculate,
  canRecalculate,
  submitting,
  deletable,
  onDelete,
  deleting,
}: {
  recalculate: () => void
  canRecalculate: boolean
  submitting: boolean
  deletable: boolean
  onDelete: () => void
  deleting: boolean
}): ActionItem[] {
  const items: ActionItem[] = []
  // Recalculate persists prices: offered only to users with cpq.quotes.manage
  // and only on non-terminal quotes (the API refuses both otherwise).
  if (canRecalculate) {
    items.push({
      id: 'recalculate',
      label: 'Recalculate',
      onSelect: recalculate,
      loading: submitting,
      disabled: submitting,
    })
  }
  if (deletable) {
    items.push({
      id: 'delete',
      label: 'Delete',
      onSelect: onDelete,
      disabled: deleting,
      loading: deleting,
    })
  }
  return items
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CpqQuoteDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const searchParams = useSearchParams()
  const cpqConfigId = (props.params?.id ?? urlParams?.id) as string
  const isNew = cpqConfigId === 'new'

  const t = useT()
  const [cpqQuote, setCpqQuote] = React.useState<QuoteResult | null>(null)
  const grantedFeatures = useGrantedFeatures([QUOTE_MANAGE_FEATURE, ADJUST_PRICE_FEATURE, COSTS_VIEW_FEATURE, COSTS_MANAGE_FEATURE])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // Configurator state
  const [view, setView] = React.useState<'summary' | 'add-offering' | 'configure' | 'edit'>('summary')
  const [offerings, setOfferings] = React.useState<Offering[]>([])
  const [offeringsLoading, setOfferingsLoading] = React.useState(false)
  const [offeringSearch, setOfferingSearch] = React.useState('')
  const [selectedOffering, setSelectedOffering] = React.useState<Offering | null>(null)
  const [attributes, setAttributes] = React.useState<ConstrainedAttribute[]>([])
  const [config, setConfig] = React.useState<Record<string, unknown>>({})
  const [quantity, setQuantity] = React.useState(1)
  const [editingLineId, setEditingLineId] = React.useState<string | null>(null)
  const [addingToParentLineId, setAddingToParentLineId] = React.useState<string | null>(null)
  // XD-250 multi-target ARC: when adding a top-level offering operator can
  // pick 1..N target subs (default = all) and we fire one POST per target.
  // For "Add Component" to a bundle, this is forced to a single id (the
  // parent line's target) since a bundle component must follow its bundle.
  const [addingTargetSubIds, setAddingTargetSubIds] = React.useState<string[]>([])
  const [expandedLines, setExpandedLines] = React.useState<Set<string>>(new Set())
  const [converting, setConverting] = React.useState(false)
  const [transitioning, setTransitioning] = React.useState(false)
  const [staleStatus, setStaleStatus] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [pricingDetail, setPricingDetail] = React.useState<{ lineIdx: number; chargeIdx: number } | null>(null)

  // ─── XD-250 ARC state ──────────────────────────────────────────
  const [arcTargets, setArcTargets] = React.useState<AttachedTarget[]>([])
  const [arcQuoteType, setArcQuoteType] = React.useState<'new' | 'amend' | 'renew' | 'cancel'>('new')
  const [arcDrawerOpen, setArcDrawerOpen] = React.useState(false)

  const loadArcTargets = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/cpq/quotes/${cpqConfigId}/target-subscriptions`)
      if (!res.ok) return
      const data = await res.json()
      const items: AttachedTarget[] = data.items ?? []
      setArcTargets(items)
      if (items.length > 0) {
        setArcQuoteType(items[0].quoteType as 'amend' | 'renew' | 'cancel')
      } else {
        setArcQuoteType('new')
      }
    } catch {
      // best-effort — non-ARC quotes have no targets, that's fine.
    }
  }, [cpqConfigId])

  React.useEffect(() => {
    if (!cpqConfigId || isNew) return
    void loadArcTargets()
  }, [cpqConfigId, isNew, loadArcTargets])

  // ─── Negotiated prices ─────────────────────────────────────────
  const reloadQuote = React.useCallback(async () => {
    try {
      setCpqQuote(await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqConfigId}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [cpqConfigId])
  const priceAdjustments = usePriceAdjustments<QuoteResult>({
    quote: isNew ? null : cpqQuote,
    quoteType: arcQuoteType,
    canAdjust: grantedFeatures.includes(QUOTE_MANAGE_FEATURE) && grantedFeatures.includes(ADJUST_PRICE_FEATURE),
    onQuote: setCpqQuote,
    reloadQuote,
  })

  // ─── Cost-plus costs and margin ────────────────────────────────
  const quoteCosts = useQuoteCosts({ quoteId: isNew ? null : cpqQuote?.id ?? null, revision: cpqQuote?.pricingRevision ?? 0 })
  const canViewCosts = grantedFeatures.includes(COSTS_VIEW_FEATURE)
  const canManageCosts = canViewCosts && grantedFeatures.includes(COSTS_MANAGE_FEATURE) && grantedFeatures.includes(QUOTE_MANAGE_FEATURE)
  const chargesFor = React.useCallback(
    (lineId: string) => (cpqQuote?.lines.find((line) => line.lineId === lineId)?.charges ?? []).map((charge) => ({
      chargeCode: charge.chargeCode, chargeName: charge.chargeName, chargeType: charge.chargeType, pricingMethod: charge.pricingMethod,
    })),
    [cpqQuote],
  )
  const costActions = useCostActions({
    quoteId: isNew ? null : cpqQuote?.id ?? null,
    currency: cpqQuote?.currencyCode ?? 'EUR',
    data: quoteCosts.data,
    canManage: canManageCosts,
    chargesFor,
    reloadCosts: quoteCosts.reload,
    reloadQuote,
  })
  const costsUi: QuoteCostsUi | null = cpqQuote && quoteCosts.state === 'ready'
    ? {
      quoteId: cpqQuote.id,
      cpqStatus: cpqQuote.cpqStatus,
      locked: isCostLocked(cpqQuote.cpqStatus, cpqQuote.convertedOrderId),
      canView: canViewCosts,
      canManage: canManageCosts,
      data: quoteCosts.data,
      costsFor: (lineId) => quoteCosts.byLine.get(lineId) ?? [],
      reload: quoteCosts.reload,
      chargesFor,
      actions: costActions.actions,
    }
    : null
  const indicative = costsUi?.data ? isQuoteIndicative(costsUi.data.lines) : false

  // ─── Load or create ──────────────────────────────────────────

  React.useEffect(() => {
    if (isNew) {
      // Create new CPQ quote from query params
      const quoteId = searchParams.get('quoteId')
      const customerId = searchParams.get('customerId')
      if (!customerId) {
        setError('customerId is required to create a CPQ quote')
        setLoading(false)
        return
      }
      async function create() {
        try {
          const body: Record<string, string> = { customerId: customerId! }
          if (quoteId) body.quoteId = quoteId
          const result = await apiJson<QuoteResult>('/api/cpq/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          router.replace(`/backend/cpq/quotes/${result.id}`)
        } catch (err) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
      create()
      return
    }

    let cancelled = false
    async function load() {
      try {
        const result = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqConfigId}`)
        if (!cancelled) setCpqQuote(result)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [cpqConfigId, isNew, searchParams, router])

  // ─── Actions ─────────────────────────────────────────────────

  const loadOfferings = async () => {
    setOfferingsLoading(true)
    try {
      const result = await apiJson<{ items: Offering[] }>('/api/cpq/product-offerings?pageSize=100&lifecycleStatus=active')
      setOfferings(result.items ?? [])
    } catch { setOfferings([]) }
    finally { setOfferingsLoading(false) }
  }

  const loadAttributes = async (offeringId: string, currentConfig: Record<string, unknown> = {}) => {
    try {
      const params = new URLSearchParams({ offeringId })
      if (Object.keys(currentConfig).length > 0) params.set('configuration', JSON.stringify(currentConfig))
      const result = await apiJson<{ attributes: ConstrainedAttribute[] }>(`/api/cpq/quotes/attributes?${params}`)
      setAttributes(result.attributes ?? [])
    } catch { setAttributes([]) }
  }

  const addItem = async () => {
    if (!cpqQuote || !selectedOffering) return
    try {
      setSubmitting(true); setError(null)
      // XD-250 multi-target ARC: when ≥2 targets selected, fire one POST per
      // target — backend creates one line per request, each tagged with its
      // own targetSubscriptionId. Single target / non-ARC quote: list is
      // empty or 1-elem, we just do one POST and let the server auto-inherit.
      const targetsToPost = addingTargetSubIds.length > 0 ? addingTargetSubIds : [null]
      let lastResult: QuoteResult | null = null
      for (const tid of targetsToPost) {
        const body: Record<string, unknown> = { offeringId: selectedOffering.id, configuration: config, quantity }
        if (addingToParentLineId) body.parentLineId = addingToParentLineId
        if (tid) body.targetSubscriptionId = tid
        lastResult = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      if (lastResult) setCpqQuote(lastResult)
      resetConfigState()
      setView('summary')
    } catch (err) { setError((err as Error).message) }
    finally { setSubmitting(false) }
  }

  const updateItem = async (lineId: string) => {
    if (!cpqQuote) return
    try {
      setSubmitting(true); setError(null)
      const result = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/items/${lineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration: config, quantity }),
      })
      setCpqQuote(result)
      resetConfigState()
      setView('summary')
    } catch (err) { setError((err as Error).message) }
    finally { setSubmitting(false) }
  }

  // Amend / Renew: removing an existing subscription item confirms first and
  // marks it for removal (a `cancel` line) instead of deleting the line.
  const lineRemoval = useArcLineRemoval<QuoteResult>({
    quote: isNew ? null : cpqQuote,
    quoteType: arcQuoteType,
    onQuote: setCpqQuote,
    onError: setError,
  })
  const removeItem = lineRemoval.remove

  const recalculate = async () => {
    if (!cpqQuote) return
    try {
      setSubmitting(true); setError(null)
      const result = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: true }),
      })
      setCpqQuote(result)
    } catch (err) { setError((err as Error).message) }
    finally { setSubmitting(false) }
  }

  const convertToOrder = async () => {
    if (!cpqQuote) return
    try {
      setConverting(true); setError(null)
      const result = await apiJson<{ id: string }>('/api/cpq/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: cpqQuote.id }),
      })
      router.push(`/backend/cpq/orders/${result.id}`)
    } catch (err) { setError((err as Error).message) }
    finally { setConverting(false) }
  }

  const transitionStatus = async (targetStatus: string) => {
    if (!cpqQuote) return
    setTransitioning(true); setError(null); setStaleStatus(false)
    try {
      const call = await apiCall<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus, expectedRevision: cpqQuote.pricingRevision }),
      })
      if (call.ok && call.result) { setCpqQuote(call.result); return }
      const failure = statusFailure(call.status, call.result)
      if (failure.kind === 'stale') setStaleStatus(true)
      else setError(failure.message)
    } catch (err) { setError((err as Error).message) }
    finally { setTransitioning(false) }
  }

  const deleteQuote = async () => {
    if (!cpqQuote) return
    try {
      setDeleting(true); setError(null); setShowDeleteConfirm(false)
      await apiJson<{ ok: boolean }>(`/api/cpq/quotes/${cpqQuote.id}`, { method: 'DELETE' })
      router.push('/backend/cpq/quotes')
    } catch (err) { setError((err as Error).message) }
    finally { setDeleting(false) }
  }

  const resetConfigState = () => {
    setSelectedOffering(null)
    setAttributes([])
    setConfig({})
    setQuantity(1)
    setEditingLineId(null)
    setAddingToParentLineId(null)
  }

  const startAddOffering = () => {
    resetConfigState()
    // Default: apply to all attached targets (operator can uncheck in the picker).
    setAddingTargetSubIds(arcTargets.map((t) => t.subscriptionId))
    loadOfferings()
    setView('add-offering')
  }

  const startAddComponent = async (parentLineId: string, offeringId?: string) => {
    setSelectedOffering(null)
    setAttributes([])
    setConfig({})
    setQuantity(1)
    setEditingLineId(null)
    setAddingToParentLineId(parentLineId)
    // Inherit the parent line's target so a bundle component lands on the
    // same subscription as its parent (XD-250 multi-target ARC). For
    // components there's no choice — bundle ↔ component must agree.
    const parent = cpqQuote?.lines.find((l) => l.lineId === parentLineId)
    const inherited = parent?.targetSubscriptionId ?? arcTargets[0]?.subscriptionId
    setAddingTargetSubIds(inherited ? [inherited] : [])
    if (offeringId) {
      try {
        const result = await apiJson<{ items: Offering[] }>('/api/cpq/product-offerings?pageSize=100&lifecycleStatus=active')
        const match = (result.items ?? []).find((o) => o.id === offeringId)
        if (match) {
          selectOffering(match)
          return
        }
      } catch { /* fall through to browser */ }
    }
    loadOfferings()
    setView('add-offering')
  }

  const selectOffering = (o: Offering) => {
    setSelectedOffering(o); setConfig({}); setQuantity(1)
    loadAttributes(o.id)
    setView('configure')
  }

  const startEditLine = (line: QuoteLine) => {
    setEditingLineId(line.lineId)
    setConfig(line.configuration ?? {})
    setQuantity(line.quantity)
    if (line.offeringId) loadAttributes(line.offeringId, line.configuration ?? {})
    setView('edit')
  }

  const toggleLine = (id: string) => {
    setExpandedLines((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ─── Render: loading / error ─────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    )
  }

  if (!cpqQuote) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/backend/cpq/quotes')} className="text-sm text-muted-foreground hover:text-foreground">← Back to Quotes</button>
        {error && <ErrorBanner message={error} />}
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Quote not found.</div>
      </div>
    )
  }

  // ─── Render: detail ──────────────────────────────────────────

  const { pricingSummary: summary, currencyCode: currency } = cpqQuote
  const arcDelta = arcQuoteType === 'amend' || arcQuoteType === 'renew' ? arcRecurringDelta(cpqQuote.lines) : null

  const arcEditable = ['new', 'incomplete', 'ready'].includes(cpqQuote.cpqStatus)
  const isMergeRenew =
    arcQuoteType === 'renew' &&
    arcTargets.length >= 2 &&
    arcTargets.every((t) => t.mergeAction === 'absorb')

  // XD-250 multi-target ARC: map subscriptionId → friendly code (e.g. SUB-...).
  // Used for the per-line target badge so the operator can see which sub each
  // line acts on; only meaningful when there are 2+ targets. Plain map (not
  // useMemo) because this whole block is after the loading / not-found early
  // returns — adding a hook here would violate Rules of Hooks. Tiny N (count
  // of attached ARC targets) so re-building per render is fine.
  const arcTargetCodeMap = new Map<string, string>()
  for (const t of arcTargets) {
    if (t.subscription?.code) arcTargetCodeMap.set(t.subscriptionId, t.subscription.code)
  }

  return (
    <PriceAdjustmentProvider value={priceAdjustments.ui}>
    <ArcLineRemovalProvider value={lineRemoval.ui}>
    <QuoteCostsProvider value={costsUi}>
    <div className="space-y-6">
      {priceAdjustments.elements}
      {costActions.elements}
      {lineRemoval.ConfirmDialogElement}
      {arcDrawerOpen && (
        <ArcQuoteConfigurator
          quoteId={cpqQuote.id}
          customerId={cpqQuote.customerId}
          customerName={cpqQuote.customerName}
          currencyCode={cpqQuote.currencyCode}
          initialType={arcQuoteType}
          initialTargets={arcTargets}
          editable={arcEditable}
          onClose={() => setArcDrawerOpen(false)}
          onChanged={async () => {
            await loadArcTargets()
            // Drawer attached / detached targets — backend may have mirrored
            // items from new targets (XD-250 multi-target ARC), so refetch
            // the full quote to pick up the new lines without a hard refresh.
            try {
              const fresh = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}`)
              setCpqQuote(fresh)
            } catch {
              /* ignore — loadArcTargets already surfaced any error */
            }
          }}
        />
      )}
      {/* Header — uses the standard Open Mercato `FormHeader mode="detail"`
          so CPQ matches the rest of the admin. Title is just the quote
          number (no "Quote …" prefix); badges sit underneath; secondary
          context (customer / version / currency) lives in dedicated meta
          cards below the header, not in a thin meta line. */}
      <FormHeader
        mode="detail"
        backHref="/backend/cpq/quotes"
        backLabel="Back to CPQ Quotes"
        entityTypeLabel="CPQ Quote"
        title={cpqQuote.quoteNumber || cpqQuote.customerName || 'Untitled'}
        statusBadge={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Tag variant={quoteCpqStatusMap[cpqQuote.cpqStatus as QuoteCpqStatus] ?? 'neutral'} dot>
              {formatStatusLabel(cpqQuote.cpqStatus)}
            </Tag>
            {arcQuoteType !== 'new' && (
              <Tag variant="brand" className="uppercase">{arcQuoteType}</Tag>
            )}
            {cpqQuote.convertedOrderId && <Tag variant="success" dot>Converted</Tag>}
            {indicative && (
              <Tag variant="warning" dot title={t('cpq.quoteCosts.indicativeHint', 'A price-basis cost is still an estimate, so the price may change.')} data-testid="cpq-indicative-chip">
                {t('cpq.quoteCosts.indicative', 'Indicative')}
              </Tag>
            )}
          </div>
        }
        // FormHeader.detail ignores `utilityActions` whenever `actionsContent`
        // is set, so we render the "View Sales Quote" link inline alongside
        // the primary actions to keep it visible.
        actionsContent={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/backend/sales/quotes/${cpqQuote.quoteId}`)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Sales Quote
            </Button>
            {cpqQuote.convertedOrderId ? (
              <Button
                type="button"
                onClick={() => router.push(`/backend/cpq/orders/${cpqQuote.convertedOrderId}`)}
              >
                <ArrowRight className="h-4 w-4" />
                Go to order
              </Button>
            ) : view !== 'summary' ? (
              <Button type="button" variant="outline" onClick={() => { resetConfigState(); setView('summary') }}>
                Cancel
              </Button>
            ) : (
              <>
                <Button type="button" onClick={startAddOffering}>
                  <Plus className="h-4 w-4" />
                  Add Offering
                </Button>
                {arcEditable && (
                  <Button type="button" variant="outline" onClick={() => setArcDrawerOpen(true)}>
                    Modify Subscription
                  </Button>
                )}
                {cpqQuote.cpqStatus === 'accepted' && (
                  <Button type="button" onClick={convertToOrder} disabled={converting}>
                    {converting ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
                    Convert to Order
                  </Button>
                )}
                <MoreActionsDropdown
                  items={buildMoreActions({
                    recalculate,
                    canRecalculate: canRecalculateQuote(grantedFeatures, cpqQuote.cpqStatus),
                    submitting,
                    deletable: !['accepted', 'rejected', 'cancelled'].includes(cpqQuote.cpqStatus),
                    onDelete: () => setShowDeleteConfirm(true),
                    deleting,
                  })}
                />
              </>
            )}
          </>
        }
      />

      {/* Per user feedback, order below the FormHeader is:
            1. Status path (operator-facing lifecycle nav)
            2. ARC info (amend/renew/cancel banner with targets)
            3. Customer / Version / Currency meta cards
            4. Pricing summary + line items (further down in the page)
         Status path and ARC info are higher because they describe what
         the user is *doing*; the meta cards are reference info. */}

      {/* Status path — every step is clickable so the operator can move
          between any pair of statuses. Backend enforces ARC-specific
          guards (validateArcQuote on submit-for-approval) but no longer
          gates simple transitions. */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusPath
          // Per product decision the quote status path lets the operator
          // jump between any pair of statuses, so `allowedTransitions` is
          // omitted — backend validates ARC-specific guards.
          // `pre_approved` aliases into the `approved` slot for layout.
          current={cpqQuote.cpqStatus}
          path={
            cpqQuote.cpqStatus === 'pre_approved'
              ? ['new', 'incomplete', 'ready', 'in_approval', 'pre_approved', 'with_customer', 'accepted']
              : ['new', 'incomplete', 'ready', 'in_approval', 'approved', 'with_customer', 'accepted']
          }
          terminals={['rejected', 'cancelled']}
          statusMap={quoteCpqStatusMap}
          onTransition={transitionStatus}
          disabled={transitioning}
          ariaLabel="Quote status path"
        />
        {transitioning && <Spinner />}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {staleStatus && (
        <StaleRevisionBanner onReload={() => { setStaleStatus(false); void reloadQuote(); void quoteCosts.reload() }} />
      )}

      {arcQuoteType !== 'new' && arcTargets.length > 0 && (
        <div className="rounded-md border border-brand-violet/30 bg-brand-violet/10 px-4 py-3 text-sm text-brand-violet">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium uppercase">{arcQuoteType}</span>
              {' • '}
              {arcTargets.length} target{arcTargets.length === 1 ? '' : 's'}:
              {' '}
              {arcTargets.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <button
                    onClick={() =>
                      router.push(`/backend/cpq/inventory/subscriptions/${t.subscriptionId}`)
                    }
                    className="text-brand-violet hover:underline"
                  >
                    {t.subscription?.code ?? t.subscriptionId.slice(0, 8)}
                  </button>
                </span>
              ))}
              {isMergeRenew && (
                <span className="ml-2 text-status-warning-text font-medium">
                  • Merging into a new contract
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Meta cards — secondary reference info (customer, version,
          currency). Mirrors the sidebar tiles in the standard
          sales-document detail layout. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <MetaCard label="Customer">
          {cpqQuote.customerName ? (
            <span className="font-medium">{cpqQuote.customerName}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {cpqQuote.customerId.slice(0, 8)}…
            </span>
          )}
        </MetaCard>
        <MetaCard label="Version">
          <span className="font-medium">v{cpqQuote.version}</span>
        </MetaCard>
        <MetaCard label="Currency">
          <span className="font-medium">{currency}</span>
        </MetaCard>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-sm rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">Delete Quote</h3>
            </div>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Are you sure you want to delete this quote? This will soft-delete the quote and all its line items.</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={deleteQuote} disabled={deleting}>
                {deleting ? <Spinner /> : null} Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Summary view */}
      {view === 'summary' && (
        <>
          {costsUi?.canView ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <PricingSummaryCard summary={summary} currency={currency} arcDelta={arcDelta} />
              <MarginCard
                margin={costsUi.data?.margin}
                hasCosts={hasAnyCosts(costsUi.data?.lines)}
                currency={currency}
                bundleParents={cpqQuote.lines
                  .filter((line) => cpqQuote.lines.some((child) => child.parentLineId === line.lineId))
                  .map((line) => ({ lineId: line.lineId, name: line.offeringName }))}
              />
            </div>
          ) : (
            <PricingSummaryCard summary={summary} currency={currency} arcDelta={arcDelta} />
          )}

          {/* Validation errors */}
          {!cpqQuote.validationResult.valid && (
            <Alert variant="warning">
              <AlertTitle>Validation Issues</AlertTitle>
              <AlertDescription>
                {/* Stacked <span>s rather than <ul>/<li>: before Open Mercato
                    0.8 AlertDescription rendered a <p>, where a list is invalid
                    HTML and a Next 16 hydration error. It is a <div> now, so a
                    list would be fine; the spans are kept as harmless. */}
                <span className="text-xs space-y-0.5 block">
                  {cpqQuote.validationResult.errors.map((e, i) => (
                    <span key={i} className="block">— {e.message}</span>
                  ))}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Amend lines the rep reconfigured are re-priced at today's catalog
              price (server marks them `_arcRepriced`); negotiated prices are
              not carried over yet (later release). */}
          {arcQuoteType === 'amend' && cpqQuote.lines.some((l) => l.action !== 'cancel' && l.configuration?._arcRepriced === true) && (
            <Alert status="information" style="lighter">
              <AlertTitle>
                {t('cpq.quotes.arc.repricedTitle', 'Some existing items use the current catalog price')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'cpq.quotes.arc.repricedDescription',
                  "Reconfigured lines were re-priced at today's catalog price. Negotiated prices from the subscription are not carried over to reconfigured lines yet.",
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Renew lines of cost-plus items keep their contracted price (feature spec Q4). Shown to every
              user; carries no amounts. */}
          {shouldShowRenewCostBanner(arcQuoteType, cpqQuote.lines) && (
            <Alert status="information" style="lighter">
              <AlertTitle>
                {t('cpq.quotes.arc.costsNotCarriedTitle', 'Costs are not carried to change quotes yet')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'cpq.quotes.arc.costsNotCarriedDescription',
                  'This line keeps its contracted price. Changing its configuration re-prices it from today\'s costs.',
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Quote Lines */}
          <QuoteLineTree
            lines={cpqQuote.lines}
            currency={currency}
            expandedLines={expandedLines}
            pricingDetail={pricingDetail}
            targetCodes={arcTargetCodeMap}
            onToggleLine={toggleLine}
            onEditLine={startEditLine}
            onRemoveLine={removeItem}
            onAddComponent={startAddComponent}
            onTogglePricingDetail={(lineIdx, chargeIdx) =>
              setPricingDetail(
                pricingDetail?.lineIdx === lineIdx && pricingDetail?.chargeIdx === chargeIdx
                  ? null
                  : { lineIdx, chargeIdx },
              )
            }
          />

          <PriceAdjustmentsPanel
            quoteId={cpqQuote.id}
            items={priceAdjustments.items}
            total={priceAdjustments.total}
            lines={cpqQuote.lines}
            currency={currency}
            errorsById={priceAdjustments.errorsById}
          />
        </>
      )}

      {/* Add offering — browse */}
      {view === 'add-offering' && (
        <>
          {addingToParentLineId && (
            <Alert variant="info">
              Adding component to bundle: <span className="font-medium">{cpqQuote.lines.find((l) => l.lineId === addingToParentLineId)?.offeringName ?? 'Bundle'}</span>
            </Alert>
          )}
          <OfferingBrowser
            offerings={offerings}
            loading={offeringsLoading}
            search={offeringSearch}
            onSearchChange={setOfferingSearch}
            onSelect={selectOffering}
          />
        </>
      )}

      {/* Configure new offering */}
      {view === 'configure' && selectedOffering && (
        <ConfigurePanel
          title={addingToParentLineId ? `Add Component: ${selectedOffering.name}` : `Configure: ${selectedOffering.name}`}
          attributes={attributes}
          config={config}
          quantity={quantity}
          arcTargetOptions={
            arcTargets.length >= 2 && !addingToParentLineId
              ? arcTargets.map((t) => ({
                  subscriptionId: t.subscriptionId,
                  code: t.subscription?.code ?? t.subscriptionId.slice(0, 8),
                  name: t.subscription?.name ?? null,
                }))
              : null
          }
          arcSelectedTargetIds={addingTargetSubIds}
          onArcTargetToggle={(subId) => {
            setAddingTargetSubIds((prev) =>
              prev.includes(subId) ? prev.filter((id) => id !== subId) : [...prev, subId],
            )
          }}
          onConfigChange={(key, value) => {
            const next = { ...config, [key]: value }
            setConfig(next)
            if (selectedOffering) loadAttributes(selectedOffering.id, next)
          }}
          onQuantityChange={setQuantity}
          onSubmit={addItem}
          submitLabel="Add to Quote"
          submitting={submitting}
        />
      )}

      {/* Edit existing line */}
      {view === 'edit' && editingLineId && (
        <ConfigurePanel
          title={`Edit: ${cpqQuote.lines.find((l) => l.lineId === editingLineId)?.offeringName ?? 'Line'}`}
          attributes={attributes}
          config={config}
          quantity={quantity}
          arcTargetOptions={null}
          arcSelectedTargetIds={[]}
          onArcTargetToggle={() => {}}
          onConfigChange={(key, value) => {
            const next = { ...config, [key]: value }
            setConfig(next)
            const line = cpqQuote.lines.find((l) => l.lineId === editingLineId)
            if (line?.offeringId) loadAttributes(line.offeringId, next)
          }}
          onQuantityChange={setQuantity}
          onSubmit={() => updateItem(editingLineId)}
          submitLabel="Update Line"
          submitting={submitting}
        />
      )}
    </div>
    </QuoteCostsProvider>
    </ArcLineRemovalProvider>
    </PriceAdjustmentProvider>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

function QuoteLineTree({ lines, currency, expandedLines, pricingDetail, targetCodes, onToggleLine, onEditLine, onRemoveLine, onAddComponent, onTogglePricingDetail }: {
  lines: QuoteLine[]; currency: string; expandedLines: Set<string>
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  targetCodes: Map<string, string>
  onToggleLine: (id: string) => void; onEditLine: (line: QuoteLine) => void
  onRemoveLine: (lineId: string) => void; onAddComponent: (parentLineId: string, offeringId?: string) => void
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
}) {
  const [bundleTrees, setBundleTrees] = React.useState<Map<string, BundleTree>>(new Map())
  const [loadingTrees, setLoadingTrees] = React.useState<Set<string>>(new Set())

  const rootLines = lines.filter((l) => !l.parentLineId)
  const childrenByParent = new Map<string, QuoteLine[]>()
  for (const line of lines) {
    if (line.parentLineId) {
      const arr = childrenByParent.get(line.parentLineId) ?? []
      arr.push(line)
      childrenByParent.set(line.parentLineId, arr)
    }
  }

  const fetchBundleTree = React.useCallback(async (offeringId: string) => {
    if (bundleTrees.has(offeringId) || loadingTrees.has(offeringId)) return
    setLoadingTrees((prev) => new Set(prev).add(offeringId))
    try {
      const result = await apiJson<{ tree: BundleTree }>(`/api/cpq/bundle-tree?offeringId=${offeringId}`)
      setBundleTrees((prev) => new Map(prev).set(offeringId, result.tree))
    } catch { /* ignore — will just not show structure */ }
    finally { setLoadingTrees((prev) => { const n = new Set(prev); n.delete(offeringId); return n }) }
  }, [bundleTrees, loadingTrees])

  return (
    <div>
      <h3 className="text-sm font-medium mb-2 px-1">Line Items</h3>
      {lines.length === 0 ? (
        <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          No items configured yet. Click &quot;Add Offering&quot; to start.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {rootLines.map((line) => {
            const lineIdx = lines.indexOf(line)
            const isBundle = line.offeringType === 'bundle'
            const children = childrenByParent.get(line.lineId) ?? []
            const isExpanded = expandedLines.has(line.lineId)
            const bundleTree = isBundle && line.offeringId ? bundleTrees.get(line.offeringId) : undefined
            const treeLoading = isBundle && line.offeringId ? loadingTrees.has(line.offeringId) : false

            if (isBundle && isExpanded && line.offeringId && !bundleTree && !treeLoading) {
              fetchBundleTree(line.offeringId)
            }

            return (
              <div key={line.lineId}>
                <QuoteLineRow
                  line={line} lineIdx={lineIdx} currency={currency}
                  isExpanded={isExpanded}
                  pricingDetail={pricingDetail} isBundle={isBundle}
                  childCount={children.length} indent={0}
                  targetCodes={targetCodes}
                  onToggle={() => onToggleLine(line.lineId)}
                  onEdit={() => onEditLine(line)}
                  onRemove={() => onRemoveLine(line.lineId)}
                  onAddComponent={isBundle ? () => onAddComponent(line.lineId) : undefined}
                  onTogglePricingDetail={onTogglePricingDetail}
                />
                {/* Bundle structure: slots and child lines */}
                {isBundle && isExpanded && (
                  <BundleSlotPanel
                    bundleTree={bundleTree}
                    treeLoading={treeLoading}
                    children={children}
                    allLines={lines}
                    currency={currency}
                    expandedLines={expandedLines}
                    pricingDetail={pricingDetail}
                    parentLineId={line.lineId}
                    targetCodes={targetCodes}
                    onToggleLine={onToggleLine}
                    onEditLine={onEditLine}
                    onRemoveLine={onRemoveLine}
                    onAddComponent={onAddComponent}
                    onTogglePricingDetail={onTogglePricingDetail}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BundleSlotPanel({ bundleTree, treeLoading, children, allLines, currency, expandedLines, pricingDetail, parentLineId, targetCodes, onToggleLine, onEditLine, onRemoveLine, onAddComponent, onTogglePricingDetail }: {
  bundleTree: BundleTree | undefined; treeLoading: boolean
  children: QuoteLine[]; allLines: QuoteLine[]; currency: string
  expandedLines: Set<string>; pricingDetail: { lineIdx: number; chargeIdx: number } | null
  parentLineId: string
  targetCodes: Map<string, string>
  onToggleLine: (id: string) => void; onEditLine: (line: QuoteLine) => void
  onRemoveLine: (lineId: string) => void; onAddComponent: (parentLineId: string, offeringId?: string) => void
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
}) {
  if (treeLoading) {
    return (
      <div className="border-t bg-muted/5 px-8 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading bundle structure…</div>
      </div>
    )
  }

  if (!bundleTree || bundleTree.slots.length === 0) {
    if (children.length === 0) return null
    return (
      <div className="border-t bg-muted/5">
        {children.map((child) => {
          const childIdx = allLines.indexOf(child)
          return (
            <QuoteLineRow
              key={child.lineId}
              line={child} lineIdx={childIdx} currency={currency}
              isExpanded={expandedLines.has(child.lineId)}
              pricingDetail={pricingDetail} isBundle={false}
              childCount={0} indent={1}
              targetCodes={targetCodes}
              onToggle={() => onToggleLine(child.lineId)}
              onEdit={() => onEditLine(child)}
              onRemove={() => onRemoveLine(child.lineId)}
              onTogglePricingDetail={onTogglePricingDetail}
            />
          )
        })}
      </div>
    )
  }

  const childOfferingIds = new Set(children.map((c) => c.offeringId).filter(Boolean))

  return (
    <div className="border-t bg-muted/5">
      {bundleTree.slots.map((slot) => {
        const filledChildren = children.filter((c) =>
          slot.components.some((comp) => comp.childOffering.offeringId === c.offeringId),
        )
        const filledCount = filledChildren.length
        const isRequired = slot.cardinalityMin > 0
        const isFull = slot.cardinalityMax != null && filledCount >= slot.cardinalityMax
        const canAdd = !isFull

        return (
          <div key={slot.slotId} className="border-b last:border-b-0">
            {/* Slot header */}
            <div className="flex items-center gap-2 px-6 py-2 bg-muted/20">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{slot.name}</span>
              {isRequired ? (
                <Tag variant="warning" className="text-[10px] px-1.5">required</Tag>
              ) : (
                <Tag variant="neutral" className="text-[10px] px-1.5">optional</Tag>
              )}
              <span className="text-[10px] text-muted-foreground">
                {filledCount}/{slot.cardinalityMax ?? '∞'}
                {slot.cardinalityMin > 0 && ` (min ${slot.cardinalityMin})`}
              </span>
              <div className="flex-1" />
              {/* Available offerings in this slot */}
              <div className="flex items-center gap-1">
                {slot.components.map((comp) => {
                  const isFilled = childOfferingIds.has(comp.childOffering.offeringId)
                  return (
                    <button
                      key={comp.componentId}
                      onClick={() => !isFilled && canAdd && onAddComponent(parentLineId, comp.childOffering.offeringId)}
                      disabled={isFilled || !canAdd}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                        isFilled
                          ? 'border-status-success-border bg-status-success-bg text-status-success-text cursor-default'
                          : canAdd
                            ? 'border-border hover:border-primary hover:bg-primary/5 hover:text-primary cursor-pointer'
                            : 'border-border text-muted-foreground opacity-50 cursor-not-allowed'
                      }`}
                      title={isFilled ? 'Already added' : canAdd ? `Add ${comp.childOffering.offeringName}` : 'Slot is full'}
                    >
                      {isFilled ? (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      )}
                      {comp.childOffering.offeringName}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Filled child lines for this slot */}
            {filledChildren.map((child) => {
              const childIdx = allLines.indexOf(child)
              return (
                <QuoteLineRow
                  key={child.lineId}
                  line={child} lineIdx={childIdx} currency={currency}
                  isExpanded={expandedLines.has(child.lineId)}
                  pricingDetail={pricingDetail} isBundle={false}
                  childCount={0} indent={1}
                  targetCodes={targetCodes}
                  onToggle={() => onToggleLine(child.lineId)}
                  onEdit={() => onEditLine(child)}
                  onRemove={() => onRemoveLine(child.lineId)}
                  onTogglePricingDetail={onTogglePricingDetail}
                />
              )
            })}
          </div>
        )
      })}
      {/* Show any child lines not matching any slot */}
      {children.filter((c) => !bundleTree.slots.some((s) => s.components.some((comp) => comp.childOffering.offeringId === c.offeringId))).map((child) => {
        const childIdx = allLines.indexOf(child)
        return (
          <QuoteLineRow
            key={child.lineId}
            line={child} lineIdx={childIdx} currency={currency}
            isExpanded={expandedLines.has(child.lineId)}
            pricingDetail={pricingDetail} isBundle={false}
            childCount={0} indent={1}
            targetCodes={targetCodes}
            onToggle={() => onToggleLine(child.lineId)}
            onEdit={() => onEditLine(child)}
            onRemove={() => onRemoveLine(child.lineId)}
            onTogglePricingDetail={onTogglePricingDetail}
          />
        )
      })}
    </div>
  )
}

function QuoteLineRow({ line, lineIdx, currency, isExpanded, pricingDetail, isBundle, childCount, indent, targetCodes, onToggle, onEdit, onRemove, onAddComponent, onTogglePricingDetail }: {
  line: QuoteLine; lineIdx: number; currency: string; isExpanded: boolean
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  isBundle: boolean; childCount: number; indent: number
  targetCodes: Map<string, string>
  onToggle: () => void; onEdit: () => void; onRemove: () => void
  onAddComponent?: () => void
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
}) {
  const t = useT()
  const adjustmentUi = usePriceAdjustmentUi()
  const costsUi = useQuoteCostsUi()
  const lineCosts = costsUi?.costsFor(line.lineId) ?? []
  const removalUi = useArcLineRemovalUi()
  const isRemoved = removalUi?.isRemoved(line) ?? false
  const paddingLeft = indent > 0 ? `${indent * 2 + 1}rem` : undefined
  const chargeActions = {
    reasonLabels: adjustmentUi?.reasonLabels,
    // An unpriced cost-plus charge has no price to adjust.
    renderChargeActions: (charge: ResolvedCharge) => (charge.unitPrice === null ? null : <AdjustChargeAction line={line} charge={{ ...charge, unitPrice: charge.unitPrice }} />),
    renderManualActions: (adjustmentId: string) => <ManualAdjustmentActions adjustmentId={adjustmentId} />,
  }

  return (
    <div>
      <div className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${isRemoved ? 'bg-muted/20' : ''}`} style={paddingLeft ? { paddingLeft } : undefined} data-testid="cpq-quote-line" data-removed={isRemoved ? 'true' : undefined}>
        {/* Expand toggle */}
        <button onClick={onToggle} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
          <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Line info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {indent > 0 && (
              <span className="text-muted-foreground text-xs">└</span>
            )}
            {isBundle && (
              <Tag variant="brand" className="px-1.5 text-xs">bundle</Tag>
            )}
            <span className={`font-medium text-sm ${isRemoved ? 'text-muted-foreground line-through' : ''}`}>{line.offeringName}</span>
            {line.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{line.quantity}</span>}
            <LineActionBadge
              action={line.action}
              label={isRemoved ? t('cpq.quotes.arc.lineRemoved', 'remove') : undefined}
              title={isRemoved ? t('cpq.quotes.arc.lineRemovedHint', 'This item is cancelled on the subscription when the order is activated') : undefined}
            />
            {!isRemoved && line.configuration?._arcPriceFrozen === true && (
              <Tag
                variant="neutral"
                className="px-1.5 text-xs"
                title={t(
                  'cpq.quotes.arc.priceKeptHint',
                  'Price kept from the subscription — it changes only if you reconfigure this line',
                )}
              >
                {t('cpq.quotes.arc.priceKept', 'price kept')}
              </Tag>
            )}
            {targetCodes.size >= 2 && line.targetSubscriptionId && targetCodes.get(line.targetSubscriptionId) && (
              <Tag
                variant="brand"
                className="px-1.5 text-xs"
                title={`Acts on subscription ${targetCodes.get(line.targetSubscriptionId)}`}
              >
                → {targetCodes.get(line.targetSubscriptionId)}
              </Tag>
            )}
            {isRemoved ? null : line.isConfigured ? (
              <Tag variant="success" className="px-1.5 text-xs">configured</Tag>
            ) : (
              <Tag variant="warning" className="px-1.5 text-xs">incomplete</Tag>
            )}
            {isBundle && (
              <span className="text-xs text-muted-foreground">{childCount} component{childCount !== 1 ? 's' : ''}</span>
            )}
          </div>
          {line.validationErrors && line.validationErrors.length > 0 && (
            <p className="text-xs text-destructive mt-0.5">{line.validationErrors[0].message}</p>
          )}
        </div>

        {/* Pricing */}
        <div className="shrink-0 text-right text-xs space-y-0.5">
          {isRemoved && line.arcSource && line.arcSource.mrcAmount > 0 && (
            <div>
              <span className="text-muted-foreground">MRC </span>
              <span className="font-mono text-muted-foreground line-through">{fmt(line.arcSource.mrcAmount, currency)}</span>
            </div>
          )}
          {line.nrcTotal > 0 && <div><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(line.nrcTotal, currency)}</span></div>}
          {line.mrcTotal > 0 && <div><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(line.mrcTotal, currency)}</span></div>}
        </div>

        {/* Actions */}
        {isRemoved ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => removalUi?.restore(line.lineId)}
              title={t('cpq.quotes.arc.restoreHint', 'Keep this item on the subscription')}
              data-testid="cpq-line-restore"
            >
              <RotateCcw className="h-4 w-4" />
              {t('cpq.quotes.arc.restore', 'Restore')}
            </Button>
          </div>
        ) : (
        <div className="flex items-center gap-1 shrink-0">
          <DiscountLineAction line={line} />
          {onAddComponent && (
            <button onClick={onAddComponent} className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors" title="Add Component">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}
          <button onClick={onEdit} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          <button onClick={onRemove} className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remove">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
        )}
      </div>

      {/* Charge breakdown (non-bundle or any expanded line) */}
      {isExpanded && !isBundle && line.charges.length > 0 && (
        <ChargeBreakdown line={line} lineIdx={lineIdx} currency={currency} pricingDetail={pricingDetail} onTogglePricingDetail={onTogglePricingDetail} costs={lineCosts} {...chargeActions} />
      )}
      {/* For bundles: show own charges first, then children are rendered by parent */}
      {isExpanded && isBundle && line.charges.length > 0 && (
        <ChargeBreakdown line={line} lineIdx={lineIdx} currency={currency} pricingDetail={pricingDetail} onTogglePricingDetail={onTogglePricingDetail} costs={lineCosts} {...chargeActions} />
      )}
      {/* Cost-plus: the Costs sub-panel, for `cpq.costs.view` holders only. */}
      {isExpanded && costsUi?.canView && (
        <CostsPanel
          quoteId={costsUi.quoteId}
          lineId={line.lineId}
          lineName={line.offeringName}
          costs={lineCosts}
          locked={costsUi.locked}
          status={costsUi.cpqStatus}
          canManage={costsUi.canManage}
          headerActions={<CostHeaderActions line={{ lineId: line.lineId, lineName: line.offeringName }} />}
          renderRowActions={costsUi.actions ? (cost) => <CostRowActions cost={cost} line={{ lineId: line.lineId, lineName: line.offeringName }} /> : undefined}
        />
      )}
      {/* XD-250 ARC: before/after preview, below the charges, when line mirrors a sub item */}
      {isExpanded && line.arcSource && (
        <div className="border-t bg-muted/10 px-12 py-2">
          <ArcLineDiff line={line} currency={currency} />
        </div>
      )}
      {/* Fallback: line has no per-charge breakdown and no ARC diff (truly empty) */}
      {isExpanded && line.charges.length === 0 && !line.arcSource && (
        <LineSummaryFallback line={line} currency={currency} />
      )}
    </div>
  )
}

function LineSummaryFallback({ line, currency }: { line: QuoteLine; currency: string }) {
  const hasTotals = line.nrcTotal > 0 || line.mrcTotal > 0
  const mirroredFromItemId = (line.configuration?._arcMirroredFromItemId as string | undefined) ?? null
  return (
    <div className="border-t bg-muted/10 px-12 py-2 text-xs text-muted-foreground space-y-1">
      <div>
        No detailed charge breakdown available for this line.
        {mirroredFromItemId && ' Mirrored from existing subscription item.'}
      </div>
      {hasTotals && (
        <div className="flex gap-4">
          {line.nrcTotal > 0 && (
            <span>NRC <span className="font-mono font-medium text-foreground">{fmt(line.nrcTotal, currency)}</span></span>
          )}
          {line.mrcTotal > 0 && (
            <span>MRC <span className="font-mono font-medium text-foreground">{fmt(line.mrcTotal, currency)}</span></span>
          )}
        </div>
      )}
    </div>
  )
}

function ChargeBreakdown({ line, lineIdx, pricingDetail, onTogglePricingDetail, costs, ...tableProps }: {
  line: QuoteLine; lineIdx: number; currency: string
  /** Cost lines of this quote line (status badges for every user). */
  costs?: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired'>>
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
  reasonLabels?: Record<string, string>
  renderChargeActions?: (charge: ResolvedCharge) => React.ReactNode
  renderManualActions?: (adjustmentId: string) => React.ReactNode
}) {
  return (
    <div className="border-t bg-muted/10 px-12 py-2">
      {costs && <CostStatusBadges costs={costs} />}
      <ChargeBreakdownTable
        charges={line.charges}
        openDetailIndex={pricingDetail?.lineIdx === lineIdx ? pricingDetail.chargeIdx : null}
        onToggleDetail={(chargeIdx) => onTogglePricingDetail(lineIdx, chargeIdx)}
        {...tableProps}
      />
    </div>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <Alert variant="destructive" className="flex items-start gap-2">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-destructive/70 hover:text-destructive text-sm font-bold"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </Alert>
  )
}

function OfferingBrowser({ offerings, loading, search, onSearchChange, onSelect }: {
  offerings: Offering[]; loading: boolean; search: string; onSearchChange: (v: string) => void; onSelect: (o: Offering) => void
}) {
  const filtered = offerings.filter((o) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium px-1">Select Product Offering</h3>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input type="text" placeholder="Search offerings…" value={search} onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground"><Spinner /> Loading offerings…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">{search ? 'No offerings match your search.' : 'No active offerings available.'}</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((offering) => (
            <button key={offering.id} onClick={() => onSelect(offering)}
              className="rounded-lg border bg-card p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors group">
              <p className="text-sm font-medium group-hover:text-primary transition-colors">{offering.name}</p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{offering.code}</p>
              {offering.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{offering.description}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigurePanel({ title, attributes, config, quantity, arcTargetOptions, arcSelectedTargetIds, onArcTargetToggle, onConfigChange, onQuantityChange, onSubmit, submitLabel, submitting }: {
  title: string; attributes: ConstrainedAttribute[]; config: Record<string, unknown>; quantity: number
  arcTargetOptions: Array<{ subscriptionId: string; code: string; name: string | null }> | null
  arcSelectedTargetIds: string[]
  onArcTargetToggle: (subId: string) => void
  onConfigChange: (key: string, value: unknown) => void; onQuantityChange: (q: number) => void
  onSubmit: () => void; submitLabel: string; submitting: boolean
}) {
  const noTargetsPicked =
    arcTargetOptions !== null && arcTargetOptions.length > 0 && arcSelectedTargetIds.length === 0
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3"><h3 className="text-sm font-medium">{title}</h3></div>
      <div className="p-4 space-y-4">
        {arcTargetOptions && arcTargetOptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Apply to subscription(s)
              <span className="text-destructive ml-1">*</span>
            </label>
            <div className="space-y-1.5 rounded-md border bg-background px-3 py-2">
              {arcTargetOptions.map((opt) => {
                const checked = arcSelectedTargetIds.includes(opt.subscriptionId)
                return (
                  <label
                    key={opt.subscriptionId}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onArcTargetToggle(opt.subscriptionId)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="font-mono font-medium">{opt.code}</span>
                    {opt.name && <span className="text-muted-foreground">— {opt.name}</span>}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pick one or more — a separate line will be created on each selected subscription.
            </p>
            {noTargetsPicked && (
              <p className="text-xs text-destructive mt-1">Select at least one target.</p>
            )}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Quantity</label>
          <NumberInput
            integer
            min={1}
            value={quantity}
            onChange={(n) => onQuantityChange(Math.max(1, n ?? 1))}
            className="w-24"
          />
        </div>
        {attributes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No configurable attributes for this offering.</p>
        ) : (
          attributes.map((attr) => <AttributeField key={attr.code} attribute={attr} value={config[attr.code]} onChange={(v) => onConfigChange(attr.code, v)} />)
        )}
      </div>
      <div className="border-t px-4 py-3 flex justify-end">
        <button onClick={onSubmit} disabled={submitting || noTargetsPicked}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
          {submitting ? <Spinner /> : null} {submitLabel}
        </button>
      </div>
    </div>
  )
}

function AttributeField({ attribute, value, onChange }: { attribute: ConstrainedAttribute; value: unknown; onChange: (v: unknown) => void }) {
  const { code, name, attributeType, isRequired, options, constraints, helpText, defaultValue } = attribute
  const currentValue = value ?? defaultValue ?? ''

  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {name}{isRequired && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {(attributeType === 'select' || attributeType === 'enum') && options && options.length > 0 ? (
        <select value={String(currentValue)} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
          <option value="">— Select —</option>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : attributeType === 'boolean' ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={Boolean(currentValue)} onChange={(e) => onChange(e.target.checked)} className="rounded border-border" />
          <span className="text-sm text-muted-foreground">{helpText ?? 'Enable'}</span>
        </label>
      ) : attributeType === 'number' ? (
        <NumberInput
          value={
            typeof currentValue === 'number'
              ? currentValue
              : currentValue === '' || currentValue == null
                ? null
                : Number(currentValue)
          }
          min={(constraints as Record<string, unknown>)?.min as number | undefined}
          max={(constraints as Record<string, unknown>)?.max as number | undefined}
          onChange={(n) => onChange(n ?? '')}
        />
      ) : (
        <input type="text" value={String(currentValue)} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      )}
      {helpText && attributeType !== 'boolean' && <p className="text-xs text-muted-foreground mt-1">{helpText}</p>}
    </div>
  )
}
