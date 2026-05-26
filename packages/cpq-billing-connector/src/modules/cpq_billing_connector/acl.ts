/**
 * The connector is plumbing — it executes work in response to CPQ
 * events on the system's authority, not on a user's request. There
 * are therefore no operator-facing actions to gate at this layer.
 *
 * A future "manually replay CPQ events for subscription X" admin
 * feature (Phase 4b backstop for ops emergencies) would declare a
 * feature here.
 */
export const features = [] as const

export default features
