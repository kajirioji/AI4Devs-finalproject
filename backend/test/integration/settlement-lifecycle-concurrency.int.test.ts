import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma } from '../../src/generated/prisma/client.js'
import { buildXlsx } from '../../src/modules/imports/infrastructure/xlsx/test-support.js'
import {
  type LifecyclePhase,
  PrismaSettlementLifecycleRepository,
} from '../../src/modules/settlement/infrastructure/prisma-settlement-lifecycle-repository.js'
import { PrismaSettlementRepository } from '../../src/modules/settlement/infrastructure/prisma-settlement-repository.js'
import { PrismaMissingResolution } from '../../src/modules/validation/infrastructure/prisma-missing-resolution.js'
import { createTestApp } from './helpers.js'
import { type AccountChannelRow, ImportFlow, restoreAccountChannels, snapshotAccountChannels } from './import-flow.js'

// Overlaps of the lifecycle actions (settlement-lifecycle design D2–D4, D11; spec settlement "Concurrencia de las
// acciones del intento"). Deterministic: one action waits inside its transaction right before its first guard
// (beforeClaim, holding no lock) while the other commits; never Promise.all alone.
let ctx: Awaited<ReturnType<typeof createTestApp>>
let flow: ImportFlow
let uploadDir: string
let channels: AccountChannelRow[]
let ids: string[]
let nextId = 0
let nextBatchNo = 9851

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'recon-settlement-lifecycle-concurrency-int-'))
  ctx = await createTestApp({ UPLOAD_DIR: uploadDir })
  flow = new ImportFlow(ctx)
  await flow.init()
  channels = await snapshotAccountChannels(ctx.prisma)
  // Approved transactions of RAM-01 (primary of ProviderA-USD) never settled: one per small import.
  ids = (
    await ctx.prisma.$queryRaw<{ sourceTransactionId: string }[]>(Prisma.sql`
      SELECT TOP 16 t.[sourceTransactionId] FROM [Transaction] t
      WHERE t.[providerId] = 101 AND t.[channelId] = 1001 AND t.[statusId] = 2
        AND NOT EXISTS (SELECT 1 FROM [SettlementTransaction] st WHERE st.[transactionId] = t.[transactionId])
      ORDER BY t.[transactionId] DESC`)
  ).map((r) => r.sourceTransactionId)
})

afterAll(async () => {
  if (ctx) {
    try {
      await flow.close()
    } finally {
      await restoreAccountChannels(ctx.prisma, channels)
    }
    await ctx.app.close()
    await ctx.prisma.$disconnect()
  }
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true })
})

/** A processed one-row attempt of ProviderA-USD. */
async function processedAttempt(): Promise<{ batchId: string; importId: string; batchNo: number }> {
  const id = ids[nextId++]!
  const bytes = buildXlsx({
    sheets: [
      {
        name: 'APP',
        rows: [
          ['ID', 'Amount', 'Currency'],
          [id, { v: '10' }, 'USD'],
        ],
      },
    ],
  })
  const detail = await flow.analyzed(flow.accountIds['ProviderA-USD']!, [{ name: `l-${id}.xlsx`, bytes }])
  const runId = await flow.validateAndReview(detail.importId)
  const batchNo = nextBatchNo++
  const res = await flow.call('POST', `/imports/${detail.importId}/settlements`, { runId, batchNo })
  expect(res.statusCode, res.body).toBe(201)
  return { batchId: res.json().batchId, importId: detail.importId, batchNo }
}

/** A gate: `reached` resolves when the paused side arrives; `open()` lets it go on. */
function gate() {
  let arrive!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    reached,
    open: release,
    beforeClaim: async () => {
      arrive()
      await opened
    },
  }
}

const repository = (beforeClaim?: () => Promise<void>, beforePhase?: (phase: LifecyclePhase) => Promise<void>) =>
  new PrismaSettlementLifecycleRepository(ctx.prisma, {
    missing: new PrismaMissingResolution(),
    log: ctx.app.log,
    ...(beforeClaim ? { beforeClaim } : {}),
    ...(beforePhase ? { beforePhase } : {}),
  })

const command = (batchId: string, user: 'analyst' | 'payments' = 'payments') => ({
  batchId,
  userId: flow.userIds[user],
  now: new Date(),
})

const auditCount = (batchId: string, action: string) =>
  ctx.prisma.auditLog.count({ where: { entityType: 'SettlementBatch', entityId: batchId.toLowerCase(), action } })

const statusOf = async (batchId: string) =>
  (await ctx.prisma.settlementBatch.findUniqueOrThrow({ where: { batchId }, select: { status: true } })).status

describe('two pay of the same attempt', () => {
  it('the one that waited answers settlement_not_processed { paid }, with one audit row', async () => {
    const { batchId } = await processedAttempt()
    const g = gate()
    const waiting = repository(g.beforeClaim).pay(command(batchId))
    await g.reached

    try {
      await repository().pay(command(batchId))
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_not_processed', details: { status: 'paid' } })
    expect(await statusOf(batchId)).toBe('paid')
    expect(await auditCount(batchId, 'settlement.pay')).toBe(1)
  })
})

describe('two unpay of the same attempt', () => {
  it('the one that waited answers settlement_not_paid { processed }, with one audit row', async () => {
    const { batchId } = await processedAttempt()
    await repository().pay(command(batchId))
    const g = gate()
    const waiting = repository(g.beforeClaim).unpay({ ...command(batchId), reason: 'first' })
    await g.reached

    try {
      await repository().unpay({ ...command(batchId), reason: 'second' })
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_not_paid', details: { status: 'processed' } })
    expect(await statusOf(batchId)).toBe('processed')
    expect(await auditCount(batchId, 'settlement.unpay')).toBe(1)
  })
})

const REASON = 'Wrong settlement date'
const undoCommand = (attempt: { batchId: string; importId: string }) => ({
  batchId: attempt.batchId,
  importId: attempt.importId,
  userId: flow.userIds.analyst,
  now: new Date(),
  reason: REASON,
})
const importOf = (importId: string) =>
  ctx.prisma.import.findUniqueOrThrow({ where: { importId }, select: { status: true, currentBatchId: true } })

describe('pay and undo of the same attempt', () => {
  it('undo waited while pay committed: settlement_payment_not_removed, and the import stays processed', async () => {
    const attempt = await processedAttempt()
    const g = gate()
    const waiting = repository(g.beforeClaim).undo(undoCommand(attempt))
    await g.reached

    try {
      await repository().pay(command(attempt.batchId))
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_payment_not_removed', details: { status: 'paid' } })
    expect(await statusOf(attempt.batchId)).toBe('paid')
    expect(await importOf(attempt.importId)).toEqual({ status: 'processed', currentBatchId: attempt.batchId })
    expect(await auditCount(attempt.batchId, 'settlement.undo')).toBe(0)
  })

  it('pay waited while undo committed: settlement_not_processed { undone }', async () => {
    const attempt = await processedAttempt()
    const g = gate()
    const waiting = repository(g.beforeClaim).pay(command(attempt.batchId))
    await g.reached

    try {
      await repository().undo(undoCommand(attempt))
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_not_processed', details: { status: 'undone' } })
    expect(await auditCount(attempt.batchId, 'settlement.pay')).toBe(0)
  })
})

describe('two undo of the same attempt', () => {
  it('the one that waited answers settlement_not_processed { undone }, with one audit row', async () => {
    const attempt = await processedAttempt()
    const g = gate()
    const waiting = repository(g.beforeClaim).undo(undoCommand(attempt))
    await g.reached

    try {
      await repository().undo(undoCommand(attempt))
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_not_processed', details: { status: 'undone' } })
    expect(await auditCount(attempt.batchId, 'settlement.undo')).toBe(1)
  })
})

describe('undo and unpay of the same attempt', () => {
  it('undo waited while unpay committed: the attempt is processed again, so undo goes on', async () => {
    const attempt = await processedAttempt()
    await repository().pay(command(attempt.batchId))
    const g = gate()
    const waiting = repository(g.beforeClaim).undo(undoCommand(attempt))
    await g.reached

    try {
      await repository().unpay({ ...command(attempt.batchId), reason: 'first' })
    } finally {
      g.open()
    }

    await expect(waiting).resolves.toBeUndefined()
    expect(await statusOf(attempt.batchId)).toBe('undone')
  })

  it('unpay waited while undo committed: settlement_not_paid { undone }', async () => {
    const attempt = await processedAttempt()
    const g = gate()
    const waiting = repository(g.beforeClaim).unpay({ ...command(attempt.batchId), reason: 'late' })
    await g.reached

    try {
      await repository().undo(undoCommand(attempt))
    } finally {
      g.open()
    }

    await expect(waiting).rejects.toMatchObject({ code: 'settlement_not_paid', details: { status: 'undone' } })
  })
})

describe('undo while another import takes the number', () => {
  it('the process waits for the undo and creates attempt 2, with no trace of the undo in it', async () => {
    const attempt = await processedAttempt()
    const id = ids[nextId++]!
    const bytes = buildXlsx({
      sheets: [
        {
          name: 'APP',
          rows: [
            ['ID', 'Amount', 'Currency'],
            [id, { v: '10' }, 'USD'],
          ],
        },
      ],
    })
    const detail = await flow.analyzed(flow.accountIds['ProviderA-USD']!, [{ name: `n-${id}.xlsx`, bytes }])
    const runId = await flow.validateAndReview(detail.importId)

    // The undo holds its locks right before its audit, without committing.
    const undoHolds = gate()
    const undoing = repository(undefined, async (phase) => {
      if (phase === 'audit') await undoHolds.beforeClaim()
    }).undo(undoCommand(attempt))
    await undoHolds.reached
    // Where it waits depends on the plan (its reads of the provider's attempts already meet the undo's locks, or else the
    // range lock of the number does): what counts is that it does not finish while the undo is open.
    let finished = false
    const processing = new PrismaSettlementRepository(ctx.prisma, { missing: new PrismaMissingResolution() })
      .process({
        importId: detail.importId,
        userId: flow.userIds.analyst,
        request: { runId, batchNo: attempt.batchNo },
        prefilledFeeTypeIds: new Set(),
        now: new Date(),
      })
      .finally(() => {
        finished = true
      })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const finishedDuringUndo = finished
    undoHolds.open()
    await undoing
    const { batchId } = await processing

    expect(finishedDuringUndo).toBe(false)

    expect(await ctx.prisma.settlementBatch.findUniqueOrThrow({ where: { batchId } })).toMatchObject({
      batchNo: attempt.batchNo,
      attemptNo: 2,
      status: 'processed',
      undoneAt: null,
      undoReason: null,
    })
  })
})

describe('an undo that fails', () => {
  /** A processed attempt whose movement resolved a finding of a current run of another import. */
  async function attemptWithResolvedFinding() {
    const attempt = await processedAttempt()
    const otherImportId = randomUUID()
    await ctx.prisma.import.create({
      data: {
        importId: otherImportId,
        accountId: flow.accountIds['ProviderA-EUR']!,
        createdByUserId: flow.userIds.analyst,
        status: 'analyzed',
      },
    })
    flow.createdImportIds.add(otherImportId)
    const run = await ctx.prisma.validationRun.create({
      data: { importId: otherImportId, runByUserId: flow.userIds.analyst },
    })
    const result = await ctx.prisma.validationResult.create({
      data: { runId: run.runId, validationCode: 'missing_in_range', outcome: 'warning' },
    })
    const movement = await ctx.prisma.settlementTransaction.findFirstOrThrow({
      where: { batchId: attempt.batchId },
      select: { transactionId: true, cycle: true },
    })
    const { issueId } = await ctx.prisma.validationIssue.create({
      data: {
        resultId: result.resultId,
        issueType: 'missing',
        scope: 'in_range',
        missingType: 'in_range',
        ...movement,
        resolutionStatus: 'resolved',
        resolvedInBatchId: attempt.batchId,
        resolvedAt: new Date(),
      },
    })
    return { ...attempt, issueId }
  }

  const stateOf = async (attempt: { batchId: string; importId: string; issueId: number }) => ({
    status: await statusOf(attempt.batchId),
    import: await importOf(attempt.importId),
    runs: await ctx.prisma.validationRun.findMany({
      where: { importId: attempt.importId },
      select: { runId: true, isSuperseded: true },
    }),
    finding: await ctx.prisma.validationIssue.findUniqueOrThrow({
      where: { issueId: attempt.issueId },
      select: { resolutionStatus: true, resolvedInBatchId: true },
    }),
    audit: await auditCount(attempt.batchId, 'settlement.undo'),
  })

  it('after every other write leaves everything as it was', async () => {
    const attempt = await attemptWithResolvedFinding()
    const before = await stateOf(attempt)

    await expect(
      repository(undefined, async (phase) => {
        if (phase === 'audit') throw new Error('failed after reopening the findings and superseding the run')
      }).undo(undoCommand(attempt)),
    ).rejects.toThrow('failed after reopening the findings and superseding the run')

    expect(await stateOf(attempt)).toEqual(before)
    expect(before).toMatchObject({
      status: 'processed',
      runs: [{ isSuperseded: false }],
      finding: { resolutionStatus: 'resolved', resolvedInBatchId: attempt.batchId },
      audit: 0,
    })
  })

  it('answers settlement_busy after three deadlocks, leaving nothing', async () => {
    const attempt = await attemptWithResolvedFinding()
    const before = await stateOf(attempt)
    let tries = 0
    const victim = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
    })

    await expect(
      repository(undefined, async (phase) => {
        if (phase === 'audit') {
          tries += 1
          throw victim
        }
      }).undo(undoCommand(attempt)),
    ).rejects.toMatchObject({ code: 'settlement_busy' })

    expect(tries).toBe(3)
    expect(await stateOf(attempt)).toEqual(before)
  })

  it('of a processed attempt that is not the current one answers settlement_not_current, writing nothing', async () => {
    const attempt = await processedAttempt()
    await ctx.prisma.import.update({ where: { importId: attempt.importId }, data: { currentBatchId: null } })

    await expect(repository().undo(undoCommand(attempt))).rejects.toMatchObject({
      code: 'settlement_not_current',
      details: { importStatus: 'processed', currentBatchId: null },
    })

    expect(await statusOf(attempt.batchId)).toBe('processed')
    expect(await auditCount(attempt.batchId, 'settlement.undo')).toBe(0)
    await ctx.prisma.import.update({ where: { importId: attempt.importId }, data: { currentBatchId: attempt.batchId } })
  })
})
