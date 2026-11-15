import { daysOverdue, daysOverdueSql, isOverdue, overdueSql } from '../../lib/overdue'

const today = new Date('2026-11-14T15:00:00Z')
const base = { status: 'posted', documentType: 'invoice', dueDate: '2026-11-10', outstanding: '100.0000' }

describe('overdue predicate (B-D6)', () => {
  it('posted / partially paid receivables past due with outstanding > 0 are overdue', () => {
    expect(daysOverdue(base, today)).toBe(4)
    expect(isOverdue({ ...base, status: 'partially_paid' }, today)).toBe(true)
    expect(isOverdue({ ...base, documentType: 'debit_memo' }, today)).toBe(true)
  })

  it('the due date itself is not overdue (strictly before today)', () => {
    expect(isOverdue({ ...base, dueDate: '2026-11-14' }, today)).toBe(false)
    expect(daysOverdue({ ...base, dueDate: new Date('2026-11-13T00:00:00Z') }, today)).toBe(1)
  })

  it('drafts, paid, credited, receipts, credit memos and settled documents are never overdue', () => {
    for (const status of ['draft', 'paid', 'credited']) expect(isOverdue({ ...base, status }, today)).toBe(false)
    expect(isOverdue({ ...base, documentType: 'receipt' }, today)).toBe(false)
    expect(isOverdue({ ...base, documentType: 'credit_memo' }, today)).toBe(false)
    expect(isOverdue({ ...base, outstanding: '0' }, today)).toBe(false)
    expect(isOverdue({ ...base, outstanding: -5 }, today)).toBe(false)
    expect(isOverdue({ ...base, dueDate: null }, today)).toBe(false)
  })

  it('SQL mirrors the predicate with one / two bound dates', () => {
    const sql = overdueSql('i')
    expect(sql).toContain("i.status IN ('posted', 'partially_paid')")
    expect(sql).toContain("i.document_type IN ('invoice', 'debit_memo')")
    expect(sql).toContain('i.due_date < ?::date')
    expect(sql).toContain('i.outstanding > 0')
    expect((sql.match(/\?/g) ?? []).length).toBe(1)
    expect((daysOverdueSql('i').match(/\?/g) ?? []).length).toBe(2)
  })
})
