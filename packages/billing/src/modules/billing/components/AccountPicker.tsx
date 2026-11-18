"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Billing account picker (search + select), bounded to 50 results per query.
 * `currencyCode` / `billingMode` narrow the candidates client-side (payments
 * can only go to an account of the same currency; top-ups only to prepaid).
 */

export type AccountChoice = { id: string; name: string; currency_code: string; billing_mode: string }

export function AccountPicker({
  value,
  onChange,
  currencyCode,
  billingMode,
}: {
  value: string
  onChange: (id: string) => void
  currencyCode?: string
  billingMode?: 'postpaid' | 'prepaid'
}) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [options, setOptions] = React.useState<AccountChoice[]>([])

  React.useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: '50' })
      if (search.trim()) params.set('search', search.trim())
      if (billingMode) params.set('billingMode', billingMode)
      void apiCall<{ items: AccountChoice[] }>(`/api/billing/accounts?${params.toString()}`).then((call) => {
        if (cancelled) return
        const items = call.ok ? (call.result?.items ?? []) : []
        setOptions(currencyCode ? items.filter((a) => a.currency_code === currencyCode) : items)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [billingMode, currencyCode, search])

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={search}
        placeholder={t('billing.payments.account_picker.search', 'Search accounts…')}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t('billing.payments.account_picker.placeholder', 'Select an account')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name} · {option.currency_code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
