---
"@dainamite/cpq": minor
---

Manual pricing flexibility (spec `2026-11-26-cpq-manual-pricing-flexibility`):

- Line-level **Set price** and **Amount off** for the line's recurring or one-time total (`chargeTypeFilter` required, `CHARGE_TYPE_REQUIRED` otherwise), spread over the line's charges in proportion to their standard totals (cent remainder to the largest charge; all charges at 0 → first charge). On a bundle parent it sets the bundle total.
- Charge-level adjustments still win; a line Set price is then spread over the remaining charges so the line total equals the typed price.
- **Set charge total** on volume and tiered charges.
- Any manual price may exceed standard: `ABOVE_STANDARD` is no longer raised (the code stays in the error enum for stored errors). Uplifts show as a negative discount with an "Above standard" badge.
- The line row's % icon is now an **Adjust price** button; the dialog previews standard → new price and depth.
