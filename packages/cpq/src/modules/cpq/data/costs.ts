/**
 * Cost-plus pricing (App Spec `2026-11-11-app-spec-cpq-cost-plus-pricing.md`).
 * Pure constants and schemas shared by services, routes, setup and the UI.
 */

/** Tenant feature toggle (R14): boolean, default off, per-tenant override. */
export const COST_PLUS_TOGGLE = 'cpq.cost_plus'

/** See cost values, suppliers, markup and margin (App Spec §1.4.10). */
export const COSTS_VIEW_FEATURE = 'cpq.costs.view'
/** Add / edit manual costs, enter or confirm costs, markup overrides. */
export const COSTS_MANAGE_FEATURE = 'cpq.costs.manage'
