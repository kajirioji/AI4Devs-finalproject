// Processing a batch in one transaction (settlement-process design D5–D7, D14, D16, D18): guard on Import, current
// run and review, load and calculation after the guard, number under a range lock, bulk writes, channels, missing
// findings, the import and the audit — all or nothing.
import { randomUUID } from 'node:crypto'
import type { ChannelAssigned } from '@recon/shared'
import type { FastifyBaseLogger } from 'fastify'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js'
import type { MissingResolution } from '../../validation/application/ports.js'
import { reviewIsValid } from '../../validation/infrastructure/review-events.js'
import {
  BatchFeeInvalidError,
  BatchNoTakenError,
  BlockingValidationIssueError,
  ChannelAssignmentNotConfirmedError,
  ImportNotValidatedError,
  ValidationRunRequiredError,
  ValidationRunSupersededError,
} from '../application/errors.js'
import { loadSettlementInput } from '../application/load-settlement-input.js'
import type { ProcessCommand, SettlementRepository } from '../application/ports.js'
import { attemptFor } from '../domain/batch-number.js'
import {
  batchChannels,
  channelStateOf,
  channelsToAssignFor,
  type PlannedChannelToAssign,
  shownAccount,
} from '../domain/channels.js'
import { computeSettlement, type SettlementPlan } from '../domain/compute-settlement.js'
import type { AccountAttempt, MovementPlan, OtherAccount, SettlementChannel } from '../domain/types.js'
import { withDeadlockRetry } from './deadlock-retry.js'
import { PrismaSettlementSource } from './prisma-settlement-source.js'
import { statusIdOf } from './status-ids.js'

type Tx = Prisma.TransactionClient

/** 'number' and 'channelLock' come right before the locks of the number and of the channels; the rest, the writes. */
export type WritePhase =
  | 'number'
  | 'channelLock'
  | 'batch'
  | 'movements'
  | 'batchFees'
  | 'totals'
  | 'channels'
  | 'missing'
  | 'import'
  | 'audit'

export interface SettlementRepositoryOptions {
  missing: MissingResolution
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>
  /**
   * Awaited inside the transaction right before the guard on Import, without holding any lock: tests pause a process
   * there so another request commits in between (design D20).
   */
  beforeClaim?: (operation: 'process') => Promise<void>
  /**
   * Awaited right before the locks of the number ('number') and of the channels ('channelLock'), and before each write
   * phase: tests see where a process waits, and inject a failure halfway to see that nothing stays.
   */
  beforePhase?: (phase: WritePhase) => Promise<void>
}

export interface ProcessResult {
  batchId: string
  plan: SettlementPlan
  channelsAssigned: ChannelAssigned[]
  resolvedMissing: number
}

const UNIQUE_VIOLATION = 'P2002'
const ACTIVE_NUMBER_INDEX = 'UX_SettlementBatch_active_accountBatchNo'
const ACTIVE_IMPORT_INDEX = 'UX_SettlementBatch_active_import'
const ATTEMPT_KEY = 'SettlementBatch_accountId_batchNo_attemptNo_key'
const PRIMARY_CHANNEL_INDEX = 'UX_AccountChannel_primary'
/** batch-clean writes in well under a second; the default 5 s leaves no margin for the gates of the tests. */
const PROCESS_TX_TIMEOUT_MS = 60_000
const PROCESS_TX_MAX_WAIT_MS = 10_000
/** Rows per bulk statement of movements. */
const ROWS_PER_STATEMENT = 5_000

const iso = (date: Date | null) => (date === null ? null : date.toISOString())
const businessDate = (day: string | undefined) => (day === undefined ? null : new Date(`${day}T00:00:00.000Z`))

/** A unique violation (P2002) of the index or key, by its name (as validation's isCurrentRunViolation). */
function violates(error: unknown, index: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_VIOLATION) return false
  return `${error.message} ${JSON.stringify(error.meta ?? {})}`.includes(index)
}

function chunks<T>(items: readonly T[], size = ROWS_PER_STATEMENT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export class PrismaSettlementRepository implements SettlementRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: SettlementRepositoryOptions,
  ) {}

  /**
   * The transaction, retried whole when SQL Server chooses it as a deadlock victim (1205, design D7): up to three
   * attempts with a short random pause in between; then 409 settlement_busy. Nothing of a failed attempt stays.
   */
  async process(command: ProcessCommand): Promise<ProcessResult> {
    return withDeadlockRetry(() => this.processOnce(command), {
      log: this.options.log,
      context: { importId: command.importId },
    })
  }

  private async processOnce(command: ProcessCommand): Promise<ProcessResult> {
    const { importId, request } = command
    const batchId = randomUUID()
    // The number this process locked, for the 409 of a violation raised by the writes (set inside the transaction).
    const race: {
      attempted?: { accountId: string; batchNo: number; attemptNo: number }
      toAssign?: PlannedChannelToAssign[]
    } = {}
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const started = performance.now()
          await this.options.beforeClaim?.('process')
          await this.claim(tx, importId, command.now)
          const source = new PrismaSettlementSource(tx)
          const context = await source.importContext(null, importId)
          if (context === null) throw new ImportNotValidatedError('unknown')
          const run = await source.currentRun(importId)
          if (run === null) throw new ValidationRunRequiredError()
          if (run.runId !== request.runId) throw new ValidationRunSupersededError(request.runId, run.runId)
          if (run.blocked)
            throw new BlockingValidationIssueError(run.runId, run.blocked.validationCodes, run.blocked.issueIds)
          if (!(await reviewIsValid(tx, importId, run.runId)))
            throw new ValidationRunSupersededError(request.runId, run.runId)

          const input = await loadSettlementInput(source, {
            importId,
            account: context.account,
            run,
            prefilledFeeTypeIds: command.prefilledFeeTypeIds,
            request,
            options: { transactionalFees: true },
          })
          const loaded = performance.now()
          const plan = computeSettlement(input)
          const computed = performance.now()
          if (plan.batchFeeError) throw new BatchFeeInvalidError(plan.batchFeeError.index, plan.batchFeeError.reason)
          await this.phase('number')
          const attemptNo = await this.lockNumber(tx, context.account.accountId, plan.batchNo)
          race.attempted = { accountId: context.account.accountId, batchNo: plan.batchNo, attemptNo }
          // The channels as they are under lock (design D7, D14): another account may have taken one since the load.
          await this.phase('channelLock')
          const lockedChannels = await this.lockChannels(tx, context.account.accountId, input.channels)
          const batchChannelsNow = batchChannels(plan.movements, lockedChannels)
          race.toAssign = batchChannelsNow.toAssign
          if (batchChannelsNow.toAssign.length > 0 && request.confirmChannelAssignment !== true)
            throw new ChannelAssignmentNotConfirmedError(channelsToAssignFor(command.scope, batchChannelsNow.toAssign))

          await this.phase('batch')
          await this.writeBatch(tx, batchId, context.account.accountId, importId, plan, attemptNo, command)
          await this.phase('movements')
          await this.writeMovements(tx, batchId, plan.movements)
          await this.phase('batchFees')
          for (const fee of plan.batchFees)
            await tx.settlementBatchFee.create({
              data: {
                batchId,
                feeTypeId: fee.feeTypeId,
                feeId: fee.feeId,
                amount: fee.amount,
                description: fee.description,
                source: fee.source,
                enteredByUserId: command.userId,
                createdAt: command.now,
              },
            })
          await this.phase('totals')
          await tx.settlementBatchTotal.createMany({ data: plan.summary.totals.map((t) => ({ batchId, ...t })) })
          if (plan.summary.brandTotals.length > 0)
            await tx.settlementBatchBrandTotal.createMany({
              data: plan.summary.brandTotals.map((b) => ({ batchId, ...b })),
            })
          await this.phase('channels')
          const channelsAssigned = await this.assignChannels(
            tx,
            batchId,
            context.account.accountId,
            batchChannelsNow.toAssign,
            command,
          )
          await this.phase('missing')
          const resolvedMissing = await this.options.missing.resolveForBatch(tx, batchId, command.now)
          await tx.$executeRaw`
            UPDATE [ValidationIssue] SET [detectedInBatchId] = ${batchId}
            WHERE [resultId] IN (SELECT [resultId] FROM [ValidationResult] WHERE [runId] = ${run.runId})`
          await this.phase('import')
          await tx.import.update({ where: { importId }, data: { currentBatchId: batchId, updatedAt: command.now } })
          await this.phase('audit')
          await tx.auditLog.create({
            data: {
              userId: command.userId,
              action: 'settlement.process',
              entityType: 'SettlementBatch',
              entityId: batchId,
              createdAt: command.now,
              detailJson: JSON.stringify({
                importId,
                runId: run.runId,
                batchNo: plan.batchNo,
                attemptNo,
                movements: countByCycle(plan.movements),
                skipped: plan.skipped,
                warnings: plan.warnings,
                batchFees: plan.batchFees.length,
                resolvedMissing,
                channelsAssigned,
                note: request.note ?? null,
              }),
            },
          })
          this.options.log?.info(
            {
              importId,
              batchId,
              movements: plan.movements.length,
              loadMs: Math.round(loaded - started),
              computeMs: Math.round(computed - loaded),
              writeMs: Math.round(performance.now() - computed),
            },
            'settlement processed',
          )
          return {
            batchId,
            plan: { ...plan, attemptNo, channels: batchChannelsNow },
            channelsAssigned: channelsAssigned.map((c) => ({
              ...c,
              previousAccount: c.previousAccount === null ? null : shownAccount(command.scope, c.previousAccount),
            })),
            resolvedMissing,
          }
        },
        { timeout: PROCESS_TX_TIMEOUT_MS, maxWait: PROCESS_TX_MAX_WAIT_MS },
      )
    } catch (error) {
      // The unique indexes are the last barrier (design D7): an attempt of the same account and number that won a race
      // in between. Its holder is read outside the rolled-back transaction; the attempted number when none is seen.
      const { attempted } = race
      if (attempted && (violates(error, ACTIVE_NUMBER_INDEX) || violates(error, ATTEMPT_KEY))) {
        const holder = await this.prisma.settlementBatch.findFirst({
          where: {
            accountId: attempted.accountId,
            batchNo: attempted.batchNo,
            importId: { not: importId },
            status: { not: 'undone' },
          },
          orderBy: { createdAt: 'desc' },
        })
        throw new BatchNoTakenError(
          attempted.batchNo,
          holder?.attemptNo ?? attempted.attemptNo,
          holder?.importId ?? importId,
        )
      }
      if (violates(error, ACTIVE_IMPORT_INDEX)) throw new ImportNotValidatedError('processed')
      // One primary per channel: another account became primary in between, so the confirmation is stale.
      if (violates(error, PRIMARY_CHANNEL_INDEX))
        throw new ChannelAssignmentNotConfirmedError(channelsToAssignFor(command.scope, race.toAssign ?? []))
      throw error
    }
  }

  private async phase(phase: WritePhase): Promise<void> {
    await this.options.beforePhase?.(phase)
  }

  /** The guard (design D5): validated → processed, holding the row of Import until the commit. */
  private async claim(tx: Tx, importId: string, now: Date): Promise<void> {
    const claimed = await tx.$queryRaw<{ importId: string }[]>`
      UPDATE [Import] SET [status] = 'processed', [updatedAt] = CAST(${now.toISOString()} AS datetime2(7))
      OUTPUT inserted.[importId]
      WHERE [importId] = ${importId} AND [status] = 'validated'`
    if (claimed.length === 1) return
    const current = await tx.import.findUnique({ where: { importId }, select: { status: true } })
    throw new ImportNotValidatedError(current?.status ?? 'unknown')
  }

  /**
   * The attempts of the number under UPDLOCK + HOLDLOCK (design D7): a range lock on (accountId, batchNo, attemptNo),
   * so another process of the same account and number waits for this commit and then sees its attempt.
   */
  private async lockNumber(tx: Tx, accountId: string, batchNo: number): Promise<number> {
    const rows = await tx.$queryRaw<{ batchNo: number; attemptNo: number; status: string; importId: string }[]>`
      SELECT [batchNo], [attemptNo], [status], LOWER(CONVERT(VARCHAR(36), [importId])) AS importId
      FROM [SettlementBatch] WITH (UPDLOCK, HOLDLOCK)
      WHERE [accountId] = ${accountId} AND [batchNo] = ${batchNo}`
    const { attemptNo, holder } = attemptFor(rows as AccountAttempt[], batchNo)
    if (holder) throw new BatchNoTakenError(batchNo, holder.attemptNo, holder.importId)
    return attemptNo
  }

  private async writeBatch(
    tx: Tx,
    batchId: string,
    accountId: string,
    importId: string,
    plan: SettlementPlan,
    attemptNo: number,
    command: ProcessCommand,
  ): Promise<void> {
    const { summary, dateRanges } = plan
    await tx.settlementBatch.create({
      data: {
        batchId,
        accountId,
        batchNo: plan.batchNo,
        attemptNo,
        importId,
        status: 'processed',
        approvedByUserId: command.userId,
        processedAt: command.now,
        settlementDate: businessDate(command.request.settlementDate),
        dateMinApp: dateRanges.APP?.min ?? null,
        dateMaxApp: dateRanges.APP?.max ?? null,
        dateMinDec: dateRanges.DEC?.min ?? null,
        dateMaxDec: dateRanges.DEC?.max ?? null,
        dateMinI: dateRanges.I?.min ?? null,
        dateMaxI: dateRanges.I?.max ?? null,
        dateMinR: dateRanges.R?.min ?? null,
        dateMaxR: dateRanges.R?.max ?? null,
        mdrAmt: summary.mdrAmt,
        mdrRate: summary.mdrRate,
        otherFeeAmt: summary.otherFeeAmt,
        reserveHeldAmt: summary.reserveHeldAmt,
        reserveReleasedAmt: summary.reserveReleasedAmt,
        amountPayable: summary.amountPayable,
        channels: plan.channels.label,
        createdAt: command.now,
      },
    })
  }

  /**
   * MERGE … OUTPUT correlates each settlementTxnId with the ordinal of its movement (design D16), so the fee detail
   * finds its movement without relying on the order IDENTITY assigns. Money travels as text, typed in the WITH clause.
   */
  private async writeMovements(tx: Tx, batchId: string, movements: readonly MovementPlan[]): Promise<void> {
    const sources = movements.map((m, o) => ({
      o,
      t: String(m.transactionId),
      c: m.cycle,
      s: statusIdOf(m.statusCode),
      r: m.roundNo,
      sh: m.sheetId,
      rn: m.rowNo,
      a: m.amount,
      x: m.excludeAmount ? 1 : 0,
      f: m.feeAmount,
      e: iso(m.eventDate),
      p: m.appliedReservePct,
      d: m.reserveDaysUsed,
      er: iso(m.expectedReserveReleaseAt),
      ps: m.reservePolicySnapshot,
      ee: m.reserveEarlyReleasedAmt,
      h: m.reserveHeldAmt,
      rl: m.reserveReleasedAmt,
    }))
    const idOf = new Map<number, bigint>()
    for (const chunk of chunks(sources)) {
      const inserted = await tx.$queryRaw<{ ordinal: number; settlementTxnId: bigint }[]>`
        MERGE INTO [SettlementTransaction] AS t
        USING (
          SELECT * FROM OPENJSON(${JSON.stringify(chunk)}) WITH ([o] INT, [t] BIGINT, [c] CHAR(1), [s] INT, [r] INT,
            [sh] UNIQUEIDENTIFIER, [rn] INT, [a] DECIMAL(19,4), [x] BIT, [f] DECIMAL(19,4), [e] DATETIME2(7),
            [p] DECIMAL(9,6), [d] INT, [er] DATETIME2(7), [ps] NVARCHAR(MAX), [ee] DECIMAL(19,4), [h] DECIMAL(19,4),
            [rl] DECIMAL(19,4))
        ) AS j
        ON 1 = 0
        WHEN NOT MATCHED THEN
          INSERT ([batchId], [transactionId], [cycle], [statusId], [settlementStatusId], [roundNo], [sheetId], [rowNo],
            [amount], [excludeAmount], [feeAmount], [eventDate], [appliedReservePct], [reserveDaysUsed],
            [expectedReserveReleaseAt], [reservePolicySnapshot], [reserveEarlyReleasedAmt], [reserveHeldAmt],
            [reserveReleasedAmt])
          VALUES (${batchId}, j.[t], j.[c], j.[s], 0, j.[r], j.[sh], j.[rn], j.[a], j.[x], j.[f], j.[e], j.[p], j.[d],
            j.[er], j.[ps], j.[ee], j.[h], j.[rl])
        OUTPUT j.[o] AS ordinal, inserted.[settlementTxnId] AS settlementTxnId;`
      for (const row of inserted) idOf.set(Number(row.ordinal), BigInt(String(row.settlementTxnId)))
    }
    const fees = movements.flatMap((m, o) =>
      m.fees.map((f) => ({
        i: String(idOf.get(o)),
        fe: f.feeId,
        ft: f.feeTypeId,
        e: iso(m.eventDate),
        a: f.amount,
        j: f.configurationSnapshot,
      })),
    )
    for (const chunk of chunks(fees))
      await tx.$executeRaw`
        INSERT INTO [SettlementTransactionFee] ([settlementTxnId], [feeId], [feeTypeId], [eventDate], [amountUsd],
          [configurationSnapshot])
        SELECT j.[i], j.[fe], j.[ft], j.[e], j.[a], j.[j]
        FROM OPENJSON(${JSON.stringify(chunk)}) WITH ([i] BIGINT, [fe] UNIQUEIDENTIFIER, [ft] INT, [e] DATETIME2(7),
          [a] DECIMAL(19,4), [j] NVARCHAR(MAX)) j`
  }

  /**
   * The AccountChannel rows of the batch's channels under UPDLOCK + HOLDLOCK, in channelId order (design D7): another
   * process that would assign one of them waits for this commit, and the state decided here is the one written.
   */
  private async lockChannels(
    tx: Tx,
    accountId: string,
    channels: readonly SettlementChannel[],
  ): Promise<Map<number, SettlementChannel>> {
    const ids = channels.map((c) => c.channelId).sort((a, b) => a - b)
    if (ids.length === 0) return new Map()
    const rows = await tx.$queryRaw<
      { channelId: number; accountId: string; isPrimary: boolean; name: string; merchantId: number }[]
    >`
      SELECT ac.[channelId], LOWER(CONVERT(VARCHAR(36), ac.[accountId])) AS accountId, ac.[isPrimary], a.[name],
        p.[merchantId]
      FROM [AccountChannel] ac WITH (UPDLOCK, HOLDLOCK)
      JOIN [Account] a ON a.[accountId] = ac.[accountId]
      JOIN [Provider] p ON p.[providerId] = a.[providerId]
      WHERE ac.[channelId] IN (${Prisma.join(ids)})
      ORDER BY ac.[channelId]`
    return new Map(
      channels.map((c) => [
        c.channelId,
        channelStateOf(
          accountId,
          c,
          rows
            .filter((r) => r.channelId === c.channelId)
            .filter((r) => r.isPrimary || r.accountId === accountId.toLowerCase())
            .map((r) => ({
              accountId: r.accountId,
              isPrimary: Boolean(r.isPrimary),
              accountName: r.name,
              merchantId: Number(r.merchantId),
            })),
        ),
      ]),
    )
  }

  /**
   * Every channel of the batch not primary for the account becomes so (design D14), in channelId order so two
   * batches never wait on each other in opposite orders. An existing row of the account keeps its creation fields.
   */
  private async assignChannels(
    tx: Tx,
    batchId: string,
    accountId: string,
    toAssign: readonly PlannedChannelToAssign[],
    command: ProcessCommand,
  ): Promise<AssignedChannel[]> {
    const assigned: AssignedChannel[] = []
    for (const channel of toAssign) {
      await tx.accountChannel.updateMany({
        where: { channelId: channel.channelId, isPrimary: true, NOT: { accountId } },
        data: { isPrimary: false },
      })
      const own = await tx.accountChannel.findUnique({
        where: { accountId_channelId: { accountId, channelId: channel.channelId } },
        select: { accountId: true },
      })
      if (own)
        await tx.accountChannel.update({
          where: { accountId_channelId: { accountId, channelId: channel.channelId } },
          data: { isPrimary: true },
        })
      else
        await tx.accountChannel.create({
          data: {
            accountId,
            channelId: channel.channelId,
            isPrimary: true,
            assignedAt: command.now,
            assignedInBatchId: batchId,
            assignedByUserId: command.userId,
          },
        })
      const entry: AssignedChannel = {
        channelId: channel.channelId,
        name: channel.name,
        assignment: channel.otherAccount === null ? 'new_primary' : 'primary_moved_from',
        previousAccount: channel.otherAccount,
      }
      assigned.push(entry)
      await tx.auditLog.create({
        data: {
          userId: command.userId,
          action: 'account_channel.assign',
          entityType: 'AccountChannel',
          entityId: `${accountId}:${channel.channelId}`,
          createdAt: command.now,
          detailJson: JSON.stringify({
            batchId,
            assignment: entry.assignment,
            previousAccountId: channel.otherAccount?.accountId ?? null,
          }),
        },
      })
    }
    return assigned
  }
}

function countByCycle(movements: readonly MovementPlan[]) {
  const count = (cycle: string) => movements.filter((m) => m.cycle === cycle).length
  return { E: count('E'), I: count('I'), R: count('R') }
}

/** A channel assigned by the batch as the audit keeps it: the previous account with its merchant (for the scope). */
type AssignedChannel = Omit<ChannelAssigned, 'previousAccount'> & { previousAccount: OtherAccount | null }
