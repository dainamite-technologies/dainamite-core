import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PAYMENT_IMPORT_MAX_BYTES } from '../../../data/validators'
import { readRequestBody, runCommandRoute } from '../../../lib/commandRoute'

/**
 * `POST /api/billing/payments/import` — bank CSV upload (Spec C, C-D4).
 * Accepts `multipart/form-data` (`file`) or JSON `{ fileName, content }`.
 * 413 over 2 MB. Returns the import summary (counts per outcome + row errors).
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.import'] },
}

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().max(PAYMENT_IMPORT_MAX_BYTES),
})

async function readUpload(req: Request): Promise<unknown | Response> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > PAYMENT_IMPORT_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'The file is larger than 2 MB', code: 'billing.payment_import.too_large' }, { status: 413 })
  }
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return { fileName: '', content: '' }
    if (file.size > PAYMENT_IMPORT_MAX_BYTES) {
      return NextResponse.json({ error: 'The file is larger than 2 MB', code: 'billing.payment_import.too_large' }, { status: 413 })
    }
    return { fileName: file.name || 'payments.csv', content: await file.text() }
  }
  return readRequestBody(req)
}

export async function POST(req: Request) {
  const body = await readUpload(req.clone())
  if (body instanceof Response) return body
  return runCommandRoute(
    req,
    {
      commandId: 'billing.payments.import',
      bodySchema,
      resourceKind: 'billing.payment_import',
      resourceId: () => null,
      logLabel: 'billing/payments/import.POST',
    },
    body,
  )
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Import bank payments from CSV',
      description:
        'CSV header `date,amount,currency,reference,payer_name,payer_account` (UTF-8, comma separated, ' +
        '"." decimals, amount > 0, ≤ 5,000 rows, ≤ 2 MB). Each new row becomes a payment, matched by the ' +
        'invoice number in `reference`; re-uploaded lines are counted as duplicates. Send multipart `file` or ' +
        'JSON `{ fileName, content }`.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: '`{ importId, fileName, rowCount, counts, errors[] }`' }],
      errors: [
        { status: 400, description: '`billing.payment_import.invalid_file` (header / empty / too many rows)' },
        { status: 413, description: '`billing.payment_import.too_large`' },
      ],
    },
  },
}
