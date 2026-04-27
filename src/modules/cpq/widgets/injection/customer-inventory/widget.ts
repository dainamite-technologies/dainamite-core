import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CustomerInventoryWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'cpq.injection.customer-inventory',
    title: 'Customer Inventory',
    description: 'Products and services purchased by this customer',
    features: ['cpq.inventory.view'],
    priority: 60,
    enabled: true,
  },
  Widget: CustomerInventoryWidget,
}

export default widget
