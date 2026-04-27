# Workflow Domain

## Objective

Define custom, guided quoting workflows aiming to facilitate the capture of quotes. A workflow defines the **steps**, **branching logic**, and **UI flow** of the quoting journey — decoupled from the product structure.

---

## Concept

The current implementation has a **hard-coded** 5-step wizard (select customer -> choose path -> configure primary -> configure children -> review). The Workflow Domain generalizes this into a **configurable** step-based engine.

### Why?

Different products and sales motions need different quoting flows:
- A simple standalone product may need only: select customer -> configure -> review
- A parent-child bundle needs the current multi-step flow with path selection
- A renewal or upsell may start from existing inventory and skip customer selection
- A complex enterprise deal may require approval steps, technical validation, or multi-party review

---

## Key Concepts

### Workflow Definition
- A named, versioned definition of a quoting flow.
- Consists of ordered **steps** with transition rules.

| Property | Description |
|----------|-------------|
| `code` | Unique identifier |
| `name` | Display label |
| `description` | Purpose of this workflow |
| `steps` | Ordered array of step definitions |
| `applicability` | Conditions for when this workflow is used (product type, customer segment, quote type) |

### Workflow Step
- A single stage in the quoting journey.
- Each step defines what data it collects and what transitions are available.

| Property | Description |
|----------|-------------|
| `stepId` | Unique within the workflow |
| `type` | `customer_select`, `path_select`, `product_configure`, `item_list`, `review`, `approval`, `custom` |
| `title` | Display title |
| `config` | Step-specific configuration (which products to show, which attributes, etc.) |
| `transitions` | Array of next-step rules: condition -> target stepId |

### Workflow Instance
- A running instance of a workflow, tied to a specific quote.
- Tracks current step, completed steps, and step data.

---

## Requirements

### R-WF-1: Configurable Steps
Workflow steps and their order must be configurable per workflow definition. Not hard-coded in the UI component.

### R-WF-2: Branching Logic
Workflows must support conditional transitions — the next step can depend on user selections or business context (e.g. "customer has existing items" -> path selection step, otherwise -> skip to configure).

### R-WF-3: Standard Step Types
The engine must provide built-in step types for common patterns:
- Customer selection
- Path selection (new vs. existing)
- Product configuration (dynamic attribute form)
- Multi-item list (add/remove child items)
- Review & confirm
- Approval (future)

### R-WF-4: Workflow Selection
When starting a new quote, the system should auto-select the appropriate workflow based on context (product type, customer, quote type). Admin can also manually assign.

### R-WF-5: Resume & Back-Navigation
A workflow instance must support pause/resume and back-navigation. Users can revisit previous steps and the system re-validates forward steps.

### R-WF-6: Extensible Steps
Beyond built-in step types, it must be possible to register custom step types (as React components) for domain-specific needs.

---

## Current State

The Workflow Domain is **not yet implemented**. The current quoting wizard is a single React component with hard-coded steps. Extracting it into the Workflow Domain is a future phase that would:

1. Define the current 5-step flow as the default workflow definition
2. Build the workflow engine (step progression, transitions, state tracking)
3. Refactor the wizard UI to render steps dynamically from workflow definitions
4. Enable creating alternative workflows for different sales motions
