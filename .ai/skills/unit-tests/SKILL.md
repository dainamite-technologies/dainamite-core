---
name: unit-tests
description: Write and run Jest unit tests for Open Mercato modules — services, validators, state machines, and seeds. Use when the user says "write unit tests", "add unit tests", "test this service / validator", "run unit tests", or "yarn test". Covers conventions, mock-EM patterns, gotchas around `getBaseCurrencyCode` and lookup-with-fallback, error-throw forms, and the cross-check rule against the actual code.
---

# Unit Tests Skill

This skill produces executable Jest tests under module-local `__tests__/` directories (for example `src/modules/cpq/services/__tests__/cpqPricingService.test.ts`). Unit tests validate services, validators, state machines, and seeds **in isolation with mocked EM**; they do NOT exercise the running app or the database. Full-stack flows are covered by [`integration-tests`](../integration-tests/SKILL.md).

## Quick Reference

| Action | Command |
|--------|---------|
| Run all unit tests | `yarn test` (= `jest --config jest.config.cjs`) |
| Run a single file | `yarn test <path>` |
| Watch mode | `yarn test --watch` |
| Filter by name | `yarn test --testNamePattern="pattern"` |
| Test files location | `src/modules/<module>/<area>/__tests__/<unit>.test.ts` |
| Coverage | `yarn test --coverage` |

Jest config lives in `jest.config.cjs` at repo root, `setupFilesAfterEnv: ['<rootDir>/jest.setup.ts']`. `testMatch` is `src/**/__tests__/**/*.test.(ts|tsx)`. `passWithNoTests: true`.

## What to Test (per the Engineering Bar)

Every PR that adds or changes behavior in `src/modules/<id>/` MUST land tests for these layers:

| Layer changed | Required test |
|---|---|
| `services/<service>.ts` (new method or branch) | Unit test in `services/__tests__/<service>.test.ts`: happy path + each documented edge case |
| `data/validators.ts` | Round-trip: valid input parses, invalid input fails with stable error keys (`path`, `code`) |
| `services/types.ts` enum / state-machine | Transition table: every legal transition allowed, every illegal one rejected, terminal states have `[]` outgoing |
| `lib/seeds.ts` / `setup.ts` seeding | Snapshot-style: seeded shape doesn't drift accidentally |
| New API route | Non-trivial logic → handler test with mocked container; pure CRUD → covered by service test + integration test |
| New entity | Migration test (entity → diff matches generated migration) + service-level "can be created and re-fetched" |

**Out of scope for unit tests** (use Playwright integration tests instead): UI components, full HTTP flows with real DB, multi-step user journeys, sidebar navigation, real RBAC enforcement.

## Conventions

- One file per unit (`<service>.test.ts`). One `describe` block per public method.
- Test naming: `it('rejects X when Y')` — describe the contract, not the implementation.
- Use **real validators / Zod schemas / state machines**. Mock only at the EM and external-IO boundary.
- Money: assert on integer cents or stringified decimals — never on `Number` floats.
- Avoid snapshot tests except for seed shapes — they rot fast.
- Prefer parameterized `it.each([...])` for "every enum value behaves the same" cases.

## Workflow

### Phase 1 — Identify what to test

1. Read the source file(s) for the unit under test. Enumerate **every public method** and every documented branch (early returns, error throws, enum dispatch).
2. For services: list every dependency (EM, other services, generators, container resolutions). These are your mock surfaces.
3. For state machines / enums: enumerate the transition table. Every entry needs a positive test and at least one negative.
4. For validators: list every required field, every enum, every `refine()`, every `default()`, every nested schema.

### Phase 2 — Cross-check spec vs. code (MANDATORY)

Specs drift. Before finalizing test scope:

1. Open the relevant spec (`specs/implementation/xd-*.md`, `.ai/specs/SPEC-*.md`) for the module.
2. Compare against the actual code: enums, status names, validation rules, error codes.
3. Three classes of divergence:
   - **Code has feature, spec doesn't** → add the test for it; flag the spec gap to the user.
   - **Spec has feature, code doesn't** → do NOT write a test for it; flag (spec ahead of impl, or feature dropped).
   - **Behavior differs** (renamed field, removed status, tightened validation) → test against the **code**; flag spec as stale.
4. Also `git log` the module for behavior introduced without a spec update.
5. Report divergences in your summary so the user can reconcile.

This rule mirrors the same one in `integration-tests/SKILL.md` — code is the source of truth for "what exists"; spec for "what should exist".

### Phase 3 — Build the MockEm

Most service tests need a mocked `EntityManager`. The standard shape:

```typescript
interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>>
  findAndCount: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<[unknown[], number]>>
  count: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<number>>
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  persist: jest.MockedFunction<(entity: unknown) => unknown>
  assign: jest.MockedFunction<(entity: unknown, updates: Record<string, unknown>) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
  fork: jest.MockedFunction<() => MockEm>  // only if the service forks
}

function createMockEm(): MockEm {
  const em: MockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_e, data) => ({ id: 'new-id', ...data })),
    persist: jest.fn(),
    assign: jest.fn().mockImplementation((entity, updates) => {
      Object.assign(entity, updates)  // CRITICAL — see gotcha 5 below
      return entity
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}
```

Pass it to the service via `new DefaultXxxService(em as unknown as never)` (or via a deps object for services with multiple injected dependencies).

### Phase 4 — Order mocks to match the actual call sequence

`jest.fn().mockResolvedValueOnce(...)` consumes mocks in **call order**. List the source method's `em.findOne` / `em.find` calls top-to-bottom and queue mocks in the same order. Service helper methods (`loadCpqConfig`, `resolveOfferingInfo`, etc.) often add hidden lookups — read them first.

### Phase 5 — Write tests in this order

1. **Guard rails first** — 404 / 409 / 422 throws. Cheapest setup, biggest signal on contract violations.
2. **Happy paths** — full successful invocation.
3. **Edge cases** — empty arrays, terminal statuses, missing optional fields.
4. **Cross-cutting concerns** — pagination clamping, filter mapping, ordering options.

### Phase 6 — Verify

Run `yarn test`. If a test fails not because of a logic bug but because of a mock-ordering surprise, that surprise is itself worth documenting (add a comment near the mock setup).

## Common Pitfalls (each of these has bitten us)

### 1. `getBaseCurrencyCode` consumes a hidden `em.findOne`

`services/types.ts → getBaseCurrencyCode(em, scope)` does a dynamic `import('@open-mercato/core/.../currencies/data/entities')` and then `em.findOne(Currency, ...)`. Any service path that falls through to it (when no `currencyCode` is provided) consumes a mock you didn't account for, shifting the rest of the sequence.

**Fix:** always pass an explicit `currencyCode` in test inputs, or insert an extra `em.findOne.mockResolvedValueOnce(null)` at the right position to absorb the Currency lookup.

### 2. Lookup-with-fallback consumes 2 `findOne` calls when the first misses

Many services have a "by id, then by `<entity>Id`" lookup pattern (`loadCpqConfig`, `loadOrderConfig`, `convertQuoteToOrder`). When the first lookup returns `null`, the second runs. Tests for the **404 path** need TWO `mockResolvedValueOnce(null)`, not one.

```typescript
// 404 case — both lookups miss
em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
await expect(service.getOrder('missing', SCOPE)).rejects.toMatchObject({ status: 404 })
```

### 3. `buildXResult` often recomputes from line configs, ignoring entity-persisted aggregates

`buildQuoteResult`, `buildOrderResult`, and similar helpers may run `computePricingSummary(lineConfigs, ...)` rather than reading the entity's persisted `pricingSummary`. With no lines, the result is **always zero** — even if the entity has 1500/200 stored.

**Implication for tests:** assertions on derived aggregates need either real line configs or an explicit acknowledgement that the field is recomputed (use a "NOTE:" test that pins the behavior).

### 4. Inconsistent error-throw forms across services

| Service | Throws |
|---|---|
| `cpqQuotingService` | `throw new QuotingError(status, message, cpqStatus?)` — Error subclass with `status`, `message`, `cpqStatus` |
| `cpqOrderService` | `throw new OrderError(status, message)` — Error subclass with `status`, `message` |
| `cpqInventoryService` | `throw { status, error }` — **plain object**, not an Error |

Assertion patterns differ:

```typescript
// QuotingError / OrderError (Error subclass)
await expect(service.foo()).rejects.toMatchObject({ status: 409, message: 'Bad transition' })

// Inventory service (plain object)
await expect(service.foo()).rejects.toMatchObject({ status: 409, error: 'Bad transition' })
```

When testing a new service, **read the throws first** — the property name (`message` vs `error`) is not consistent.

### 5. `em.assign` mock MUST mutate the entity in place

Many services do `em.assign(entity, updates)` and **then read fields back from `entity`**. If your `assign` mock doesn't mutate, those reads return stale values and tests fail in confusing ways. Use `Object.assign(entity, updates)` inside the mock implementation (shown in the standard MockEm above).

### 6. `em.fork()` returns a new EM in production — mock it to return self

Methods like `recalculate({ save: true })` call `this.em.fork()` to get an isolated UoW. Mock `fork` to return the **same** mock EM instance, so your `findOne` queue keeps working:

```typescript
em.fork.mockReturnValue(em)
```

### 7. `jest.fn().mockResolvedValueOnce` is order-sensitive

If you set up four `mockResolvedValueOnce` calls but the service makes five `findOne` calls, the fifth returns `undefined` — usually surfacing as "Cannot read property 'X' of undefined" deep inside the service. Re-read the source method top-to-bottom and count every `em.findOne` / `em.find` (including helpers).

### 8. MikroORM entities import safely; you don't need to mock the entity classes

Entity classes from `data/entities.ts` use MikroORM decorators. Importing them in tests is fine — decorators just register metadata, no DB connection needed. You only need to mock `em.find(Entity, ...)` etc., not the `Entity` class itself.

### 9. `jest.mocked()` types over the mock — use `as unknown as never` casts only when the production type is too strict

When passing the mock to a constructor that expects a real `EntityManager`, TS will complain. The double cast `em as unknown as never` is the established workaround in this repo. Don't try to make MockEm extend EntityManager — too many private fields.

## Reference Patterns

### Validator round-trip

```typescript
import { mySchema } from '../validators'

describe('mySchema', () => {
  it('parses a valid input and applies defaults', () => {
    const r = mySchema.safeParse({ code: 'X', name: 'Y' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.lifecycleStatus).toBe('draft')
  })

  it('rejects empty code with a stable path', () => {
    const r = mySchema.safeParse({ code: '', name: 'Y' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'code')).toBe(true)
    }
  })

  it.each(['simple', 'bundle'] as const)('accepts specType=%s', (specType) => {
    expect(mySchema.safeParse({ code: 'X', name: 'Y', specType }).success).toBe(true)
  })
})
```

### State-machine table

```typescript
import { ALLOWED_TRANSITIONS, CPQ_STATUSES, TERMINAL_STATUSES } from '../types'

describe('CPQ state machine', () => {
  it('every status has a transitions entry', () => {
    for (const s of CPQ_STATUSES) expect(ALLOWED_TRANSITIONS).toHaveProperty(s)
  })

  it('every transition target is itself a declared status', () => {
    const declared = new Set<string>(CPQ_STATUSES)
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const t of targets) expect(declared.has(t)).toBe(true)
    }
  })

  it.each(TERMINAL_STATUSES)('terminal %s has no outgoing', (s) => {
    expect(ALLOWED_TRANSITIONS[s]).toEqual([])
  })

  it('forbids new → approved (must go via in_approval)', () => {
    expect(ALLOWED_TRANSITIONS.new).not.toContain('approved')
  })
})
```

### Service with mocked EM

```typescript
import { DefaultMyService } from '../myService'

describe('DefaultMyService.doThing', () => {
  let em: MockEm
  let service: DefaultMyService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultMyService(em as unknown as never)
  })

  it('throws 404 when entity is missing', async () => {
    em.findOne.mockResolvedValueOnce(null)
    await expect(service.doThing('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('mutates and flushes when entity exists', async () => {
    const entity = { id: 'e1', status: 'draft' }
    em.findOne.mockResolvedValueOnce(entity)

    await service.doThing('e1', SCOPE)

    expect(entity.status).toBe('active')
    expect(em.flush).toHaveBeenCalled()
  })
})
```

## Boundary with Integration Tests

| Question | Layer |
|---|---|
| "Does this function compute the right shape with mocked deps?" | Unit (this skill) |
| "Does the validator reject an invalid `path` with the right `code`?" | Unit |
| "Are illegal status transitions rejected at the service layer?" | Unit |
| "Does `POST /api/cpq/quotes` create a row in the DB the user can list?" | Integration ([`integration-tests`](../integration-tests/SKILL.md)) |
| "Does the wizard render and submit through the real UI?" | Integration |

Unit tests run in milliseconds and isolate logic. Integration tests run in seconds and exercise the full stack. They are **complementary, not substitutes**.

## Rules

- MUST cross-check the spec against actual code before finalizing scope (Phase 2).
- MUST mock only at the EM and external-IO boundary; use real validators, schemas, and state-machine tables.
- MUST handle the order-sensitivity of `mockResolvedValueOnce`; count `em.findOne` / `em.find` calls in source.
- MUST account for `getBaseCurrencyCode` consuming a `findOne` when the path falls through to it.
- MUST mutate inside the `assign` mock (`Object.assign(entity, updates)`) when service reads back.
- MUST use the right error-throw assertion form per service (`message` vs `error`).
- MUST keep tests deterministic — no real time, no real network, no real filesystem.
- MUST verify `yarn test` green before finishing.
- MUST report any spec/code divergence found during Phase 2 in the summary.
- MUST NOT mock pure functions or other services unless absolutely necessary — use real instances with mocked EM.
- MUST NOT assert on `Number` floating-point money values — assert integer cents or stringified decimals.
- SHOULD parameterize repetitive enum-iteration tests with `it.each([...])`.
- SHOULD pin surprising production behavior with a "NOTE:" test rather than work around it silently.
