// The review events of a run in AuditLog (validation-runs D7, D16), shared by the validation repository and by the
// settlement transactions that depend on them: processing checks them, and undoing an attempt invalidates them.
import type { InvalidationReason } from '@recon/shared'
import type { Prisma } from '../../../generated/prisma/client.js'

export const REVIEW = 'import.review'
export const INVALIDATE = 'import.review.invalidate'

/** The last review event of the run is a review, not an invalidation. */
export async function reviewIsValid(tx: Prisma.TransactionClient, importId: string, runId: number): Promise<boolean> {
  const [last] = await tx.$queryRaw<{ action: string }[]>`
    SELECT TOP 1 [action] FROM [AuditLog]
    WHERE [entityType] = 'Import' AND [entityId] = ${importId}
      AND [action] IN ('import.review', 'import.review.invalidate')
      AND JSON_VALUE([detailJson], '$.runId') = ${String(runId)}
    ORDER BY [createdAt] DESC, [auditId] DESC`
  return last?.action === REVIEW
}

/** AuditLog `import.review.invalidate` with the reviewer of the last review of that run copied (D16). */
export async function recordInvalidation(
  tx: Prisma.TransactionClient,
  importId: string,
  runId: number,
  userId: number,
  now: Date,
  extra: { reason: InvalidationReason; newRunId?: number; occurrenceId?: string },
): Promise<void> {
  // The reviews of an import are a handful: filtering by runId here avoids depending on the JSON text.
  const reviews = await tx.auditLog.findMany({
    where: { entityType: 'Import', entityId: importId, action: REVIEW },
    orderBy: [{ createdAt: 'desc' }, { auditId: 'desc' }],
    select: { userId: true, createdAt: true, detailJson: true },
  })
  const review = reviews.find((r) => JSON.parse(r.detailJson ?? '{}').runId === runId)
  await tx.auditLog.create({
    data: {
      userId,
      action: INVALIDATE,
      entityType: 'Import',
      entityId: importId,
      createdAt: now,
      detailJson: JSON.stringify({
        runId,
        reviewedByUserId: review?.userId ?? null,
        reviewedAt: review?.createdAt.toISOString() ?? null,
        ...extra,
      }),
    },
  })
}
