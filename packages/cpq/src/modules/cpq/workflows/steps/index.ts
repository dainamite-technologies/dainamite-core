import { registerStepType } from '../registry'
import { CustomerSelectStep } from './CustomerSelectStep'
import { OfferingSelectStep } from './OfferingSelectStep'
import { ProductConfigureStep } from './ProductConfigureStep'
import { ItemListStep } from './ItemListStep'
import { ReviewStep } from './ReviewStep'
import { InventorySelectStep } from './InventorySelectStep'

export function registerBuiltInStepTypes() {
  registerStepType({
    type: 'customer_select',
    label: 'Customer Selection',
    description: 'Search and select a customer for the quote.',
    component: CustomerSelectStep,
  })

  registerStepType({
    type: 'offering_select',
    label: 'Offering Selection',
    description: 'Browse and select a product offering from the catalog.',
    component: OfferingSelectStep,
  })

  registerStepType({
    type: 'product_configure',
    label: 'Product Configuration',
    description: 'Configure run-time attributes for the selected offering.',
    component: ProductConfigureStep,
  })

  registerStepType({
    type: 'item_list',
    label: 'Item List',
    description: 'View and manage child items on the quote.',
    component: ItemListStep,
  })

  registerStepType({
    type: 'review',
    label: 'Review & Submit',
    description: 'Review the quote summary and submit.',
    component: ReviewStep,
  })

  registerStepType({
    type: 'inventory_select',
    label: 'Inventory Selection',
    description: 'Select existing customer inventory items (stub — pending inventory domain).',
    component: InventorySelectStep,
  })
}
