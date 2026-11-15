"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type {
  WizardDefinitionResult,
  WizardStepDefinition,
  WizardTransition,
  WizardApplicability,
} from '../../../../../workflows/types'

async function apiJson<T>(url: string, t: TranslateFn): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(t('cpq.wizards.runner.errors.api', 'API error {status}', { status: res.status }))
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
  const t = useT()
  if (data == null) return <span className="text-xs text-muted-foreground">{t('cpq.wizards.detail.none', 'none')}</span>
  return (
    <pre className="rounded-md bg-muted/50 p-3 text-xs overflow-x-auto max-h-48">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function TransitionRow({ transition, index }: { transition: WizardTransition; index: number }) {
  const t = useT()
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="font-mono text-muted-foreground w-4 shrink-0">{index + 1}.</span>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{'->'} {transition.targetStepId}</span>
          {transition.isDefault && <Badge variant="muted">{t('cpq.wizards.detail.transitionDefault', 'default')}</Badge>}
          {transition.label && <span className="text-muted-foreground">({transition.label})</span>}
        </div>
        {transition.condition && (
          <div className="font-mono text-muted-foreground">
            {t('cpq.wizards.detail.transitionWhen', 'when {field} {operator}', {
              field: transition.condition.field,
              operator: transition.condition.operator,
            })}
            {transition.condition.value !== undefined ? ` ${JSON.stringify(transition.condition.value)}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({ step, index }: { step: WizardStepDefinition; index: number }) {
  const t = useT()
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
            {step.isOptional && <Badge variant="muted">{t('cpq.wizards.detail.optional', 'optional')}</Badge>}
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
            <KV label={t('cpq.wizards.detail.stepId', 'Step ID')}><span className="font-mono text-xs">{step.stepId}</span></KV>
            <KV label={t('cpq.wizards.detail.type', 'Type')}><span className="font-mono text-xs">{step.type}</span></KV>
          </div>

          {configKeys.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('cpq.wizards.detail.config', 'Config')}</span>
              <JsonBlock data={step.config} />
            </div>
          )}

          {step.transitions.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('cpq.wizards.detail.transitions', 'Transitions ({count})', { count: step.transitions.length })}
              </span>
              <div className="space-y-1.5">
                {step.transitions.map((transition, i) => (
                  <TransitionRow key={`${transition.targetStepId}-${i}`} transition={transition} index={i} />
                ))}
              </div>
            </div>
          )}

          {step.transitions.length === 0 && (
            <div className="text-xs text-muted-foreground">{t('cpq.wizards.detail.noTransitions', 'No transitions (terminal step)')}</div>
          )}

          {step.validationRules && step.validationRules.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('cpq.wizards.detail.validationRules', 'Validation Rules')}</span>
              <JsonBlock data={step.validationRules} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApplicabilityPanel({ applicability }: { applicability: WizardApplicability | null }) {
  const t = useT()
  if (!applicability) {
    return <span className="text-sm text-muted-foreground">{t('cpq.wizards.detail.noApplicability', 'No applicability constraints')}</span>
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      {applicability.priority != null && (
        <KV label={t('cpq.wizards.detail.priority', 'Priority')}>{applicability.priority}</KV>
      )}
      {applicability.specCodes?.length ? (
        <KV label={t('cpq.wizards.detail.specCodes', 'Spec Codes')}>
          <div className="flex flex-wrap gap-1">
            {applicability.specCodes.map((c) => (
              <span key={c} className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </KV>
      ) : null}
      {applicability.offeringCodes?.length ? (
        <KV label={t('cpq.wizards.detail.offeringCodes', 'Offering Codes')}>
          <div className="flex flex-wrap gap-1">
            {applicability.offeringCodes.map((c) => (
              <span key={c} className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </KV>
      ) : null}
      {applicability.customerSegments?.length ? (
        <KV label={t('cpq.wizards.detail.customerSegments', 'Customer Segments')}>
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
  const t = useT()
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
          t,
        )
        setDefinition(def)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('cpq.wizards.runner.errors.load', 'Failed to load wizard'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [definitionCode, t])

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('cpq.common.loading', 'Loading...')}</div>
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">{error}</Alert>
        <button type="button" onClick={() => router.push('/backend/cpq/wizards')} className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('cpq.wizards.runner.backToList', 'Back to Wizards')}
        </button>
      </div>
    )
  }

  if (!definition) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        {t('cpq.wizards.runner.notFound', 'Wizard not found.')}
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
          ← {t('cpq.wizards.runner.allWizards', 'All Wizards')}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{definition.name}</h1>
          {definition.description && (
            <p className="text-sm text-muted-foreground mt-1">{definition.description}</p>
          )}
        </div>
        {/* Actions live in a 3-dot menu — wizards are read-only in admin UI
            for the time being, so only `Preview` is exposed. */}
        <div className="shrink-0">
          <RowActions
            items={[
              {
                id: 'preview',
                label: t('cpq.wizards.actions.preview', 'Preview'),
                onSelect: () => router.push(`/backend/cpq/wizards/${definitionCode}`),
              },
            ]}
          />
        </div>
      </div>

      {/* General Info */}
      <Section title={t('cpq.wizards.detail.sections.general', 'General')}>
        <div className="rounded-lg border p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KV label={t('cpq.wizards.detail.code', 'Code')}><span className="font-mono text-xs">{definition.code}</span></KV>
            <KV label={t('cpq.wizards.detail.version', 'Version')}>v{definition.version}</KV>
            <KV label={t('cpq.wizards.detail.surface', 'Surface')}>{definition.surface}</KV>
            <KV label={t('cpq.wizards.detail.active', 'Active')}>
              <Badge variant={definition.isActive ? 'success' : 'muted'}>
                {definition.isActive ? t('cpq.common.yes', 'Yes') : t('cpq.common.no', 'No')}
              </Badge>
            </KV>
          </div>
        </div>
      </Section>

      {/* Applicability */}
      <Section title={t('cpq.wizards.detail.sections.applicability', 'Applicability')}>
        <div className="rounded-lg border p-4">
          <ApplicabilityPanel applicability={definition.applicability} />
        </div>
      </Section>

      {/* Params Schema */}
      {definition.paramsSchema && Object.keys(definition.paramsSchema).length > 0 && (
        <Section title={t('cpq.wizards.detail.sections.paramsSchema', 'Parameters Schema')}>
          <JsonBlock data={definition.paramsSchema} />
        </Section>
      )}

      {/* Steps */}
      <Section title={t('cpq.wizards.detail.sections.steps', 'Steps ({count})', { count: definition.steps.length })}>
        <div className="space-y-2">
          {definition.steps.map((step, i) => (
            <StepCard key={step.stepId} step={step} index={i} />
          ))}
        </div>
      </Section>

      {/* Metadata */}
      {definition.metadata && Object.keys(definition.metadata).length > 0 && (
        <Section title={t('cpq.wizards.detail.sections.metadata', 'Metadata')}>
          <JsonBlock data={definition.metadata} />
        </Section>
      )}
    </div>
  )
}
