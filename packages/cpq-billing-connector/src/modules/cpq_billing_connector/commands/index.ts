/**
 * Connector command registry. Each file side-effect-registers its commands
 * via `registerCommand(...)`; `index.ts` imports this barrel so they are
 * registered whenever the module loads.
 */
import './orderSetup'
