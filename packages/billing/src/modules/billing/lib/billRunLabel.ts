/**
 * Human-readable label for a Bill Run.
 *
 * The BillRun entity has no `name` column — the engine keys runs by id.
 * The admin UI derives a stable, scannable label from the run's as-of
 * date so operators see `BILL_RUN_2026-05-20` instead of a raw UUID.
 */
export function billRunName(asOfDate: string | null | undefined): string {
  const date =
    typeof asOfDate === 'string' && asOfDate.length >= 10
      ? asOfDate.slice(0, 10)
      : 'unknown'
  return `BILL_RUN_${date}`
}
