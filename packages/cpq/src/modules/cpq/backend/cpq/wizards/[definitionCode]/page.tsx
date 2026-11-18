"use client"
import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { WizardRunner } from '../../../../workflows/WizardRunner'
import { registerBuiltInStepTypes } from '../../../../workflows/steps'
import type { WizardDefinitionResult } from '../../../../workflows/types'

// Register built-in step types once on module load
registerBuiltInStepTypes()

async function apiJson<T>(url: string, t: TranslateFn): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(t('cpq.wizards.runner.errors.api', 'API error {status}', { status: res.status }))
  return res.json() as Promise<T>
}

// ─── Params form shown before starting a wizard with required params ──

type ParamsSchema = {
  type?: string
  required?: string[]
  properties?: Record<string, { type?: string; format?: string; description?: string }>
}

function ParamsForm({
  schema,
  onStart,
}: {
  schema: ParamsSchema
  onStart: (params: Record<string, string>) => void
}) {
  const t = useT()
  const properties = schema.properties ?? {}
  const requiredFields = schema.required ?? []
  const fieldNames = Object.keys(properties)

  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const key of fieldNames) init[key] = ''
    return init
  })

  const isValid = requiredFields.every((key) => values[key]?.trim())

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
        <h4 className="text-sm font-medium">{t('cpq.wizards.runner.params.title', 'This wizard requires input parameters')}</h4>
        <p className="text-xs text-muted-foreground">{t('cpq.wizards.runner.params.hint', 'Fill in the required fields before starting.')}</p>
      </div>

      <div className="space-y-3">
        {fieldNames.map((key) => {
          const prop = properties[key]
          const isRequired = requiredFields.includes(key)
          return (
            <div key={key}>
              <label className="block text-sm font-medium mb-1">
                {prop?.description || key}
                {isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={prop?.format === 'uuid' ? 'UUID' : key}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono"
              />
              {prop?.format && (
                <p className="text-xs text-muted-foreground mt-0.5">{t('cpq.wizards.runner.params.format', 'Format: {format}', { format: prop.format })}</p>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => onStart(values)}
        disabled={!isValid}
        className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('cpq.wizards.runner.params.start', 'Preview Wizard')}
      </button>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────

export default function CpqWizardRunnerPage({ params }: { params: Record<string, string | string[]> }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const definitionCode = params.definitionCode as string

  const [definition, setDefinition] = React.useState<WizardDefinitionResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [started, setStarted] = React.useState(false)

  // Parse launch params from query string
  const queryParams = React.useMemo(() => {
    const raw = searchParams.get('params')
    if (!raw) return {}
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }, [searchParams])

  const [launchParams, setLaunchParams] = React.useState<Record<string, unknown>>(queryParams)

  React.useEffect(() => {
    async function load() {
      if (!definitionCode || definitionCode === 'undefined') {
        setError(t('cpq.wizards.runner.errors.invalidCode', 'Invalid wizard definition code'))
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const def = await apiJson<WizardDefinitionResult>(
          `/api/cpq/wizards?code=${encodeURIComponent(definitionCode)}`,
          t,
        )
        setDefinition(def)

        // Auto-start if params were provided via query string or wizard has no required params
        const schema = def.paramsSchema as ParamsSchema | null
        const hasRequiredParams = schema?.required?.length
        if (!hasRequiredParams || Object.keys(queryParams).length > 0) {
          setStarted(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('cpq.wizards.runner.errors.load', 'Failed to load wizard'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [definitionCode, queryParams, t])

  const handleComplete = React.useCallback((stepData: Record<string, Record<string, unknown>>) => {
    // Check for orderId first (e.g. purchasing wizard creates an order)
    let orderId: string | undefined
    let quoteId: string | undefined
    for (const data of Object.values(stepData)) {
      if (data.orderId && !orderId) orderId = data.orderId as string
      if (data.quoteId && !quoteId) quoteId = data.quoteId as string
    }
    if (orderId) {
      router.push(`/backend/cpq/orders/${orderId}`)
    } else if (quoteId) {
      router.push(`/backend/cpq/quotes/${quoteId}`)
    } else {
      router.push('/backend/cpq/wizards')
    }
  }, [router])

  const handleParamsSubmit = React.useCallback((params: Record<string, string>) => {
    setLaunchParams(params)
    setStarted(true)
  }, [])

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('cpq.wizards.runner.loading', 'Loading wizard...')}</div>
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">{error}</Alert>
        <button
          type="button"
          onClick={() => router.push('/backend/cpq/wizards')}
          className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t('cpq.wizards.runner.backToList', 'Back to Wizards')}
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

  // Extract scope from auth context (will be provided by the framework at runtime)
  // For now, use empty strings — the API routes resolve scope from the auth session
  const scope = { organizationId: '', tenantId: '' }

  return (
    <div className="space-y-4 max-w-[900px] mx-auto">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/backend/cpq/wizards')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('cpq.wizards.runner.allWizards', 'All Wizards')}
        </button>
      </div>

      {!started ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{definition.name}</h2>
            {definition.description && (
              <p className="text-sm text-muted-foreground mt-1">{definition.description}</p>
            )}
          </div>
          <ParamsForm
            schema={(definition.paramsSchema as ParamsSchema) ?? {}}
            onStart={handleParamsSubmit}
          />
        </div>
      ) : (
        <WizardRunner
          definition={definition}
          params={launchParams}
          initialQuoteId={launchParams.quoteId as string | undefined}
          initialCustomerId={launchParams.customerId as string | undefined}
          scope={scope}
          onComplete={handleComplete}
        />
      )}
    </div>
  )
}
