import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { cpqOrderLineCostReconfirmSchema } from '../data/order-costs'
import { costCommandIdentity } from '../lib/costCommandContext'
import type { CpqOrderCostReconfirmService, OrderCostReconfirmResult } from '../services/costs/orderCostReconfirm'

const id = z.string().uuid()
const reconfirmSchema = z.object({ orderId: id, orderLineCostId: id, patch: cpqOrderLineCostReconfirmSchema }).strict()

/**
 * Re-confirmation of an order line cost (ARC costs spec Q-D13). NOT undoable and NOT replayable: an undo / redo
 * payload would have to hold amounts, suppliers and notes, and the action log is readable outside `cpq.costs.view`.
 * The snapshots carry ids, statuses, roles and the cost key only. Emits no event (Q12); the activation does.
 */
export const reconfirmOrderLineCostCommand: CommandHandler<z.infer<typeof reconfirmSchema>, OrderCostReconfirmResult> = {
  id: 'cpq.order_line_cost.reconfirm', isUndoable: false,
  async execute(input, ctx) {
    const parsed = reconfirmSchema.parse(input)
    const { actor, scope } = await costCommandIdentity(ctx, ['cpq.orders.manage', 'cpq.costs.manage'])
    return ctx.container.resolve<CpqOrderCostReconfirmService>('cpqOrderCostReconfirmService')
      .reconfirm(parsed.orderId, parsed.orderLineCostId, parsed.patch, actor, scope)
  },
  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cpq.costs.audit.reconfirm', 'Re-confirm order cost'),
      resourceKind: 'cpq.order_line_cost', resourceId: result.audit.after.id,
      snapshotBefore: result.audit.before, snapshotAfter: result.audit.after,
      replayable: false as const,
    }
  },
}
registerCommand(reconfirmOrderLineCostCommand)
