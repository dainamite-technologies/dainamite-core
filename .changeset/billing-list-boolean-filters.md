---
'@dainamite/billing': patch
---

List filters `isActive` (accounts, items) and `rated` (usage) read the query string literally. `?isActive=false` used to be parsed as `true`, so the accounts page filter "Inactive" showed active accounts. Now `false` returns inactive accounts and unrated usage.
