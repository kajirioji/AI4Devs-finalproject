// The actions on an attempt, each in one transaction with a guarded UPDATE (settlement-lifecycle design D2–D4): the
// status it comes from is decided by the guard, so two overlapping actions leave one transition and one audit row.
import { BatchStatus } from '@recon/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js'
import { NotFoundError } from '../../../shared/errors.js'
import type { MissingResolution } from '../../validation/application/ports.js'
import { transitionErrorOf } from '../application/errors.js'
import type { LifecycleCommand, ReasonCommand, SettlementLifecycleRepository } from '../application/ports.js'
import { LIFECYCLE_MOVES, type LifecycleAction, transitionOf } from '../domain/batch-lifecycle.js'
import { withDeadlockRetry } from './deadlock-retry.js'

type Tx = Prisma.TransactionClient

export interface SettlementLifecycleRepositoryOptions {
  missing: MissingResolution
  log?: Pick<FastifyBaseLogger, 'warn'>
  /**
   * Awaited inside the transaction right before the first guard, without holding any lock: tests pause an action there
   * so another request commits in between.
   */
  beforeClaim?: (operation: LifecycleAction) => Promise<void>
}

interface ClaimedBatch {
  importId: string
  batchNo: number
  attemptNo: number
}

const TX_TIMEOUT_MS = 60_000
const TX_MAX_WAIT_MS = 10_000

const instant = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

export class PrismaSettlementLifecycleRepository implements SettlementLifecycleRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: SettlementLifecycleRepositoryOptions,
  ) {}

  /** processed → paid. Settled is derived from the status: the movements are not touched. */
  async pay(command: LifecycleCommand): Promise<void> {
    const { batchId, userId, now } = command
    const { from, to } = LIFECYCLE_MOVES.pay
    await this.transaction('pay', batchId, async (tx) => {
      const [claimed] = await tx.$queryRaw<ClaimedBatch[]>`
        UPDATE [SettlementBatch]
        SET [status] = ${to}, [paidAt] = CAST(${now.toISOString()} AS datetime2(7)), [paidByUserId] = ${userId},
          [updatedAt] = CAST(${now.toISOString()} AS datetime2(7))
        OUTPUT LOWER(CONVERT(VARCHAR(36), inserted.[importId])) AS importId, inserted.[batchNo], inserted.[attemptNo]
        WHERE [batchId] = ${batchId} AND [status] = ${from}`
      if (claimed === undefined) await this.reject(tx, batchId, 'pay')
      else await this.audit(tx, 'settlement.pay', command, { ...claimed, reason: null })
    })
  }

  /** paid → processed, emptying the payment fields: the previous payment stays in the audit (design D3). */
  async unpay(command: ReasonCommand): Promise<void> {
    const { batchId, now, reason } = command
    const { from, to } = LIFECYCLE_MOVES.unpay
    await this.transaction('unpay', batchId, async (tx) => {
      const [claimed] = await tx.$queryRaw<
        (ClaimedBatch & { previousPaidAt: Date | string | null; previousPaidByUserId: number | null })[]
      >`
        UPDATE [SettlementBatch]
        SET [status] = ${to}, [paidAt] = NULL, [paidByUserId] = NULL,
          [updatedAt] = CAST(${now.toISOString()} AS datetime2(7))
        OUTPUT LOWER(CONVERT(VARCHAR(36), inserted.[importId])) AS importId, inserted.[batchNo], inserted.[attemptNo],
          deleted.[paidAt] AS previousPaidAt, deleted.[paidByUserId] AS previousPaidByUserId
        WHERE [batchId] = ${batchId} AND [status] = ${from}`
      if (claimed === undefined) await this.reject(tx, batchId, 'unpay')
      else
        await this.audit(tx, 'settlement.unpay', command, {
          importId: claimed.importId,
          batchNo: claimed.batchNo,
          attemptNo: claimed.attemptNo,
          reason,
          previousPaidAt: instant(claimed.previousPaidAt),
          previousPaidByUserId: claimed.previousPaidByUserId,
        })
    })
  }

  /** The transaction, retried as processing when SQL Server chooses it as a deadlock victim. */
  private transaction(action: LifecycleAction, batchId: string, write: (tx: Tx) => Promise<void>): Promise<void> {
    return withDeadlockRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            await this.options.beforeClaim?.(action)
            await write(tx)
          },
          { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
        ),
      { log: this.options.log, context: { batchId, action } },
    )
  }

  /** The guard wrote nothing: the status the attempt has now chooses the error. */
  private async reject(tx: Tx, batchId: string, action: LifecycleAction): Promise<never> {
    const batch = await tx.settlementBatch.findUnique({ where: { batchId }, select: { status: true } })
    if (batch === null) throw new NotFoundError('Settlement')
    const status = BatchStatus.parse(batch.status)
    const transition = transitionOf(status, action)
    if (!transition.ok) throw transitionErrorOf(transition.error, status)
    // The status admits the action, yet the guard found nothing: only an attempt deleted and restored could get here.
    throw new NotFoundError('Settlement')
  }

  private async audit(
    tx: Tx,
    action: string,
    { batchId, userId, now }: LifecycleCommand,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId,
        action,
        entityType: 'SettlementBatch',
        // Lower case, as the processing audit and the cleanups look it up.
        entityId: batchId.toLowerCase(),
        createdAt: now,
        detailJson: JSON.stringify(detail),
      },
    })
  }
}
