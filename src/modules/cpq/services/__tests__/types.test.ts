import {
  CPQ_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  INVENTORY_SUBSCRIPTION_STATUSES,
  INVENTORY_SUBSCRIPTION_TRANSITIONS,
  INVENTORY_ASSET_STATUSES,
  INVENTORY_ASSET_TRANSITIONS,
  CPQ_ORDER_STATUSES,
  CPQ_ORDER_TRANSITIONS,
} from '../types'

describe('CPQ quote lifecycle (CPQ_STATUSES / ALLOWED_TRANSITIONS)', () => {
  it('declares all expected statuses', () => {
    expect(CPQ_STATUSES).toEqual([
      'new',
      'incomplete',
      'ready',
      'in_approval',
      'pre_approved',
      'approved',
      'with_customer',
      'accepted',
      'rejected',
      'cancelled',
    ])
  })

  it('every status has an entry in ALLOWED_TRANSITIONS', () => {
    for (const status of CPQ_STATUSES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(status)
      expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true)
    }
  })

  it('every transition target is itself a declared status', () => {
    const declared = new Set<string>(CPQ_STATUSES)
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const target of targets) {
        expect(declared.has(target)).toBe(true)
      }
      expect(from).toBeDefined()
    }
  })

  describe('happy path transitions', () => {
    it('allows new → incomplete and new → ready', () => {
      expect(ALLOWED_TRANSITIONS.new).toContain('incomplete')
      expect(ALLOWED_TRANSITIONS.new).toContain('ready')
    })

    it('allows ready → in_approval (kick off approval)', () => {
      expect(ALLOWED_TRANSITIONS.ready).toContain('in_approval')
    })

    it('allows in_approval → approved and in_approval → rejected', () => {
      expect(ALLOWED_TRANSITIONS.in_approval).toContain('approved')
      expect(ALLOWED_TRANSITIONS.in_approval).toContain('rejected')
    })

    it('allows approved → with_customer (send to customer)', () => {
      expect(ALLOWED_TRANSITIONS.approved).toContain('with_customer')
    })

    it('allows pre_approved → with_customer (skip-approval path)', () => {
      expect(ALLOWED_TRANSITIONS.pre_approved).toContain('with_customer')
    })

    it('allows with_customer → accepted / rejected (customer decision)', () => {
      expect(ALLOWED_TRANSITIONS.with_customer).toContain('accepted')
      expect(ALLOWED_TRANSITIONS.with_customer).toContain('rejected')
    })

    it('allows cancelling from any non-terminal status', () => {
      const nonTerminal: Array<keyof typeof ALLOWED_TRANSITIONS> = [
        'new',
        'incomplete',
        'ready',
        'in_approval',
        'with_customer',
      ]
      for (const status of nonTerminal) {
        expect(ALLOWED_TRANSITIONS[status]).toContain('cancelled')
      }
    })
  })

  describe('illegal transitions', () => {
    it('forbids new → approved (cannot bypass approval flow)', () => {
      expect(ALLOWED_TRANSITIONS.new).not.toContain('approved')
    })

    it('forbids new → in_approval (must pass through ready first)', () => {
      expect(ALLOWED_TRANSITIONS.new).not.toContain('in_approval')
    })

    it('forbids ready → approved (must go through in_approval)', () => {
      expect(ALLOWED_TRANSITIONS.ready).not.toContain('approved')
    })

    it('forbids incomplete → in_approval (must reach ready first)', () => {
      expect(ALLOWED_TRANSITIONS.incomplete).not.toContain('in_approval')
    })

    it('forbids approved → accepted directly (must go via with_customer)', () => {
      expect(ALLOWED_TRANSITIONS.approved).not.toContain('accepted')
    })

    it('forbids pre_approved → approved (alternate path is one-way)', () => {
      expect(ALLOWED_TRANSITIONS.pre_approved).not.toContain('approved')
    })
  })

  describe('terminal statuses', () => {
    it('TERMINAL_STATUSES contains accepted, rejected, cancelled', () => {
      expect(TERMINAL_STATUSES).toEqual(
        expect.arrayContaining(['accepted', 'rejected', 'cancelled']),
      )
      expect(TERMINAL_STATUSES).toHaveLength(3)
    })

    it.each(['accepted', 'rejected', 'cancelled'] as const)(
      '%s is terminal: no outgoing transitions',
      (status) => {
        expect(ALLOWED_TRANSITIONS[status]).toEqual([])
      },
    )
  })
})

describe('Inventory subscription lifecycle', () => {
  it('declares the expected statuses', () => {
    expect(INVENTORY_SUBSCRIPTION_STATUSES).toEqual([
      'pending',
      'active',
      'suspended',
      'terminated',
      'expired',
    ])
  })

  it('every status has a transitions entry', () => {
    for (const status of INVENTORY_SUBSCRIPTION_STATUSES) {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS).toHaveProperty(status)
    }
  })

  describe('legal transitions', () => {
    it('pending → active activates a subscription', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.pending).toContain('active')
    })

    it('active → suspended pauses a subscription', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.active).toContain('suspended')
    })

    it('suspended → active resumes a subscription', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.suspended).toContain('active')
    })

    it('active → expired covers the renewal-end path', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.active).toContain('expired')
    })

    it('any non-terminal status can be terminated', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.pending).toContain('terminated')
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.active).toContain('terminated')
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.suspended).toContain('terminated')
    })
  })

  describe('illegal transitions', () => {
    it('pending → suspended is forbidden (must activate first)', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.pending).not.toContain('suspended')
    })

    it('terminated and expired are terminal', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.terminated).toEqual([])
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.expired).toEqual([])
    })

    it('suspended → expired is forbidden (must reactivate first)', () => {
      expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.suspended).not.toContain('expired')
    })
  })
})

describe('Inventory asset lifecycle', () => {
  it('declares the expected statuses', () => {
    expect(INVENTORY_ASSET_STATUSES).toEqual([
      'pending',
      'delivered',
      'active',
      'returned',
      'cancelled',
    ])
  })

  describe('legal transitions', () => {
    it('pending can move to delivered, active, or cancelled', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.pending).toEqual(
        expect.arrayContaining(['delivered', 'active', 'cancelled']),
      )
    })

    it('delivered → active and delivered → returned', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.delivered).toContain('active')
      expect(INVENTORY_ASSET_TRANSITIONS.delivered).toContain('returned')
    })

    it('active → returned (only return is valid from active)', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.active).toEqual(['returned'])
    })
  })

  describe('illegal transitions', () => {
    it('returned and cancelled are terminal', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.returned).toEqual([])
      expect(INVENTORY_ASSET_TRANSITIONS.cancelled).toEqual([])
    })

    it('active → cancelled is forbidden (delivered assets cannot be cancelled, only returned)', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.active).not.toContain('cancelled')
    })

    it('pending → returned is forbidden (must be delivered first)', () => {
      expect(INVENTORY_ASSET_TRANSITIONS.pending).not.toContain('returned')
    })
  })
})

describe('CPQ order lifecycle', () => {
  it('declares the expected statuses', () => {
    expect(CPQ_ORDER_STATUSES).toEqual([
      'draft',
      'pending_activation',
      'active',
      'cancelled',
      'fulfilled',
    ])
  })

  describe('legal transitions', () => {
    it('draft can go to pending_activation, active, or cancelled', () => {
      expect(CPQ_ORDER_TRANSITIONS.draft).toEqual(
        expect.arrayContaining(['pending_activation', 'active', 'cancelled']),
      )
    })

    it('pending_activation → active or cancelled', () => {
      expect(CPQ_ORDER_TRANSITIONS.pending_activation).toContain('active')
      expect(CPQ_ORDER_TRANSITIONS.pending_activation).toContain('cancelled')
    })

    it('active → fulfilled or cancelled', () => {
      expect(CPQ_ORDER_TRANSITIONS.active).toContain('fulfilled')
      expect(CPQ_ORDER_TRANSITIONS.active).toContain('cancelled')
    })
  })

  describe('illegal transitions', () => {
    it('cancelled and fulfilled are terminal', () => {
      expect(CPQ_ORDER_TRANSITIONS.cancelled).toEqual([])
      expect(CPQ_ORDER_TRANSITIONS.fulfilled).toEqual([])
    })

    it('draft → fulfilled is forbidden (must activate first)', () => {
      expect(CPQ_ORDER_TRANSITIONS.draft).not.toContain('fulfilled')
    })

    it('pending_activation → fulfilled is forbidden (must activate first)', () => {
      expect(CPQ_ORDER_TRANSITIONS.pending_activation).not.toContain('fulfilled')
    })
  })
})
