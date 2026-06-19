import { POST as topupsPost } from '../../../topups/route'

/**
 * `POST /api/billing/accounts/{id}/topups` (SPEC-002 P2).
 *
 * Spec-faithful nested path. Injects the path `id` as `billAccountId` into the
 * body and delegates to the flat `POST /api/billing/topups` handler so all the
 * RBAC / command-bus / side-effect plumbing lives in exactly one place.
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.topup.create'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const merged = { ...body, billAccountId: id }
  const forwarded = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(merged),
  })
  return topupsPost(forwarded)
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Initiate a prepaid top-up for an account',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      description:
        'Registers a BillingTopup (pending) and opens a payment session. The ' +
        'path `id` is the prepaid account; the balance is credited on capture. ' +
        'Body: `{ amount, providerKey?, successUrl?, cancelUrl?, sourceRef? }`.',
    },
  },
}
