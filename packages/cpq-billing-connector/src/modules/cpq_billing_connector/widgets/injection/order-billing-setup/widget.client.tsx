"use client"
import * as React from 'react'
import Link from 'next/link'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { OrderSetupView } from '../../../services/orderSetupService'
import {
  buildUpsertBody,
  initialFormState,
  toAccountOptions,
  validateForm,
  type AccountOption,
  type FormIssue,
  type OrderSetupFormState,
} from '../../../lib/orderSetupForm'
import { isArcQuoteType } from '../../../lib/orderSetupResolution'
import { AccountSection } from '../../../components/orderSetup/AccountSection'
import { BillStartSection } from '../../../components/orderSetup/BillStartSection'

/** What `@dainamite/cpq` passes as context to `cpq.order.detail:tabs` widgets. */
type OrderContext = {
  orderId: string
  cpqStatus: string
  customerId: string
  currencyCode: string
}

type Loaded = {
  view: OrderSetupView
  candidates: AccountOption[]
  canListAccounts: boolean
}

const ISSUE_MESSAGES: Record<FormIssue, [string, string]> = {
  accountRequired: ['cpq_billing_connector.orderSetup.issues.accountRequired', 'Select a billing account.'],
  nameRequired: ['cpq_billing_connector.orderSetup.issues.nameRequired', 'The account name is required.'],
  emailInvalid: ['cpq_billing_connector.orderSetup.issues.emailInvalid', 'The invoice email is not valid.'],
  addressIncomplete: [
    'cpq_billing_connector.orderSetup.issues.addressIncomplete',
    'An address needs line 1, city, postal code and country.',
  ],
}

async function loadSetup(context: OrderContext): Promise<Loaded> {
  const viewCall = await apiCallOrThrow<OrderSetupView>(
    `/api/cpq_billing_connector/order-setups/${context.orderId}`,
  )
  const view = viewCall.result as OrderSetupView
  // Amend / renew orders bill to the subscription's account — no account choice.
  if (isArcQuoteType(view.quoteType)) return { view, candidates: [], canListAccounts: true }
  const query = new URLSearchParams({
    customerId: context.customerId,
    currencyCode: context.currencyCode,
    isActive: 'true',
    pageSize: '50',
  })
  const accountsCall = await apiCall<unknown>(`/api/billing/accounts?${query.toString()}`)
  return {
    view,
    candidates: accountsCall.ok ? toAccountOptions(accountsCall.result, context) : [],
    canListAccounts: accountsCall.status !== 403,
  }
}

export default function OrderBillingSetupWidget({ context }: InjectionWidgetComponentProps<OrderContext, unknown>) {
  const t = useT()
  const orderContext = context as OrderContext | undefined
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [state, setState] = React.useState<OrderSetupFormState | null>(null)
  const [initial, setInitial] = React.useState<string>('')
  const [saving, setSaving] = React.useState(false)
  const [issues, setIssues] = React.useState<FormIssue[]>([])
  const { runMutation } = useGuardedMutation<{ orderId: string }>({ contextId: 'cpq-billing-order-setup' })

  const orderId = orderContext?.orderId
  const cpqStatus = orderContext?.cpqStatus

  const reload = React.useCallback(async () => {
    if (!orderContext?.orderId) return
    try {
      setError(null)
      const next = await loadSetup(orderContext)
      const nextState = initialFormState(next.view, next.candidates)
      setLoaded(next)
      setState(nextState)
      setInitial(JSON.stringify(nextState))
      setIssues([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // The order status changes on activation — reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, cpqStatus])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const save = React.useCallback(async () => {
    if (!loaded || !state || !orderId || saving) return
    const found = validateForm(state, loaded.view.quoteType)
    setIssues(found)
    if (found.length > 0) return
    const body = buildUpsertBody(state, loaded.view)
    setSaving(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(`/api/cpq_billing_connector/order-setups/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        context: { orderId },
        mutationPayload: body as unknown as Record<string, unknown>,
      })
      flash(t('cpq_billing_connector.orderSetup.saved', 'Billing setup saved'), 'success')
      await reload()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('cpq_billing_connector.orderSetup.saveFailed', 'Saving failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [loaded, state, orderId, saving, runMutation, reload, t])

  if (!orderContext?.orderId) return null
  if (error) {
    return (
      <ErrorMessage
        label={t('cpq_billing_connector.orderSetup.loadFailed', 'Could not load the billing setup')}
        description={error}
      />
    )
  }
  if (!loaded || !state) {
    return <LoadingMessage label={t('cpq_billing_connector.orderSetup.loading', 'Loading billing setup…')} />
  }

  const { view } = loaded
  const applied = view.setup?.appliedAt ? view.setup : null

  const arc = isArcQuoteType(view.quoteType)
  if (view.quoteType !== 'new' && !arc) {
    return (
      <Alert status="information">
        <AlertDescription>
          {t('cpq_billing_connector.orderSetup.nothingToBill', 'This order adds nothing to bill.')}
        </AlertDescription>
      </Alert>
    )
  }

  if (applied || !view.editable) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
        {applied?.appliedBillingAccountId ? (
          <p>
            {t('cpq_billing_connector.orderSetup.applied', 'Billing for this order was set up at activation.')}{' '}
            <Link className="font-medium text-primary underline" href={`/backend/billing/accounts/${applied.appliedBillingAccountId}`}>
              {t('cpq_billing_connector.orderSetup.openAccount', 'Open billing account')}
            </Link>
          </p>
        ) : (
          <p className="text-muted-foreground">
            {t(
              'cpq_billing_connector.orderSetup.notApplied',
              'The billing setup can no longer be changed. Billing is created shortly after activation.',
            )}
          </p>
        )}
      </div>
    )
  }

  const dirty = JSON.stringify(state) !== initial
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void save()
    }
  }

  return (
    <div className="space-y-4" onKeyDown={onKeyDown}>
      {arc ? (
        <Alert status="information">
          <AlertDescription>
            {t(
              'cpq_billing_connector.orderSetup.arcAccount',
              'Added lines bill to the subscription’s existing billing account. Set when billing of each added line starts.',
            )}
          </AlertDescription>
        </Alert>
      ) : (
        !view.setup && (
          <Alert status="information">
            <AlertDescription>
              {t(
                'cpq_billing_connector.orderSetup.usingDefaults',
                'Not saved yet: billing will use the customer’s data and the activation date.',
              )}
            </AlertDescription>
          </Alert>
        )
      )}
      {issues.length > 0 && (
        <Alert status="error">
          <AlertDescription>
            {issues.map((issue) => t(ISSUE_MESSAGES[issue][0], ISSUE_MESSAGES[issue][1])).join(' ')}
          </AlertDescription>
        </Alert>
      )}
      {!arc && (
        <AccountSection
          state={state}
          candidates={loaded.candidates}
          canListAccounts={loaded.canListAccounts}
          disabled={saving}
          onChange={setState}
        />
      )}
      <BillStartSection
        state={state}
        lines={view.defaults.lines}
        disabled={saving}
        onChange={setState}
        fallback={
          view.quoteType === 'renew'
            ? {
                label: t('cpq_billing_connector.orderSetup.billStart.onRenewal', 'At the new term start'),
                hint: t('cpq_billing_connector.orderSetup.billStart.defaultHintRenew', 'Empty = the new term start.'),
              }
            : view.quoteType === 'amend'
              ? {
                  label: t('cpq_billing_connector.orderSetup.billStart.onEffectiveDate', 'On the effective date'),
                  hint: t('cpq_billing_connector.orderSetup.billStart.defaultHintAmend', 'Empty = the date the change takes effect.'),
                }
              : undefined
        }
      />
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <span className="text-xs text-muted-foreground">
            {t('cpq_billing_connector.orderSetup.unsaved', 'Unsaved changes')}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={saving || !dirty}
          onClick={() => {
            setState(JSON.parse(initial) as OrderSetupFormState)
            setIssues([])
          }}
        >
          {t('cpq_billing_connector.orderSetup.reset', 'Reset')}
        </Button>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving
            ? t('cpq_billing_connector.orderSetup.saving', 'Saving…')
            : t('cpq_billing_connector.orderSetup.save', 'Save billing setup')}
        </Button>
      </div>
    </div>
  )
}
