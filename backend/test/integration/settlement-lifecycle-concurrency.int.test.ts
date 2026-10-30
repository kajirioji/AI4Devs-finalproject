import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma } from '../../src/generated/prisma/client.js'
import { buildXlsx } from '../../src/modules/imports/infrastructure/xlsx/test-support.js'
import { PrismaSettlementLifecycleRepository } from '../../src/modules/settlement/infrastructure/prisma-settlement-lifecycle-repository.js'
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
      SELECT TOP 12 t.[sourceTransactionId] FROM [Transaction] t
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

const repository = (beforeClaim?: () => Promise<void>) =>
  new PrismaSettlementLifecycleRepository(ctx.prisma, {
    missing: new PrismaMissingResolution(),
    log: ctx.app.log,
    ...(beforeClaim ? { beforeClaim } : {}),
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
