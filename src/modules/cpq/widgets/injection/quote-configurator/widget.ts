import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import QuoteConfiguratorWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'cpq.injection.quote-configurator',
    title: 'CPQ Configuration',
    description: 'Configure, price, and manage quote offerings',
    features: ['cpq.quotes.view'],
    priority: 70,
    enabled: true,
  },
  Widget: QuoteConfiguratorWidget,
}

export default widget
