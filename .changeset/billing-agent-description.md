---
'@dainamite/billing': patch
---

The `billing.operator_assistant` description no longer says "Read-only by default". The agent uses `mutationPolicy: 'confirm-required'`: it can start dry or test Bill Runs and record manual payments, and every write goes through the approval card.
