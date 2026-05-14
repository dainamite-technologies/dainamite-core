"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type {
  WizardDefinitionResult,
  WizardStepDefinition,
  WizardTransition,
  WizardApplicability,
} from '../../../../../workflows/types'

async function apiJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<T>
}

// ─── Sub-components ──────────────────────────────────────────────

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'muted' }) {
  const tagVariant = variant === 'success' ? 'success' : variant === 'muted' ? 'neutral' : 'info'
  return <Tag variant={tagVariant}>{children}</Tag>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </div>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function JsonBlock({ data }: { data: unknown }) {
  if (data == null) return <span className="text-xs text-muted-foreground">none</span>
  return (
    <pre className="rounded-md bg-muted/50 p-3 text-xs overflow-x-auto max-h-48">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function TransitionRow({ t, index }: { t: WizardTransition; index: number }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="font-mono text-muted-foreground w-4 shrink-0">{index + 1}.</span>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">-&gt; {t.targetStepId}</span>
          {t.isDefault && <Badge variant="muted">default</Badge>}
          {t.label && <span className="text-muted-foreground">({t.label})</span>}
        </div>
        {t.condition && (
          <div className="font-mono text-muted-foreground">
            when {t.condition.field} {t.condition.operator}
            {t.condition.value !== undefined ? ` ${JSON.stringify(t.condition.value)}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({ step, index }: { step: WizardStepDefinition; index: number }) {
  const [open, setOpen] = React.useState(false)
  const configKeys = Object.keys(step.config)

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold w-7 h-7 shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{step.title}</span>
            <Badge>{step.type}</Badge>
            {step.isOptional && <Badge variant="muted">optional</Badge>}
          </div>
          {step.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{step.description}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <KV label="Step ID"><span className="font-mono text-xs">{step.stepId}</span></KV>
            <KV label="Type"><span className="font-mono text-xs">{step.type}</span></KV>
          </div>

          {configKeys.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Config</span>
              <JsonBlock data={step.config} />
            </div>
          )}

          {step.transitions.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Transitions ({step.transitions.length})
              </span>
              <div className="space-y-1.5">
                {step.transitions.map((t, i) => (
                  <TransitionRow key={`${t.targetStepId}-${i}`} t={t} index={i} />
                ))}
              </div>
            </div>
          )}

          {step.transitions.length === 0 && (
            <div className="text-xs text-muted-foreground">No transitions (terminal step)</div>
          )}

          {step.validationRules && step.validationRules.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Validation Rules</span>
              <JsonBlock data={step.validationRules} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApplicabilityPanel({ applicability }: { applicability: WizardApplicability | null }) {
  if (!applicability) {
    return <span className="text-sm text-muted-foreground">No applicability constraints</span>
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      {applicability.priority != null && (
        <KV label="Priority">{applicability.priority}</KV>
      )}
      {applicability.specCodes?.length ? (
        <KV label="Spec Codes">
          <div className="flex flex-wrap gap-1">
            {applicability.specCodes.map((c) => (
              <span key={c} className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </KV>
      ) : null}
      {applicability.offeringCodes?.length ? (
        <KV label="Offering Codes">
          <div className="flex flex-wrap gap-1">
            {applicability.offeringCodes.map((c) => (
              <span key={c} className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </KV>
      ) : null}
      {applicability.customerSegments?.length ? (
        <KV label="Customer Segments">
          <div className="flex flex-wrap gap-1">
            {applicability.customerSegments.map((c) => (
              <span key={c} className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </KV>
      ) : null}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CpqWizardDetailPage({ params }: { params: Record<string, string | string[]> }) {
  const router = useRouter()
  const definitionCode = params.definitionCode as string

  const [definition, setDefinition] = React.useState<WizardDefinitionResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      if (!definitionCode) return
      setLoading(true)
      setError(null)
      try {
        const def = await apiJson<WizardDefinitionResult>(
          `/api/cpq/wizards?code=${encodeURIComponent(definitionCode)}`,
        )
        setDefinition(def)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load wizard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [definitionCode])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">{error}</Alert>
        <button type="button" onClick={() => router.push('/backend/cpq/wizards')} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Wizards
        </button>
      </div>
    )
  }

  if (!definition) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        Wizard not found.
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/backend/cpq/wizards')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; All Wizards
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{definition.name}</h1>
          {definition.description && (
            <p className="text-sm text-muted-foreground mt-1">{definition.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => router.push(`/backend/cpq/wizards/${definitionCode}`)}
            disabled={!definition.isActive}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Wizard
          </button>
        </div>
      </div>

      {/* General Info */}
      <Section title="General">
        <div className="rounded-lg border p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KV label="Code"><span className="font-mono text-xs">{definition.code}</span></KV>
            <KV label="Version">v{definition.version}</KV>
            <KV label="Surface">{definition.surface}</KV>
            <KV label="Active">
              <Badge variant={definition.isActive ? 'success' : 'muted'}>
                {definition.isActive ? 'Yes' : 'No'}
              </Badge>
            </KV>
          </div>
        </div>
      </Section>

      {/* Applicability */}
      <Section title="Applicability">
        <div className="rounded-lg border p-4">
          <ApplicabilityPanel applicability={definition.applicability} />
        </div>
      </Section>

      {/* Params Schema */}
      {definition.paramsSchema && Object.keys(definition.paramsSchema).length > 0 && (
        <Section title="Parameters Schema">
          <JsonBlock data={definition.paramsSchema} />
        </Section>
      )}

      {/* Steps */}
      <Section title={`Steps (${definition.steps.length})`}>
        <div className="space-y-2">
          {definition.steps.map((step, i) => (
            <StepCard key={step.stepId} step={step} index={i} />
          ))}
        </div>
      </Section>

      {/* Metadata */}
      {definition.metadata && Object.keys(definition.metadata).length > 0 && (
        <Section title="Metadata">
          <JsonBlock data={definition.metadata} />
        </Section>
      )}
    </div>
  )
}
