# Business Rules Domain

## Objective

Hold the definition of, and evaluate/enforce, business rules at quoting runtime. Rules are **coded** (written in TypeScript) but they all conform to a common interface. Rules are bound to products as data — which rules apply to which product is configurable, not hard-coded.

---

## Rule Types

### Approval Rules
- Triggered when certain conditions are met (e.g. discount exceeds threshold, margin drops below minimum).
- Result: quote requires approval by a designated role before it can proceed.
- **Example**: If discount > 15% or margin < 20%, require manager approval.

### Minimum Price Rules
- Price can't be set below a defined floor.
- The floor can be defined in the pricing table (as a column) or as a rule parameter.
- **Example**: Monthly port fee cannot go below the cost-based minimum defined in the cost table.

### Consistency Rules
- Validate that the product mix / configuration is structurally valid.
- Two sub-types:
  - **Inclusion**: If product A is present, product B must also be present. *(e.g. peering service requires access port)*
  - **Exclusion**: If product A is present, product B cannot be present. If attribute X has value Y, attribute Z cannot have value W.
- **Example**: GIX Internet Peering requires a GIX Access Port as parent.

### Eligibility Rules
- Determine if a product or option is available for a given customer or context.
- Can be based on customer segment, geography, existing inventory, or product mix.
- **Example**: Certain products only available to enterprise customers. Certain port sizes only available at specific data centres.

---

## Key Entities

### Business Rule
- Represents an individual rule — a TypeScript class implementing one of the rule interfaces.

| Property | Description |
|----------|-------------|
| `ruleId` | Unique identifier (matches the class) |
| `name` | Human-readable name |
| `description` | What the rule does |
| `ruleType` | `product`, `configuration`, `eligibility`, `pricing`, `approval` |
| `active` | Whether the rule is currently enabled |

- Rules are **auto-discovered** from `src/modules/cpq/rules/*.rule.ts` and registered in DI.
- Rules are **bound to products** via `CpqProductConfig.rules[]` — an array of rule references with optional per-binding configuration.
- Rules receive a `RuleContext` with access to: customer info, current configuration, other quote items, existing inventory.

---

## Requirements

### R-RULE-1: Rules as Code
Business rules are TypeScript classes extending abstract base classes. They are not stored as data — their logic is code. What's configurable is **which rules apply to which products** and **rule parameters**.

### R-RULE-2: Four Rule Interfaces
The engine must support four rule types with distinct interfaces:
- **ProductRule**: Validates relationships between products in a quote
- **ConfigurationRule**: Constrains attribute values based on current selections
- **EligibilityRule**: Determines if a product/option is available in context
- **PricingRule**: Modifies calculated prices (discounts, surcharges, overrides)

### R-RULE-3: Auto-Discovery
Rule classes in `src/modules/cpq/rules/` must be automatically discovered, registered in DI, and available for binding to products.

### R-RULE-4: Rule Binding as Data
Product-to-rule bindings are stored as JSONB on `CpqProductConfig`. Rules can accept per-binding configuration parameters.

### R-RULE-5: Real-Time Evaluation
Configuration rules must evaluate on every attribute change to update available options in real-time during the quoting wizard. Performance target: < 100ms per evaluation cycle.

### R-RULE-6: Composable Results
Multiple rules of the same type can be bound to a product. Results are composed:
- Configuration rules: constraints are merged (intersection of allowed values)
- Product rules: violations are aggregated
- Pricing rules: applied sequentially (order defined by binding)

### R-RULE-7: Admin Visibility
An admin page must list all registered rules (read-only) showing ruleId, name, type, description, and which products use each rule.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `evaluateConfigurationRules(context)` | Return constrained attribute options for real-time wizard updates |
| `evaluateProductRules(context)` | Return violations for quote-level validation |
| `evaluateEligibilityRules(context)` | Return eligible/ineligible status for product catalog filtering |
| `evaluatePricingRules(context, charges)` | Return modified charges with adjustment audit trail |
| `listAvailableRules()` | List all registered rule classes for admin UI |
