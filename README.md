# Dainamite
Open-source revenue management framework for subscription businesses.

Product Catalog, CPQ (configure-price-quote), Order Management & Subscription Billing.
Tailored to fit your business. 

Built on open-source foundations for you to own, with no per-seat tax.

Website: dainamite.com

Powered by Open Mercato

## Installation Steps

### Prerequisites

  - Node ≥ 24 — enforced by the preinstall hook and engines field
  - Yarn 4.12 — via Corepack (corepack enable)
  - Docker — for Postgres, Redis, Meilisearch

### Local Setup

1. `docker compose up -d` - start docker services
2. `yarn install` - install npm packages
3. `yarn build`- generate modules (from DI), build packages
4. `yarn setup` or `yarn setup --reinstall` - migrate db, seed sample data
5. `yarn dev`- start dev server

### Running as a standalone app

tbd.