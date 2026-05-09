import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderCpqTabWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'cpq.injection.order-cpq-tab',
    title: 'CPQ Order',
    description: 'View the CPQ order associated with this sales order',
    features: ['cpq.orders.view'],
    priority: 60,
    enabled: true,
  },
  Widget: OrderCpqTabWidget,
}

export default widget
