const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The user id to record as author. Sessions carry the user id in `sub`;
 * API keys carry `api_key:<id>` in `sub` and the owning user (if any) in
 * `userId`. Returns null when no user is behind the request, so callers can
 * refuse cleanly instead of writing a non-uuid into a uuid column.
 */
export function resolveAuditActor(auth: { sub?: string | null; userId?: string | null } | null | undefined): string | null {
  if (auth?.sub && UUID.test(auth.sub)) return auth.sub
  if (auth?.userId && UUID.test(auth.userId)) return auth.userId
  return null
}
