---
'@dainamite/cpq': minor
---

The CPQ Quoting Assistant can now find the customer of a quote: the read-only core tools `customers.list_companies`, `customers.get_company`, `customers.list_people`, `customers.get_person`, `customers.list_deals` and `customers.get_deal` are on its allowlist, and the prompt tells it to use them for the `customerId` and `dealId` of `cpq.create_quote`. Before, drafting a quote from the chat needed a built search index. New starter suggestion "Draft a quote". Run `yarn generate` after upgrading.

Fix: `GET /api/cpq/quotes?search=` answered 500 for every search (it ran `ilike` on uuid columns). It now matches the quote number (case-insensitive substring) or an exact quote, sales quote or customer id, so the agent can find "QUOTE-20261123-00003".
