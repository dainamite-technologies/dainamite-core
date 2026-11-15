"use client"
import * as React from 'react'
import { useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type DetailTab = {
  id: string
  label: string
  render: () => React.ReactNode
}

type InjectedDetailTabsProps<TContext, TData> = {
  /** Injection spot whose `kind: 'tab'` widgets become extra tabs. */
  spotId: string
  /** The page's own tabs. The first one is selected by default. */
  baseTabs: DetailTab[]
  context: TContext
  data: TData
  onDataChange?: (next: TData) => void
  ariaLabel: string
}

/**
 * A detail-page body that other modules can extend with tabs.
 *
 * Widgets mapped to `spotId` with `kind: 'tab'` are appended after the
 * page's own tabs (sorted by placement priority, highest first). When no
 * widget is injected and the page has a single tab, the tab strip is not
 * rendered at all: the page looks exactly as it does without extensions.
 */
export function InjectedDetailTabs<TContext, TData>({
  spotId,
  baseTabs,
  context,
  data,
  onDataChange,
  ariaLabel,
}: InjectedDetailTabsProps<TContext, TData>) {
  const t = useT()
  const { widgets } = useInjectionWidgets(spotId, { context, triggerOnLoad: true })

  const injectedTabs = React.useMemo<DetailTab[]>(
    () =>
      (widgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => ({
          widget,
          priority: typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0,
        }))
        .sort((a, b) => b.priority - a.priority)
        .map(({ widget }) => ({
          id: widget.placement?.groupId ?? widget.widgetId,
          label: widget.placement?.groupLabel
            ? t(widget.placement.groupLabel, widget.module.metadata.title ?? widget.widgetId)
            : (widget.module.metadata.title ?? widget.widgetId),
          render: () => (
            <widget.module.Widget
              context={context}
              data={data}
              onDataChange={onDataChange ? (next: unknown) => onDataChange(next as TData) : undefined}
            />
          ),
        })),
    [widgets, context, data, onDataChange, t],
  )

  const tabs = React.useMemo(() => [...baseTabs, ...injectedTabs], [baseTabs, injectedTabs])
  const [active, setActive] = React.useState<string>(baseTabs[0]?.id ?? '')
  const activeId = tabs.some((tab) => tab.id === active) ? active : (tabs[0]?.id ?? '')

  if (tabs.length === 0) return null
  if (tabs.length === 1) return <>{tabs[0].render()}</>

  return (
    <Tabs value={activeId} onValueChange={setActive} variant="underline">
      <TabsList aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="pt-4">
          {tab.render()}
        </TabsContent>
      ))}
    </Tabs>
  )
}
