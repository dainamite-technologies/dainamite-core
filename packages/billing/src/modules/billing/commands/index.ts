/**
 * Billing module command registry.
 *
 * Each file below side-effect-registers its commands via
 * `registerCommand(...)` from `@open-mercato/shared/lib/commands`.
 * Importing this barrel forces the registrations to run. The CRUD
 * factory's `commandId` lookups then resolve at request time.
 */
import './accounts'
import './items'
import './usage'
import './runs'
