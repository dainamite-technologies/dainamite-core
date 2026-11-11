import { resolveAuditActor } from '../auditActor'

const user = '77777777-7777-4777-8777-777777777777'
it.each([
  [{ sub: user }, user],
  [{ sub: 'api_key:abc', userId: user }, user],
  [{ sub: 'api_key:abc' }, null],
  [{ sub: 'api_key:abc', userId: 'not-a-uuid' }, null],
  [null, null],
])('%j → %s', (auth, expected) => {
  expect(resolveAuditActor(auth)).toBe(expected)
})
