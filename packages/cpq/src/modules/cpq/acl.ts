export const features = [
  { id: 'cpq.quotes.view', title: 'View CPQ Quotes', module: 'cpq' },
  { id: 'cpq.quotes.manage', title: 'Manage CPQ Quotes', module: 'cpq' },
  { id: 'cpq.pricing.view', title: 'View Pricing', module: 'cpq' },
  { id: 'cpq.pricing.manage', title: 'Manage Pricing', module: 'cpq' },
  { id: 'cpq.products.view', title: 'View CPQ Product Config', module: 'cpq' },
  { id: 'cpq.products.manage', title: 'Manage CPQ Product Config', module: 'cpq' },
  { id: 'cpq.specifications.view', title: 'View Product Specifications', module: 'cpq' },
  { id: 'cpq.specifications.manage', title: 'Manage Product Specifications', module: 'cpq' },
  { id: 'cpq.offerings.view', title: 'View Product Offerings', module: 'cpq' },
  { id: 'cpq.offerings.manage', title: 'Manage Product Offerings', module: 'cpq' },
  { id: 'cpq.wizards.view', title: 'View Wizards', module: 'cpq' },
  { id: 'cpq.wizards.manage', title: 'Manage Wizards', module: 'cpq' },
  { id: 'cpq.orders.view', title: 'View CPQ Orders', module: 'cpq' },
  { id: 'cpq.orders.manage', title: 'Manage CPQ Orders', module: 'cpq' },
  // XD-250 ARC (Amend / Renew / Cancel)
  { id: 'cpq.arc.amend.manage', title: 'Manage Amend Quotes', module: 'cpq' },
  { id: 'cpq.arc.renew.manage', title: 'Manage Renew Quotes', module: 'cpq' },
  { id: 'cpq.arc.cancel.manage', title: 'Manage Cancel Quotes', module: 'cpq' },
  { id: 'cpq.arc.changelog.view', title: 'View Subscription Change History', module: 'cpq' },
  // Expiring-subscriptions feature retired — the dedicated /expiring page
  // was replaced by an "Expiring within (days)" filter + saved perspective
  // on the main subscriptions list, which uses `cpq.inventory.view`.
]

export default features
