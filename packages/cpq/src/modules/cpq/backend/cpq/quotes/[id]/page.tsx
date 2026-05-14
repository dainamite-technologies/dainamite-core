"use client"
import * as React from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import ArcQuoteConfigurator, {
  type AttachedTarget,
} from './_components/ArcQuoteConfigurator'
import { ArrowRight, Trash2 } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { NumberInput } from '../../../../components/NumberInput'
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
type RuleAdjustment = { ruleCode: string; ruleName: string; ruleType: string; value: number; unitPriceBefore: number; unitPriceAfter: number; delta: number }

type ResolvedCharge = {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod?: 'flat' | 'tiered' | 'per_unit'
  unitPrice: number
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  breakdown?: { tiers: TierBreakdownEntry[] } | null
  note?: string | null
  adjustments?: RuleAdjustment[] | null
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
  cpqStatus: string
  version: number
  currencyCode: string
  validationResult: { valid: boolean; errors: Array<{ message: string }> }
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number; note: string | null }>
    usageTotalEstimated: number | null
    currencyCode: string
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


const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  new: ['incomplete', 'ready', 'cancelled'],
  incomplete: ['ready', 'incomplete', 'cancelled'],
  ready: ['incomplete', 'in_approval', 'pre_approved', 'with_customer', 'cancelled'],
  in_approval: ['approved', 'rejected', 'cancelled'],
  pre_approved: ['with_customer'],
  approved: ['with_customer'],
  with_customer: ['accepted', 'rejected', 'cancelled'],
  accepted: [],
  rejected: [],
  cancelled: [],
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  incomplete: 'Incomplete',
  ready: 'Ready',
  in_approval: 'In Approval',
  pre_approved: 'Pre-Approved',
  approved: 'Approved',
  with_customer: 'With Customer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

const RULE_TYPE_LABELS: Record<string, string> = {
  discount_percent: '% discount',
  discount_absolute: 'fixed discount',
  surcharge_percent: '% surcharge',
  surcharge_absolute: 'fixed surcharge',
  price_override: 'override',
}

function fmtRuleValue(adj: RuleAdjustment, currency?: string): string {
  if (adj.ruleType === 'discount_percent' || adj.ruleType === 'surcharge_percent') return `${adj.value}%`
  if (currency) return fmt(adj.value, currency)
  return String(adj.value)
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`)
  return json as T
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CpqQuoteDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const searchParams = useSearchParams()
  const cpqConfigId = (props.params?.id ?? urlParams?.id) as string
  const isNew = cpqConfigId === 'new'

  const [cpqQuote, setCpqQuote] = React.useState<QuoteResult | null>(null)
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
  const [showStatusMenu, setShowStatusMenu] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [pricingDetail, setPricingDetail] = React.useState<{ lineIdx: number; chargeIdx: number } | null>(null)
  const statusMenuRef = React.useRef<HTMLDivElement>(null)

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

  React.useEffect(() => {
    if (!showStatusMenu) return
    const handler = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showStatusMenu])

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

  const removeItem = async (lineId: string) => {
    if (!cpqQuote) return
    try {
      setError(null)
      const result = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/items/${lineId}`, { method: 'DELETE' })
      setCpqQuote(result)
    } catch (err) { setError((err as Error).message) }
  }

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
    try {
      setTransitioning(true); setError(null); setShowStatusMenu(false)
      const result = await apiJson<QuoteResult>(`/api/cpq/quotes/${cpqQuote.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus }),
      })
      setCpqQuote(result)
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
    <div className="space-y-6">
      {arcDrawerOpen && (
        <ArcQuoteConfigurator
          quoteId={cpqQuote.id}
          customerId={cpqQuote.customerId}
          customerName={null}
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/backend/cpq/quotes')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
          <h1 className="text-2xl font-bold">Quote {cpqQuote.quoteNumber || cpqQuote.quoteId.slice(0, 8)}</h1>
          {arcQuoteType !== 'new' && (
            <Tag variant="brand" className="uppercase">{arcQuoteType}</Tag>
          )}
          <div className="relative" ref={statusMenuRef}>
            <button
              onClick={() => {
                const transitions = ALLOWED_TRANSITIONS[cpqQuote.cpqStatus] ?? []
                if (transitions.length > 0) setShowStatusMenu((v) => !v)
              }}
              disabled={transitioning}
              className={`inline-flex items-center gap-1 disabled:opacity-50 ${(ALLOWED_TRANSITIONS[cpqQuote.cpqStatus] ?? []).length > 0 ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full' : ''}`}
            >
              {transitioning ? <Spinner /> : null}
              <Tag variant={quoteCpqStatusMap[cpqQuote.cpqStatus as QuoteCpqStatus] ?? 'neutral'} dot>
                {formatStatusLabel(cpqQuote.cpqStatus)}
                {(ALLOWED_TRANSITIONS[cpqQuote.cpqStatus] ?? []).length > 0 && (
                  <svg className={`h-3 w-3 transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                )}
              </Tag>
            </button>
            {showStatusMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-md border bg-card shadow-lg py-1">
                <p className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Transition to:</p>
                {(ALLOWED_TRANSITIONS[cpqQuote.cpqStatus] ?? []).map((status) => (
                  <button
                    key={status}
                    onClick={() => transitionStatus(status)}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Tag variant={quoteCpqStatusMap[status as QuoteCpqStatus] ?? 'neutral'} dot>
                      {STATUS_LABELS[status] ?? formatStatusLabel(status)}
                    </Tag>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">v{cpqQuote.version} · {currency}</span>
          <button
            onClick={() => router.push(`/backend/sales/quotes/${cpqQuote.quoteId}`)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-2"
          >
            View Sales Quote
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {cpqQuote.cpqStatus === 'accepted' && (
            <Button type="button" onClick={convertToOrder} disabled={converting}>
              {converting ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
              Convert to Order
            </Button>
          )}
          {!['accepted', 'rejected', 'cancelled'].includes(cpqQuote.cpqStatus) && (
            <Button type="button" variant="destructive-outline" onClick={() => setShowDeleteConfirm(true)} disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          )}
          <button onClick={recalculate} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Recalculate
          </button>
          {view === 'summary' && (
            <button onClick={startAddOffering} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Offering
            </button>
          )}
          {view !== 'summary' && (
            <button onClick={() => { resetConfigState(); setView('summary') }} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
          )}
          {arcEditable && (
            <button
              onClick={() => setArcDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Modify subscription
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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
          {/* Pricing Summary Card */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-medium mb-3">Pricing Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Non-Recurring (NRC)</p>
                <p className="text-lg font-semibold font-mono">{fmt(summary.nrcTotal, currency)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monthly Recurring (MRC)</p>
                <p className="text-lg font-semibold font-mono">{fmt(summary.mrcTotal, currency)}</p>
              </div>
              {summary.usageTotalEstimated != null && (
                <div>
                  <p className="text-xs text-muted-foreground">Usage (est.)</p>
                  <p className="text-lg font-semibold font-mono">{fmt(summary.usageTotalEstimated, currency)}</p>
                </div>
              )}
              {summary.usageCharges.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Usage Charges</p>
                  {summary.usageCharges.map((uc, i) => (
                    <p key={i} className="text-xs mt-0.5">{uc.chargeName}: {fmt(uc.unitPrice, currency)}/unit</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Validation errors */}
          {!cpqQuote.validationResult.valid && (
            <Alert variant="warning">
              <AlertTitle>Validation Issues</AlertTitle>
              <AlertDescription>
                <ul className="text-xs space-y-0.5">
                  {cpqQuote.validationResult.errors.map((e, i) => <li key={i}>- {e.message}</li>)}
                </ul>
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
  const paddingLeft = indent > 0 ? `${indent * 2 + 1}rem` : undefined

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors" style={paddingLeft ? { paddingLeft } : undefined}>
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
            <span className="font-medium text-sm">{line.offeringName}</span>
            {line.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{line.quantity}</span>}
            <ActionBadge action={line.action} />
            {targetCodes.size >= 2 && line.targetSubscriptionId && targetCodes.get(line.targetSubscriptionId) && (
              <Tag
                variant="brand"
                className="px-1.5 text-xs"
                title={`Acts on subscription ${targetCodes.get(line.targetSubscriptionId)}`}
              >
                → {targetCodes.get(line.targetSubscriptionId)}
              </Tag>
            )}
            {line.isConfigured ? (
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
          {line.nrcTotal > 0 && <div><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(line.nrcTotal, currency)}</span></div>}
          {line.mrcTotal > 0 && <div><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(line.mrcTotal, currency)}</span></div>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
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
      </div>

      {/* XD-250 ARC: before/after preview when line mirrors a sub item */}
      {isExpanded && line.arcSource && (
        <ArcLineDiff line={line} currency={currency} />
      )}
      {/* Charge breakdown (non-bundle or any expanded line) */}
      {isExpanded && !isBundle && line.charges.length > 0 && (
        <ChargeBreakdown line={line} lineIdx={lineIdx} currency={currency} pricingDetail={pricingDetail} onTogglePricingDetail={onTogglePricingDetail} />
      )}
      {/* For bundles: show own charges first, then children are rendered by parent */}
      {isExpanded && isBundle && line.charges.length > 0 && (
        <ChargeBreakdown line={line} lineIdx={lineIdx} currency={currency} pricingDetail={pricingDetail} onTogglePricingDetail={onTogglePricingDetail} />
      )}
      {/* Fallback: line has no per-charge breakdown and no ARC diff (truly empty) */}
      {isExpanded && line.charges.length === 0 && !line.arcSource && (
        <LineSummaryFallback line={line} currency={currency} />
      )}
    </div>
  )
}

function ArcLineDiff({ line, currency }: { line: QuoteLine; currency: string }) {
  const src = line.arcSource
  if (!src) return null
  const isCancel = line.action === 'cancel'
  const beforeMrc = src.mrcAmount
  const beforeNrc = src.nrcAmount
  const beforeQty = src.quantity
  const afterMrc = isCancel ? 0 : line.mrcTotal
  const afterNrc = isCancel ? 0 : line.nrcTotal
  const afterQty = isCancel ? 0 : line.quantity
  const fmtVal = (v: number, asCurrency: boolean) =>
    asCurrency ? fmt(v, currency) : String(v)
  const rows: Array<{ label: string; before: number; after: number; asCurrency: boolean }> = [
    { label: 'Quantity', before: beforeQty, after: afterQty, asCurrency: false },
    { label: 'MRC', before: beforeMrc, after: afterMrc, asCurrency: true },
    { label: 'NRC', before: beforeNrc, after: afterNrc, asCurrency: true },
  ]

  return (
    <div className="border-t bg-muted/10 px-12 py-2 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Change Preview</p>
      <div className="rounded border bg-background overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium" />
              <th className="text-right px-3 py-1.5 font-medium">Before</th>
              <th className="text-right px-3 py-1.5 font-medium">After</th>
              <th className="text-right px-3 py-1.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.after - r.before
              const showDelta = delta !== 0
              return (
                <tr key={r.label} className="border-t border-dashed border-border/40">
                  <td className="px-3 py-1 text-muted-foreground">{r.label}</td>
                  <td className="px-3 py-1 text-right font-mono">{fmtVal(r.before, r.asCurrency)}</td>
                  <td className={`px-3 py-1 text-right font-mono ${isCancel ? 'text-muted-foreground line-through' : ''}`}>
                    {fmtVal(r.after, r.asCurrency)}
                  </td>
                  <td className={`px-3 py-1 text-right font-mono font-medium ${showDelta ? (delta > 0 ? 'text-status-success-text' : 'text-destructive') : 'text-muted-foreground'}`}>
                    {showDelta ? `${delta > 0 ? '+' : ''}${fmtVal(delta, r.asCurrency)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {isCancel && (
        <p className="text-xs text-destructive italic">Cancellation — item will be terminated on activation.</p>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: QuoteLineAction }) {
  const variantByAction: Record<QuoteLineAction, 'info' | 'warning' | 'error'> = {
    add: 'info',
    modify: 'warning',
    cancel: 'error',
  }
  return (
    <Tag variant={variantByAction[action]} className="px-1.5 text-xs">
      {action}
    </Tag>
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

function ChargeBreakdown({ line, lineIdx, currency, pricingDetail, onTogglePricingDetail }: {
  line: QuoteLine; lineIdx: number; currency: string
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
}) {
  return (
    <div className="border-t bg-muted/10 px-12 py-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-1 font-medium">Charge</th>
            <th className="text-left py-1 font-medium">Type</th>
            <th className="text-right py-1 font-medium">Unit Price</th>
            <th className="text-right py-1 font-medium">Qty</th>
            <th className="text-right py-1 font-medium">Total</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {line.charges.map((c, i) => {
            const hasDetail = !!(c.breakdown?.tiers?.length || c.adjustments?.length)
            const isDetailOpen = pricingDetail?.lineIdx === lineIdx && pricingDetail?.chargeIdx === i
            return (
              <React.Fragment key={i}>
                <tr className="border-t border-dashed border-border/50">
                  <td className="py-1">{c.chargeName}</td>
                  <td className="py-1 uppercase">{c.chargeType}</td>
                  <td className="py-1 text-right font-mono">{fmt(c.unitPrice, currency)}</td>
                  <td className="py-1 text-right font-mono">{c.quantity ?? '—'}</td>
                  <td className="py-1 text-right font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : c.note ?? '—'}</td>
                  <td className="py-1 text-center">
                    {hasDetail && (
                      <button
                        onClick={() => onTogglePricingDetail(lineIdx, i)}
                        className="inline-flex items-center justify-center rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Show pricing breakdown"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
                {isDetailOpen && (
                  <tr>
                    <td colSpan={6} className="pb-3 pt-1">
                      <div className="rounded border bg-background p-3 space-y-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">Pricing Details — {c.chargeName}</span>
                          <span className="text-muted-foreground">{c.pricingMethod ?? 'flat'}</span>
                        </div>

                        {c.breakdown?.tiers && c.breakdown.tiers.length > 0 && (
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">Tier Breakdown</div>
                            <table className="w-full">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left py-0.5 font-medium">Tier</th>
                                  <th className="text-right py-0.5 font-medium">Range</th>
                                  <th className="text-right py-0.5 font-medium">Price/Unit</th>
                                  <th className="text-right py-0.5 font-medium">Qty</th>
                                  <th className="text-right py-0.5 font-medium">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.breakdown.tiers.map((t) => (
                                  <tr key={t.tier} className="border-t border-border/30">
                                    <td className="py-0.5">{t.tier}</td>
                                    <td className="py-0.5 text-right font-mono">{t.from}–{t.to}</td>
                                    <td className="py-0.5 text-right font-mono">{fmt(t.pricePerUnit, currency)}</td>
                                    <td className="py-0.5 text-right font-mono">{t.quantity}</td>
                                    <td className="py-0.5 text-right font-mono">{fmt(t.subtotal, currency)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t font-medium">
                                  <td colSpan={4} className="py-0.5 text-right">Tiered Total</td>
                                  <td className="py-0.5 text-right font-mono">
                                    {fmt(c.breakdown.tiers.reduce((s, t) => s + t.subtotal, 0), currency)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}

                        {c.adjustments && c.adjustments.length > 0 && (
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">Applied Price Rules</div>
                            <table className="w-full">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left py-0.5 font-medium">Rule</th>
                                  <th className="text-left py-0.5 font-medium">Type</th>
                                  <th className="text-right py-0.5 font-medium">Value</th>
                                  <th className="text-right py-0.5 font-medium">Before</th>
                                  <th className="text-right py-0.5 font-medium">After</th>
                                  <th className="text-right py-0.5 font-medium">Delta</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.adjustments.map((adj, ai) => (
                                  <tr key={ai} className="border-t border-border/30">
                                    <td className="py-0.5">{adj.ruleName}</td>
                                    <td className="py-0.5">{RULE_TYPE_LABELS[adj.ruleType] ?? adj.ruleType}</td>
                                    <td className="py-0.5 text-right font-mono">{fmtRuleValue(adj, currency)}</td>
                                    <td className="py-0.5 text-right font-mono">{fmt(adj.unitPriceBefore, currency)}</td>
                                    <td className="py-0.5 text-right font-mono">{fmt(adj.unitPriceAfter, currency)}</td>
                                    <td className={`py-0.5 text-right font-mono ${adj.delta < 0 ? 'text-destructive' : adj.delta > 0 ? 'text-status-success-text' : ''}`}>
                                      {adj.delta > 0 ? '+' : ''}{fmt(adj.delta, currency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 border-t text-sm font-semibold">
                          <span>Final Total</span>
                          <span className="font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : '—'}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
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
