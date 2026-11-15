import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { createAttachmentFromBuffer } from '@open-mercato/core/modules/attachments/lib/createFromBuffer'

/**
 * Thin adapter over core `attachments` (a platform module billing requires,
 * P-D1): stores frozen invoice PDFs and reads stored files (PDFs, the
 * settings logo). The only place billing touches the attachments module, so
 * tests mock this file instead of storage drivers.
 */

export type StoredFile = { bytes: Uint8Array; mimeType: string; fileName: string }
export type FileScope = { tenantId: string; organizationId: string }

export async function storeAttachment(
  em: EntityManager,
  scope: FileScope,
  params: { entityId: string; recordId: string; fileName: string; mimeType: string; bytes: Uint8Array },
): Promise<string> {
  const created = await createAttachmentFromBuffer({
    em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entityId: params.entityId,
    recordId: params.recordId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    buffer: Buffer.from(params.bytes),
  })
  return created.id
}

/** Reads a stored attachment of this scope; null when missing or unreadable. */
export async function readAttachment(em: EntityManager, scope: FileScope, attachmentId: string): Promise<StoredFile | null> {
  const attachment = await em.findOne(Attachment, {
    id: attachmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as never)
  if (!attachment) return null
  try {
    const driver = await new StorageDriverFactory(em).resolveForPartition(attachment.partitionCode, scope)
    const { buffer } = await driver.read(attachment.partitionCode, attachment.storagePath)
    return {
      bytes: new Uint8Array(buffer),
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      fileName: attachment.fileName,
    }
  } catch (err) {
    console.warn('[billing.pdf] attachment could not be read', attachmentId, err)
    return null
  }
}

/** Attachment id from an `/api/attachments/file/<id>` (or image) URL — e.g. `Organization.logo_url`. */
export function attachmentIdFromUrl(url: string | null | undefined): string | null {
  const match = /\/api\/attachments\/(?:file|image)\/([0-9a-f-]{36})/i.exec(url ?? '')
  return match ? match[1] : null
}
