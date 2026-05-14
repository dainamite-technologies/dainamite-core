import {
  CPQ_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  INVENTORY_SUBSCRIPTION_STATUSES,
  INVENTORY_SUBSCRIPTION_TRANSITIONS,
  INVENTORY_SUBSCRIPTION_ITEM_STATUSES,
  INVENTORY_ASSET_STATUSES,
  INVENTORY_ASSET_TRANSITIONS,
  CPQ_ORDER_STATUSES,
  CPQ_ORDER_TRANSITIONS,
  CPQ_QUOTE_TYPES,
  ARC_QUOTE_TYPES,
  CHANGE_LOG_TYPES,
  MERGE_ACTIONS,
  ARC_REASON_CODES,
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

  describe('operator override: any → any', () => {
    // Product decision: the status path is operator-driven. ALLOWED_TRANSITIONS
    // now encodes only the no-self-transition rule; semantic guards
    // (validateArcQuote, concurrent-ARC checks) live in transitionStatus.
    it.each([
      ['new', 'approved'],
      ['new', 'in_approval'],
      ['ready', 'approved'],
      ['incomplete', 'in_approval'],
      ['approved', 'accepted'],
      ['pre_approved', 'approved'],
      ['accepted', 'ready'],
      ['cancelled', 'new'],
    ] as const)('allows %s → %s', (from, to) => {
      expect(ALLOWED_TRANSITIONS[from]).toContain(to)
    })

    it('forbids self-transitions for every status', () => {
      for (const status of CPQ_STATUSES) {
        expect(ALLOWED_TRANSITIONS[status]).not.toContain(status)
      }
    })

    it('every source can reach every other status', () => {
      for (const from of CPQ_STATUSES) {
        const reachable = ALLOWED_TRANSITIONS[from]
        const others = CPQ_STATUSES.filter((s) => s !== from)
        expect(reachable.sort()).toEqual([...others].sort())
      }
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
      '%s is terminal metadata: still navigable per operator override',
      (status) => {
        // After the override we no longer expect terminals to have zero
        // outgoing transitions — operators can manually undo a terminal
        // decision (e.g. flip an accidental "rejected" back to "ready").
        expect(ALLOWED_TRANSITIONS[status].length).toBeGreaterThan(0)
        // But TERMINAL_STATUSES still flags these for other call sites
        // (e.g. removeQuoteItem blocks edits on terminals).
        expect(TERMINAL_STATUSES).toContain(status)
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
      'superseded',
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

// ─── ARC (XD-250) constants & transitions ──────────────────────

describe("ARC (XD-250) — quote types & enums", () => {
  it("CPQ_QUOTE_TYPES enumerates new + amend + renew + cancel", () => {
    expect(CPQ_QUOTE_TYPES).toEqual(["new", "amend", "renew", "cancel"])
  })

  it("ARC_QUOTE_TYPES is the non-new subset", () => {
    expect(ARC_QUOTE_TYPES).toEqual(["amend", "renew", "cancel"])
  })

  it("CHANGE_LOG_TYPES covers amend / renew / cancel + merge variants", () => {
    expect(CHANGE_LOG_TYPES).toEqual([
      "amend",
      "renew",
      "cancel",
      "merge-result",
      "merge-source",
    ])
  })

  it("MERGE_ACTIONS only allows standalone or absorb", () => {
    expect(MERGE_ACTIONS).toEqual(["standalone", "absorb"])
  })

  it("ARC_REASON_CODES includes the contract-life vocabulary", () => {
    expect(ARC_REASON_CODES).toEqual(
      expect.arrayContaining([
        "upgrade",
        "downgrade",
        "term-extension",
        "consolidation",
        "non-payment",
        "other",
      ]),
    )
  })
})

describe("ARC (XD-250) — subscription state machine extensions", () => {
  it("introduces \"superseded\" as a terminal status", () => {
    expect(INVENTORY_SUBSCRIPTION_STATUSES).toContain("superseded")
    expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.superseded).toEqual([])
  })

  it("active → superseded is allowed (merge source path)", () => {
    expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.active).toContain("superseded")
  })

  it("suspended → superseded is allowed (suspended subs can be absorbed)", () => {
    expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.suspended).toContain("superseded")
  })

  it("terminal statuses do not allow re-emerging into superseded", () => {
    expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.terminated).toEqual([])
    expect(INVENTORY_SUBSCRIPTION_TRANSITIONS.expired).toEqual([])
  })

  it("subscription-item statuses include superseded", () => {
    expect(INVENTORY_SUBSCRIPTION_ITEM_STATUSES).toContain("superseded")
  })
})

