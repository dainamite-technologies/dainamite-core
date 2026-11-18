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
    labelKey: 'cpq.wizard.steps.customerSelect.label',
    descriptionKey: 'cpq.wizard.steps.customerSelect.description',
    label: 'Customer Selection',
    description: 'Search and select a customer for the quote.',
    component: CustomerSelectStep,
  })

  registerStepType({
    type: 'offering_select',
    labelKey: 'cpq.wizard.steps.offeringSelect.label',
    descriptionKey: 'cpq.wizard.steps.offeringSelect.description',
    label: 'Offering Selection',
    description: 'Browse and select a product offering from the catalog.',
    component: OfferingSelectStep,
  })

  registerStepType({
    type: 'product_configure',
    labelKey: 'cpq.wizard.steps.productConfigure.label',
    descriptionKey: 'cpq.wizard.steps.productConfigure.description',
    label: 'Product Configuration',
    description: 'Configure run-time attributes for the selected offering.',
    component: ProductConfigureStep,
  })

  registerStepType({
    type: 'item_list',
    labelKey: 'cpq.wizard.steps.itemList.label',
    descriptionKey: 'cpq.wizard.steps.itemList.description',
    label: 'Item List',
    description: 'View and manage child items on the quote.',
    component: ItemListStep,
  })

  registerStepType({
    type: 'review',
    labelKey: 'cpq.wizard.steps.review.label',
    descriptionKey: 'cpq.wizard.steps.review.description',
    label: 'Review & Submit',
    description: 'Review the quote summary and submit.',
    component: ReviewStep,
  })

  registerStepType({
    type: 'inventory_select',
    labelKey: 'cpq.wizard.steps.inventorySelect.label',
    descriptionKey: 'cpq.wizard.steps.inventorySelect.description',
    label: 'Inventory Selection',
    description: 'Select existing customer inventory items (stub — pending inventory domain).',
    component: InventorySelectStep,
  })
}
