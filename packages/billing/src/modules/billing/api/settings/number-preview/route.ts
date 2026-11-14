import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { DOCUMENT_SERIES, renderNumber, sequenceScopeKey, validateMask } from '../../../lib/numbering'

/**
 * `GET /api/billing/settings/number-preview?mask=…` — validates a number
 * mask and renders an example for today (sequence 1) plus the counter scope
 * it would use. Pure: no sequence is read or claimed.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.settings.view'] },
}

const querySchema = z.object({ mask: z.string().max(200), series: z.enum(DOCUMENT_SERIES).optional() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }
  const errors = validateMask(parsed.data.mask)
  if (errors.length > 0) return NextResponse.json({ valid: false, errors })
  const today = new Date()
  return NextResponse.json({
    valid: true,
    errors: [],
    example: renderNumber(parsed.data.mask, { seq: 1, issueDate: today }),
    scopeKey: sequenceScopeKey(parsed.data.mask, today),
  })
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Preview a document number mask',
      description: 'Validates a number mask and returns an example number for today and its counter scope.',
    },
  },
}
