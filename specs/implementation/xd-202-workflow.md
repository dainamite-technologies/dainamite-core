# XD-202: Wizard Domain — Implementation Spec

## Summary

Introduce a **configurable wizard engine** that drives guided quoting journeys through a series of steps. A wizard definition is a persisted, tenant-scoped entity whose steps are backed by **registered code components** (React UI + optional server-side handlers). Wizards consume standard CPQ and Open Mercato APIs — they are a UI orchestration layer, not a replacement for the underlying domain services.

Wizards can power diverse use cases: guided product configuration in the admin panel, customer self-service portals, partner quoting flows, and renewal/upsell journeys — each with a bespoke step sequence tailored by the tenant.

Wizard state is **ephemeral** — it lives in the client-side React state for the duration of the session. There is no server-side instance persistence. The quote itself is the durable artifact; the wizard is a transient UI shell around the quoting process.

> **Domain parent**: [Workflow](../domains/workflow.md)
> **Blueprint ref**: `specs/blueprint.md` — Domain #4
> **Dependencies**: XD-201 (Quoting), XD-187 (Product Specification & Offering)
> **Existing implementation**: `src/modules/cpq/backend/cpq/quotes/[id]/page.tsx` — hard-coded view-based configurator
> **Out of scope**: Approval workflow automation (XD-201 G-QUOTE-1), MACD subscription flows (XD-201 G-QUOTE-5)

---

## Motivation

### Current State

The quoting UI is a single monolithic page component (`quotes/[id]/page.tsx`, ~650 lines) with four hard-coded views (`summary`, `add-offering`, `configure`, `edit`). It works for the current use case but:

1. **One-size-fits-all** — every product follows the same flow regardless of complexity. A simple standalone product goes through the same screens as a complex parent-child bundle.

2. **Not reusable** — the configurator is embedded in the CPQ admin backend. It cannot be surfaced in a customer portal, partner dashboard, or external-facing page without duplicating the component.

3. **No guided journey** — the user sees all options at once. There is no ability to guide them through a logical sequence of decisions (e.g. "first pick your region, then we'll show available products").

4. **Tightly coupled** — view switching, API calls, and state management are all in one component. Adding a new step type (e.g. inventory browser, approval gate) requires modifying this monolith.

### What Changes

| Aspect | Current | With Wizards |
|--------|---------|--------------|
| Step definition | Hard-coded views in React | Persisted definition with ordered steps |
| Step types | 4 fixed views | Extensible registry of step components |
| Navigation | Ad-hoc state variable | Engine-driven with conditional transitions |
| Progress | Lost on page leave | Ephemeral client-side state (quote is the durable artifact) |
| Reusability | Admin panel only | Any surface: admin, customer portal, partner portal, embeddable |
| Per-product flow | Same flow for all | Different wizard per product, segment, or use case |
| Entry points | Navigate to quote page | Injectable trigger buttons anywhere in the app |

---

## Architecture

### Design Philosophy

The wizard engine follows a **thin-definition, code-driven** pattern:

```
┌──────────────────────────────────────────────────┐
│  Wizard Definition (DB)                          │
│  - metadata: code, name, description             │
│  - steps: ordered array of { stepId, type, ... } │
│  - transitions: condition → next stepId          │
│  - applicability: when to use this wizard        │
└──────────────────────┬───────────────────────────┘
                       │ references step types by name
                       ▼
┌──────────────────────────────────────────────────┐
│  Step Type Registry (Code)                       │
│  - 'offering_select' → <OfferingSelectStep />    │
│  - 'product_configure' → <ConfigureStep />       │
│  - 'item_list' → <ItemListStep />                │
│  - 'review' → <ReviewStep />                     │
│  - 'my_custom_step' → <MyCustomStep />           │
└──────────────────────┬───────────────────────────┘
                       │ components call
                       ▼
┌──────────────────────────────────────────────────┐
│  Standard CPQ APIs                               │
│  POST /api/cpq/quotes                            │
│  POST /api/cpq/quotes/:id/items                  │
│  GET  /api/cpq/quotes/attributes                 │
│  POST /api/cpq/quotes/:id/recalculate            │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

The DB record is a **holder** — it declares which steps exist, in what order, and under what conditions. The actual step implementation lives in registered React components and optional server-side handlers. This means:

- Tenants can define multiple wizards with different step sequences
- Developers register new step types as code (React components)
- Steps interact with the system through standard APIs — no special backdoors
- The same step type (e.g. `product_configure`) can appear multiple times in a wizard with different config

---

## Data Model

### Entity: CpqWizardDefinition

A named, versioned wizard template. Multiple definitions can co-exist per tenant.

**Table**: `cpq_wizard_definitions`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `code` | text | no | | Unique identifier within the tenant |
| `name` | text | no | | Display label |
| `description` | text | yes | null | Purpose of this wizard |
| `version` | integer | no | `1` | Definition version for evolving wizards over time |
| `steps` | jsonb | no | `'[]'` | Ordered array of `WizardStepDefinition` (see below) |
| `applicability` | jsonb | yes | null | Conditions for auto-selection (see [Applicability](#applicability)) |
| `surface` | text | no | `'backend'` | Where this wizard can be rendered: `'backend'`, `'portal'`, `'any'` |
| `params_schema` | jsonb | yes | null | Optional JSON Schema describing expected launch params (see [Launch Params](#launch-params)) |
| `is_active` | boolean | no | `true` | Soft-enable flag |
| `metadata` | jsonb | yes | null | Arbitrary tenant-specific metadata |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:
- Unique: `(organization_id, tenant_id, code)` — code uniqueness per tenant
- Index: `(organization_id, tenant_id, is_active)` — active wizard lookups
- Index: `(organization_id, tenant_id, surface)` — surface-filtered queries

### WizardStepDefinition (JSONB structure)

Each entry in the `steps` array:

```typescript
interface WizardStepDefinition {
  stepId: string                    // Unique within the wizard (e.g. 'select-offering', 'configure-primary')
  type: string                      // References a registered step type (e.g. 'offering_select', 'product_configure', 'custom')
  title: string                     // Display title for the step
  description?: string | null       // Optional subtitle / help text
  config: Record<string, unknown>   // Step-type-specific configuration (which offerings to show, which attribute groups, etc.)
  transitions: WizardTransition[]   // Rules for determining the next step
  isOptional?: boolean              // If true, step can be skipped. Default: false.
  validationRules?: WizardStepValidation[] // Conditions that must be met before advancing (see below)
}
```

### WizardTransition

Defines how to advance from one step to the next:

```typescript
interface WizardTransition {
  targetStepId: string              // Which step to go to
  condition?: TransitionCondition   // If set, this transition is taken only when condition evaluates to true
  isDefault?: boolean               // If true, this is the fallback transition when no other condition matches
  label?: string                    // Optional button label (e.g. "Next", "Skip to Review", "Add Another")
}
```

### TransitionCondition

A simple expression evaluated against the wizard's accumulated step data:

```typescript
interface TransitionCondition {
  field: string                     // Dot-notation path into step data (e.g. 'quote.lines.length', 'stepData.select-offering.offeringCode')
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'not_exists' | 'in'
  value?: unknown                   // Comparison value (not needed for exists/not_exists)
}
```

Conditions are evaluated client-side by the wizard engine. They operate on the in-memory `stepData` and derived quote state — not on arbitrary backend queries.

### WizardStepValidation

Conditions that must hold before the engine allows advancing past a step:

```typescript
interface WizardStepValidation {
  field: string                     // Same dot-notation as TransitionCondition
  operator: 'eq' | 'neq' | 'exists' | 'not_exists'
  value?: unknown
  message: string                   // Error message shown if validation fails
}
```

---

## Launch Params

### Concept

Wizards can receive **launch params** — a bag of key-value data passed by the caller when the wizard is started. Params provide context from the launching surface (e.g. a company page passes `companyId`, a catalog page passes `offeringCode`).

Params are:
- **Immutable** — set at launch time, never modified during the wizard
- **Accessible to all steps** — via a dedicated `params` prop, separate from `stepData`
- **Usable in transitions** — conditions can reference `params.*` fields
- **Optionally validated** — a wizard definition can declare a `paramsSchema` (JSON Schema) that is validated at launch time

### ParamsSchema (on CpqWizardDefinition)

The optional `params_schema` column holds a JSON Schema that describes the expected launch params. When present, the wizard engine validates incoming params against it before starting.

```typescript
// Example: a wizard that requires companyId and optionally accepts a preselected offeringCode
{
  "type": "object",
  "properties": {
    "companyId": { "type": "string", "format": "uuid" },
    "offeringCode": { "type": "string" }
  },
  "required": ["companyId"]
}
```

If `params_schema` is null, any params are accepted (no validation).

### Params in Transitions and Validations

The `field` path in `TransitionCondition` and `WizardStepValidation` supports a `params.` prefix:

```typescript
// Transition that skips customer_select when companyId is already provided via params
{
  "targetStepId": "configure",
  "condition": { "field": "params.companyId", "operator": "exists" },
  "label": "Configure"
}
```

This allows wizard definitions to adapt their flow based on the launch context — e.g. skip the customer selection step when launched from a customer page.

### Params in Step Components

Steps can read params to pre-fill data or adjust behavior. For example, a `customer_select` step can auto-select the customer when `params.companyId` is provided, or skip itself entirely (via a transition condition as above).

---

## Step Type Registry

### Concept

Step types are registered in code — not stored in the database. A step type is a named pair of:

1. **React component** — renders the step UI and handles user interaction
2. **Server-side handler** (optional) — performs validation or data enrichment when the step is submitted

```typescript
interface WizardStepType {
  type: string                      // e.g. 'offering_select', 'product_configure'
  label: string                     // Human-readable name for admin UI
  description: string               // What this step type does
  component: React.ComponentType<WizardStepProps>  // React component
  serverHandler?: WizardStepHandler                // Optional server-side logic
  configSchema?: z.ZodSchema        // Zod schema for step config validation
}
```

### WizardStepProps

Every step component receives the same props interface:

```typescript
interface WizardStepProps {
  stepData: Record<string, Record<string, unknown>>  // Accumulated data from all steps, keyed by stepId
  completedSteps: string[]          // Ordered array of completed stepId values
  stepDefinition: WizardStepDefinition  // This step's definition from the wizard
  config: Record<string, unknown>   // Step-specific config from the definition
  params: Record<string, unknown>   // Immutable launch params passed when the wizard was started

  // Navigation callbacks
  onComplete: (stepOutput: Record<string, unknown>) => void  // Mark step done, advance to next
  onBack: () => void                // Navigate to previous step
  onSkip: () => void                // Skip this step (only if isOptional)

  // Shared context
  quoteId: string | null            // Current quote ID (if one exists)
  customerId: string | null         // Current customer ID (if selected)
  scope: TenantScope                // Org + tenant context
}
```

Step components call standard CPQ APIs directly (via `fetch` or a provided API client). The wizard engine does not proxy API calls — it only manages step progression and state.

### Built-in Step Types

The initial implementation provides these step types. They cover the most common quoting patterns and serve as reference implementations for custom step types.

#### `customer_select`

Renders a customer search/select interface. Writes `{ customerId, customerName }` to step data.

**Config**:
```typescript
{
  allowCreate?: boolean        // Show "create new customer" option. Default: false.
  segmentFilter?: string[]     // Limit to customers in these segments
}
```

**API calls**: `GET /api/customers` (standard Open Mercato customer API)

#### `offering_select`

Renders a browsable catalog of product offerings. Writes `{ offeringId, offeringCode, offeringName, specId, productId }` to step data.

**Config**:
```typescript
{
  offeringFilter?: {
    specCodes?: string[]       // Limit to offerings from these specs
    offeringCodes?: string[]   // Limit to specific offerings
    tags?: string[]            // Filter by offering tags/metadata
  }
  displayMode?: 'grid' | 'list'   // Default: 'grid'
  allowMultiple?: boolean          // Allow selecting multiple offerings (for bundle wizards). Default: false.
}
```

**API calls**: `GET /api/cpq/product-offerings`

#### `product_configure`

Renders a dynamic attribute form for the selected offering. Calls constrained attributes API for dependency resolution. Writes `{ configuration: Record<string, unknown> }` to step data.

**Config**:
```typescript
{
  offeringSource?: string      // stepId to read offeringId from. Default: auto-detect from prior steps.
  attributeGroups?: Array<{    // Optional grouping of attributes into panels/sections
    label: string
    attributeCodes: string[]
  }>
  hiddenAttributes?: string[]  // Attributes to hide (pre-filled from context or design-time)
  readonlyAttributes?: string[] // Attributes visible but not editable
  autoPrice?: boolean          // Auto-call price preview on each attribute change. Default: false.
}
```

**API calls**: `GET /api/cpq/quotes/attributes`, `POST /api/cpq/quotes/:id/items`, `PUT /api/cpq/quotes/:id/items/:lineId`

#### `item_list`

Renders a list of quote lines with ability to add, edit, or remove child items. Used for parent-child bundle configuration.

**Config**:
```typescript
{
  parentLineSource?: string    // stepId that holds the parent line's lineId
  allowedChildSpecs?: string[] // Limit which child specs can be added
  minItems?: number            // Minimum child items required. Default: 0.
  maxItems?: number            // Maximum child items allowed. Default: unlimited.
  showPricing?: boolean        // Show per-item pricing in the list. Default: true.
}
```

**API calls**: `POST /api/cpq/quotes/:id/items`, `DELETE /api/cpq/quotes/:id/items/:lineId`, `POST /api/cpq/quotes/:id/recalculate`

#### `review`

Renders a read-only summary of the quote with all lines, charges, and totals. Optionally triggers a final recalculate.

**Config**:
```typescript
{
  showChargeBreakdown?: boolean   // Show per-charge detail vs. offering-level totals. Default: true.
  showAdjustments?: boolean       // Show price rule adjustments. Default: true.
  recalculateOnEnter?: boolean    // Trigger recalculate when entering this step. Default: true.
  submitAction?: 'save' | 'submit_for_approval' | 'send_to_customer' | 'none'  // What the "Finish" button does. Default: 'save'.
  submitLabel?: string            // Custom label for the finish button.
}
```

**API calls**: `POST /api/cpq/quotes/:id/recalculate`, `POST /api/cpq/quotes/:id/status`

#### `inventory_select`

Renders a browsable list of the customer's existing subscription/inventory items. Used for upsell, renewal, and modify flows. Writes `{ inventoryItemId, inventoryItemName, currentConfig }` to step data.

**Config**:
```typescript
{
  customerSource?: string      // stepId to read customerId from. Default: auto-detect.
  productFilter?: string[]     // Limit to items matching these product codes
  statusFilter?: string[]      // Limit to items in these statuses (e.g. 'active')
}
```

**API calls**: Consumes standard Open Mercato inventory/subscription APIs (future domain — step type is registered but implementation deferred until inventory domain exists).

#### `custom`

A passthrough type. The step definition's `config.componentName` references a custom-registered React component. This is the escape hatch for domain-specific UI that doesn't fit the built-in types.

**Config**:
```typescript
{
  componentName: string        // Name of the custom-registered component
  // ... any additional props passed through to the component
}
```

### Registering Custom Step Types

Custom step types are registered in the CPQ module's DI setup:

```typescript
// src/modules/cpq/wizards/steps/index.ts
import { registerStepType } from '@/modules/cpq/wizards/registry'
import { TechnicalValidationStep } from './TechnicalValidationStep'

registerStepType({
  type: 'technical_validation',
  label: 'Technical Validation',
  description: 'Validates technical feasibility before proceeding',
  component: TechnicalValidationStep,
})
```

The registry is a simple in-memory map populated at module initialization.

---

## Applicability

A wizard definition can declare conditions under which it is auto-selected. When a user starts a new quoting journey, the engine evaluates all active wizard definitions and selects the best match.

```typescript
interface WizardApplicability {
  specCodes?: string[]             // Match if the target product spec code is in this list
  offeringCodes?: string[]         // Match if the target offering code is in this list
  customerSegments?: string[]      // Match if the customer's segment is in this list
  surface?: 'backend' | 'portal'   // Match only on this surface
  priority?: number                // Higher priority wins when multiple wizards match. Default: 0.
}
```

**Selection algorithm**:
1. Load all active `CpqWizardDefinition` records for the tenant
2. Filter by `surface` (must match or be `'any'`)
3. For each wizard, evaluate `applicability` against the launch context
4. If multiple match, select the one with highest `priority`
5. If no match, use a built-in default wizard (backward-compatible with current configurator)

Applicability is evaluated **client-side** (from cached definitions) for instant response. The definitions are loaded once per session.

---

## Wizard Engine

### Client-Side Engine

The wizard engine is a React context + reducer that manages wizard state and step progression. All wizard state is **ephemeral** — it lives in React state and is lost when the user navigates away. The quote (and its lines, attributes, prices) is the persisted artifact.

```typescript
interface WizardEngineState {
  definition: CpqWizardDefinition
  params: Record<string, unknown>   // Immutable launch params, available for transitions and steps
  currentStepId: string
  completedSteps: string[]
  stepData: Record<string, Record<string, unknown>>
  currentStep: WizardStepDefinition
  canGoBack: boolean
  canSkip: boolean
  isFirstStep: boolean
  isLastStep: boolean
  completionPercent: number         // completedSteps.length / totalSteps * 100
  quoteId: string | null
  customerId: string | null
}

interface WizardEngineActions {
  completeStep(stepOutput: Record<string, unknown>): void  // Store step data, evaluate transitions, advance
  goBack(): void                    // Navigate to previous completed step
  skipStep(): void                  // Skip optional step, advance
}
```

#### Step Advancement Flow

```
1. User completes a step → component calls onComplete(stepOutput)
2. Engine writes stepOutput to stepData[currentStepId]
3. Engine adds currentStepId to completedSteps
4. Engine evaluates transitions on the current step:
   a. For each transition (in order):
      - If no condition → take this transition (default)
      - If condition → evaluate against { stepData, params }
        (field paths: 'stepData.X.Y' or 'params.X')
      - First matching transition wins
   b. If no transition matches → wizard is complete
5. Engine sets currentStepId to the target step
6. Engine renders the new step component
```

#### Back-Navigation

When the user goes back:
1. Pop the last entry from `completedSteps`
2. Set `currentStepId` to the popped value
3. The step component renders with its previous data from `stepData[stepId]`
4. Forward steps after the current position are **not invalidated** — their data remains in `stepData`. They are re-validated when re-entered.

---

## Service Layer

### CpqWizardService

Manages wizard definitions. Registered as `cpqWizardService` in Awilix DI.

```typescript
interface CpqWizardService {
  // --- Definitions ---

  /** List active wizard definitions, optionally filtered by surface/applicability. */
  listDefinitions(filter: WizardDefinitionFilter, scope: TenantScope): Promise<WizardDefinition[]>

  /** Get a single definition by ID or code. */
  getDefinition(idOrCode: string, scope: TenantScope): Promise<WizardDefinition>

  /** Create a new wizard definition. */
  createDefinition(input: CreateWizardDefinitionInput, scope: TenantScope): Promise<WizardDefinition>

  /** Update an existing definition. Increments version. */
  updateDefinition(id: string, input: UpdateWizardDefinitionInput, scope: TenantScope): Promise<WizardDefinition>

  /** Soft-delete a definition. */
  deleteDefinition(id: string, scope: TenantScope): Promise<void>

  /** Resolve the best wizard definition for a given context. */
  resolveWizard(context: WizardResolveContext, scope: TenantScope): Promise<WizardDefinition | null>
}
```

#### WizardLaunchContext

```typescript
interface WizardLaunchContext {
  surface: 'backend' | 'portal'   // Where the wizard is being started
  params?: Record<string, unknown> // Launch params — validated against definition's paramsSchema if present
}
```

---

## API Design

All APIs scoped by `organizationId` + `tenantId` from auth context.

### Wizard Definitions — `/api/cpq/wizards`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.wizards.view` | List definitions (paginated, filterable) |
| `POST` | `cpq.wizards.manage` | Create a definition |
| `PUT` | `cpq.wizards.manage` | Update a definition |
| `DELETE` | `cpq.wizards.manage` | Soft-delete a definition |

#### GET — list

```
GET /api/cpq/wizards?page=1&pageSize=50&surface=backend&isActive=true
```

| Param | Required | Description |
|-------|----------|-------------|
| `page` | No | Default `1` |
| `pageSize` | No | Default `50`, max `100` |
| `surface` | No | Filter by surface: `'backend'`, `'portal'`, `'any'` |
| `isActive` | No | Filter by active status |

Response: paginated list.

```typescript
{
  items: Array<{
    id: string; code: string; name: string; description: string | null
    version: number; steps: WizardStepDefinition[]
    applicability: WizardApplicability | null
    surface: string; isActive: boolean; metadata: Record<string, unknown> | null
    createdAt: string; updatedAt: string
  }>
  total: number; page: number; pageSize: number; totalPages: number
}
```

#### GET — single (`?id=<uuid>` or `?code=<string>`)

Returns the full definition with steps.

#### POST — create

```typescript
{
  code: string
  name: string
  description?: string | null
  steps: WizardStepDefinition[]
  applicability?: WizardApplicability | null
  surface?: 'backend' | 'portal' | 'any'   // Default: 'backend'
  isActive?: boolean                         // Default: true
  metadata?: Record<string, unknown> | null
}
```

Response: `201 Created` with the created definition.

#### PUT — update

Body: `{ id: string } & Partial<CreateBody>`. Increments `version`. Returns updated definition.

#### DELETE — soft-delete

Body: `{ id: string }`. Sets `deletedAt`. Returns `{ success: true }`.

### Wizard Resolution — `GET /api/cpq/wizards/resolve`

Returns the best-matching wizard definition for a given context.

```
GET /api/cpq/wizards/resolve?surface=portal&offeringCode=cloud-connect-aws
```

| Param | Required | Description |
|-------|----------|-------------|
| `surface` | Yes | `'backend'` or `'portal'` |
| `specCode` | No | Target product spec code |
| `offeringCode` | No | Target offering code |
| `customerSegment` | No | Customer segment |

Response: single wizard definition or `404` if no match.

---

## Injectable Wizard Triggers

### Concept

Wizards can be launched from anywhere in the application — not just the CPQ pages. The system provides a **trigger component** that can be placed in any page or widget:

```tsx
<WizardTrigger
  wizardCode="guided-cloud-connect"    // Explicit wizard, OR:
  offeringCode="cloud-connect-aws"     // Let the engine resolve the wizard
  params={{ companyId: currentCompanyId, channel: 'partner' }}  // Launch params
  surface="backend"
  label="Configure Cloud Connect"
  variant="button"                     // 'button' | 'link' | 'card'
/>
```

When clicked, the trigger:
1. Resolves the wizard definition (by code or by applicability)
2. Validates `params` against the definition's `paramsSchema` (if defined)
3. Initializes the wizard engine with the definition and params
4. Navigates to the wizard runner page (or opens a modal/drawer, configurable)

### Injection Points

Triggers can be placed in:

| Location | Example use case |
|----------|-----------------|
| Customer detail page | "Start a quote for this customer" button |
| Product catalog browser | "Configure this product" button on each offering card |
| Customer portal dashboard | "Order a new service" card |
| Quote detail page | "Configure with guided wizard" |
| Inventory item detail | "Modify this service" (future MACD) |
| Navigation sidebar | "New guided quote" menu entry |

The trigger component is exported from the CPQ module and can be imported by any page.

### Wizard Runner

The wizard runner is a standalone page/component that:
1. Loads the wizard definition (from route params or pre-resolved)
2. Initializes the wizard engine with client-side state
3. Renders the current step component from the registry
4. Provides the step navigation chrome (progress bar, back/next buttons)

**Routes**:
- Backend: `/backend/cpq/wizards/:definitionCode` — full-page wizard runner in the admin shell (accepts launch params via query string or router state)
- Portal: `/(frontend)/wizards/:definitionCode` — wizard runner in the customer portal layout

The runner is **layout-agnostic** — it receives the step component and wraps it in whatever chrome the surface provides (AppShell sidebar for backend, portal layout for customer-facing).

---

## Examples

### Example 1 — Simple Standalone Product

A tenant selling a single SaaS product. The wizard has 3 steps: pick customer, configure, review.

```json
{
  "code": "simple-saas-quote",
  "name": "SaaS Product Quote",
  "surface": "backend",
  "steps": [
    {
      "stepId": "pick-customer",
      "type": "customer_select",
      "title": "Select Customer",
      "config": {},
      "transitions": [{ "targetStepId": "configure", "isDefault": true }]
    },
    {
      "stepId": "configure",
      "type": "product_configure",
      "title": "Configure Product",
      "config": {
        "offeringSource": null,
        "attributeGroups": [
          { "label": "Plan", "attributeCodes": ["plan_tier", "billing_cycle"] },
          { "label": "Add-ons", "attributeCodes": ["extra_storage", "priority_support"] }
        ],
        "autoPrice": true
      },
      "transitions": [{ "targetStepId": "review", "isDefault": true }]
    },
    {
      "stepId": "review",
      "type": "review",
      "title": "Review & Submit",
      "config": { "submitAction": "save", "submitLabel": "Create Quote" },
      "transitions": []
    }
  ],
  "applicability": {
    "specCodes": ["saas-product"],
    "priority": 10
  }
}
```

### Example 2 — Parent-Child Bundle with Branching

A telecom product with a primary connection and optional child services. The wizard branches based on whether children are needed.

```json
{
  "code": "cloud-connect-bundle",
  "name": "Cloud Connect Configuration",
  "surface": "backend",
  "steps": [
    {
      "stepId": "select-offering",
      "type": "offering_select",
      "title": "Choose Connection Type",
      "config": {
        "offeringFilter": { "specCodes": ["cloud-connect"] },
        "displayMode": "grid"
      },
      "transitions": [{ "targetStepId": "configure-primary", "isDefault": true }]
    },
    {
      "stepId": "configure-primary",
      "type": "product_configure",
      "title": "Configure Connection",
      "config": {
        "attributeGroups": [
          { "label": "Location", "attributeCodes": ["data_centre", "port_size"] },
          { "label": "Service", "attributeCodes": ["bandwidth", "service_tier"] }
        ]
      },
      "transitions": [
        {
          "targetStepId": "add-children",
          "condition": { "field": "stepData.configure-primary.configuration.service_tier", "operator": "eq", "value": "premium" },
          "label": "Add Premium Services"
        },
        { "targetStepId": "review", "isDefault": true, "label": "Skip to Review" }
      ]
    },
    {
      "stepId": "add-children",
      "type": "item_list",
      "title": "Add Services",
      "config": {
        "parentLineSource": "configure-primary",
        "allowedChildSpecs": ["cloud-connect-addon"],
        "minItems": 1,
        "maxItems": 5
      },
      "transitions": [{ "targetStepId": "review", "isDefault": true }]
    },
    {
      "stepId": "review",
      "type": "review",
      "title": "Review & Submit",
      "config": { "recalculateOnEnter": true, "submitAction": "submit_for_approval" },
      "transitions": []
    }
  ],
  "applicability": {
    "specCodes": ["cloud-connect"],
    "priority": 20
  }
}
```

### Example 3 — Customer Portal Self-Service

A customer-facing wizard for ordering a mobile plan. Simplified steps, no customer selection (customer is the logged-in user).

```json
{
  "code": "mobile-plan-portal",
  "name": "Order a Mobile Plan",
  "surface": "portal",
  "steps": [
    {
      "stepId": "choose-plan",
      "type": "offering_select",
      "title": "Choose Your Plan",
      "config": {
        "offeringFilter": { "specCodes": ["mobile-plan"] },
        "displayMode": "grid"
      },
      "transitions": [{ "targetStepId": "customize", "isDefault": true }]
    },
    {
      "stepId": "customize",
      "type": "product_configure",
      "title": "Customize Your Plan",
      "config": {
        "attributeGroups": [
          { "label": "Data & Minutes", "attributeCodes": ["data_allowance", "minute_allowance"] },
          { "label": "Extras", "attributeCodes": ["international_roaming", "device_insurance"] }
        ],
        "autoPrice": true
      },
      "transitions": [{ "targetStepId": "confirm", "isDefault": true }]
    },
    {
      "stepId": "confirm",
      "type": "review",
      "title": "Confirm Your Order",
      "config": {
        "showChargeBreakdown": false,
        "submitAction": "save",
        "submitLabel": "Place Order"
      },
      "transitions": []
    }
  ],
  "applicability": {
    "specCodes": ["mobile-plan"],
    "surface": "portal",
    "priority": 10
  }
}
```

---

## Requirements Traceability

| Domain Requirement | Implementation |
|-------------------|----------------|
| R-WF-1: Configurable Steps | `CpqWizardDefinition.steps` JSONB array — tenant-configurable per wizard |
| R-WF-2: Branching Logic | `WizardTransition.condition` evaluated by the client-side engine against `stepData` |
| R-WF-3: Standard Step Types | Six built-in types: `customer_select`, `offering_select`, `product_configure`, `item_list`, `review`, `inventory_select` |
| R-WF-4: Wizard Selection | `CpqWizardService.resolveWizard()` evaluates applicability conditions and selects by priority |
| R-WF-5: Back-Navigation | Engine supports `goBack()` via in-memory `completedSteps` and `stepData` |
| R-WF-6: Extensible Steps | `registerStepType()` allows custom components. `custom` step type delegates to named components. |
| R-GEN-1: Product Agnostic | Wizards are standalone entities. Step types consume standard APIs. No product-specific logic in the engine. |
| R-GEN-2: Open-Close Principle | No modifications to `@open-mercato/*` packages |
| R-GEN-3: Multi-Tenancy | All queries scoped by `organizationId` + `tenantId` |
| R-GEN-5: Extensibility via DI | `CpqWizardService` registered in Awilix, overridable. Step type registry extensible at module init. |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Request body fails Zod validation | `{ "error": "Validation error", "details": [...ZodIssue] }` |
| `400 Bad Request` | Step definition references unregistered step type | `{ "error": "Unknown step type: '<type>'" }` |
| `400 Bad Request` | Launch params fail validation against definition's `paramsSchema` | `{ "error": "Invalid launch params", "details": [...] }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | Definition or resolved wizard not found | `{ "error": "Not found" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## ACL / Feature Flags

| Feature | Description |
|---------|-------------|
| `cpq.wizards.view` | View wizard definitions, resolve wizards |
| `cpq.wizards.manage` | Create/update/delete wizard definitions |

Portal-surface wizards will additionally respect the portal's own auth context (customer/partner identity). The wizard engine checks both the CPQ feature flag and the surface-specific auth.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cpq/data/entities.ts` | Modify | Add `CpqWizardDefinition` entity |
| `src/modules/cpq/data/validators.ts` | Modify | Add `cpqWizardDefinitionCreateSchema`, `cpqWizardDefinitionUpdateSchema` |
| `src/modules/cpq/services/cpqWizardService.ts` | Create | Service implementing `CpqWizardService` interface |
| `src/modules/cpq/wizards/registry.ts` | Create | Step type registry: `registerStepType()`, `getStepType()`, `listStepTypes()` |
| `src/modules/cpq/wizards/engine.tsx` | Create | React context + reducer for wizard engine state management |
| `src/modules/cpq/wizards/WizardRunner.tsx` | Create | Wizard runner component (step chrome, progress bar, navigation) |
| `src/modules/cpq/wizards/WizardTrigger.tsx` | Create | Injectable trigger component |
| `src/modules/cpq/wizards/steps/CustomerSelectStep.tsx` | Create | Built-in `customer_select` step |
| `src/modules/cpq/wizards/steps/OfferingSelectStep.tsx` | Create | Built-in `offering_select` step |
| `src/modules/cpq/wizards/steps/ProductConfigureStep.tsx` | Create | Built-in `product_configure` step |
| `src/modules/cpq/wizards/steps/ItemListStep.tsx` | Create | Built-in `item_list` step |
| `src/modules/cpq/wizards/steps/ReviewStep.tsx` | Create | Built-in `review` step |
| `src/modules/cpq/wizards/steps/InventorySelectStep.tsx` | Create | Built-in `inventory_select` step (stub) |
| `src/modules/cpq/wizards/steps/index.ts` | Create | Registers all built-in step types |
| `src/modules/cpq/wizards/types.ts` | Create | Shared TypeScript interfaces for wizard engine |
| `src/modules/cpq/api/wizards/route.ts` | Create | CRUD API for wizard definitions |
| `src/modules/cpq/api/wizards/resolve/route.ts` | Create | Wizard resolution endpoint |
| `src/modules/cpq/backend/cpq/wizards/[definitionCode]/page.tsx` | Create | Backend wizard runner page |
| `src/modules/cpq/di.ts` | Modify | Register `cpqWizardService` |
| `src/modules/cpq/ce.ts` | Modify | Add `cpq:cpq_wizard_definition` entity entry |
| `src/modules/cpq/acl.ts` | Modify | Add `cpq.wizards.view` and `cpq.wizards.manage` feature flags |
| `src/modules/cpq/migrations/Migration_...wizards.ts` | Create | Schema for `cpq_wizard_definitions` table |

---

## Migration Strategy

### Phase 1: Foundation (non-breaking)

1. Create `cpq_wizard_definitions` table
2. Implement `CpqWizardService` with CRUD operations
3. Implement CRUD API routes for definitions
4. Register entity in `ce.ts` and service in `di.ts`

### Phase 2: Engine + Built-in Steps

1. Build the step type registry
2. Implement the client-side wizard engine (context + reducer)
3. Build the `WizardRunner` component
4. Implement built-in step types: `customer_select`, `offering_select`, `product_configure`, `item_list`, `review`
5. Create the backend runner page at `/backend/cpq/wizards/:definitionCode`

### Phase 3: Triggers + Integration

1. Build the `WizardTrigger` component
2. Place triggers in the existing CPQ pages (offering browser, quote detail)
3. Create a default wizard definition that mirrors the current configurator behavior
4. Add wizard resolution endpoint

### Phase 4: Portal Surface (future)

1. Create portal-surface runner page
2. Adapt step components for portal layout and auth context
3. Enable portal-specific wizard definitions

---

## Design Decisions

### DD-1: Thin Definition, Code-Driven Steps

The DB stores structure (step order, transitions, config), but step behavior lives in registered React components. This avoids building a visual workflow designer while still allowing data-driven step sequences. Tenants define "what steps, in what order" — developers define "what each step type does."

### DD-2: Steps Call APIs Directly

Step components use standard CPQ APIs via `fetch`. The wizard engine does not proxy, intercept, or wrap these calls. This means:
- Steps are testable in isolation
- The wizard layer adds zero overhead to API operations
- Any new CPQ API is immediately available to step components without engine changes
- Debugging is straightforward — network tab shows standard API calls

### DD-3: Client-Side Transition Evaluation

Transition conditions are evaluated in the browser against `stepData`, not on the server. This enables instant navigation without round-trips. The trade-off is that conditions can only reference data the client already has (step outputs, quote state) — not arbitrary server-side queries. For complex server-dependent conditions, a step's `onComplete` handler can fetch data and include it in the step output before the engine evaluates transitions.

### DD-4: No Instance Persistence — Quote is the Artifact

Wizard state is ephemeral (React state only). The quote and its lines/attributes/prices are the durable artifacts — they are persisted via the standard CPQ APIs that step components call. This simplifies the system:
- No instance table, no instance API, no sync between wizard state and server
- No stale instance problem (wizard state cannot drift from quote state)
- The quote can be opened later without the wizard — it stands on its own
- If the user navigates away mid-wizard, the quote retains whatever was saved so far via API calls; the wizard progress is simply lost

The trade-off is no "resume from where I left off" capability. This is acceptable because:
- Most wizard flows are short (3-5 steps, completed in one sitting)
- The quote itself captures the meaningful state (customer, lines, config, prices)
- A user can always start a new wizard session against an existing quote

### DD-5: Surface as First-Class Concept

Wizards declare their intended surface (`backend`, `portal`, `any`). This allows the same tenant to have different wizards for internal sales reps vs. customer self-service, even for the same product. The runner page adapts its layout to the surface context.

---

## Known Gaps and Limitations

### G-WF-1: No visual wizard builder

Wizard definitions must be created via API or seed data. There is no drag-and-drop UI for designing wizards. An admin UI for wizard management (list, create, edit steps) is a future enhancement.

### G-WF-2: No parallel steps

The engine supports only linear step sequences with branching. Parallel steps (e.g. "configure product A and product B simultaneously") are not supported. Each step must complete before the next begins.

### G-WF-3: No server-side step handlers

The initial implementation has no server-side step validation hooks. All validation is either in the step component (client-side) or in the CPQ APIs the step calls. Server-side step handlers are a planned enhancement.

### G-WF-4: Inventory select step is a stub

The `inventory_select` step type is registered but its implementation is deferred until the inventory/subscription domain exists.

### G-WF-5: No wizard analytics

There is no tracking of step completion rates, drop-off points, or average time per step. Analytics are a future enhancement.

### G-WF-6: No resume capability

Since wizard state is ephemeral, there is no way to resume a partially completed wizard session after navigating away. The quote retains its state, but the wizard step position and accumulated step data are lost.
