import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../../src/generated/prisma/client.js'
import { PrismaMissingResolution } from '../../src/modules/validation/infrastructure/prisma-missing-resolution.js'
import { createPrismaClient, fixtureIds } from './helpers.js'
import { removeImportsFrom } from './import-flow.js'

// MissingResolution (settlement-process design D11; spec validation "Los hallazgos persisten", spec settlement
// "Faltantes resueltos al procesar"): inside the transaction that processes or undoes a batch, the persistent missing
// findings of current runs of the provider whose (transactionId, cycle) is in the batch pass to resolved, and back.
// Fixture of its own: imports, runs and findings created straight in the base, batches 9711 and 9712; removed after.
let prisma: PrismaClient
const resolution = new PrismaMissingResolution()
const created = { imports: [] as string[] }
let analystId: number
let accounts: Record<string, string>
let x: bigint // Provider A transaction, the one the batch settles in E
let y: bigint // Provider A transaction not in the batch
let foreign: bigint // Provider B transaction
const AT = new Date('2026-10-19T15:40:03.120Z')

beforeAll(async () => {
  prisma = createPrismaClient()
  analystId = (await prisma.user.findUniqueOrThrow({ where: { userName: 'analyst' } })).userId
  accounts = Object.fromEntries((await prisma.account.findMany()).map((a) => [a.name, a.accountId]))
  const ofProvider = async (providerId: number, take: number) =>
    (
      await prisma.transaction.findMany({
        where: { providerId },
        orderBy: { transactionId: 'desc' },
        take,
        select: { transactionId: true },
      })
    ).map((t) => t.transactionId)
  ;[x, y] = (await ofProvider(101, 2)) as [bigint, bigint]
  ;[foreign] = (await ofProvider(102, 1)) as [bigint]
  // What an interrupted run left behind: batches 9711 to 9716 of these accounts, with their imports.
  const leftovers = await prisma.settlementBatch.findMany({
    where: {
      batchNo: { gte: 9711, lte: 9716 },
      accountId: { in: fixtureIds([accounts['ProviderA-EUR'], accounts['ProviderA-USD']], 'accounts') },
    },
    select: { importId: true },
  })
  await removeImportsFrom(prisma, [...new Set(leftovers.map((b) => b.importId))])
})

// removeImportsFrom first takes the batches away from findings of other imports that they resolved or detected
// (resolveForBatch resolves findings of any import of the provider), then deletes batches, runs and imports.
afterAll(async () => {
  try {
    await removeImportsFrom(prisma, fixtureIds(created.imports, 'created.imports'))
  } finally {
    await prisma.$disconnect()
  }
})

async function importOf(account: string): Promise<string> {
  const importId = randomUUID()
  await prisma.import.create({
    data: { importId, accountId: accounts[account]!, createdByUserId: analystId, status: 'processed' },
  })
  created.imports.push(importId)
  return importId
}

/** A run of the import with one missing_previous_to_batch result and its findings. */
async function runWithFindings(
  importId: string,
  findings: { transactionId: bigint; cycle: 'E' | 'I'; issueType?: string; resolvedByUserId?: number }[],
  isSuperseded = false,
): Promise<number[]> {
  const run = await prisma.validationRun.create({ data: { importId, runByUserId: analystId, isSuperseded } })
  const result = await prisma.validationResult.create({
    data: { runId: run.runId, validationCode: 'missing_previous_to_batch', outcome: 'warning' },
  })
  const ids: number[] = []
  for (const f of findings) {
    const issueType = f.issueType ?? 'missing'
    const issue = await prisma.validationIssue.create({
      data: {
        resultId: result.resultId,
        issueType,
        scope: issueType === 'missing' ? 'previous_to_batch' : null,
        transactionId: f.transactionId,
        cycle: f.cycle,
        missingType: issueType === 'missing' ? 'previous_to_batch' : null,
        resolutionStatus: f.resolvedByUserId ? 'resolved' : 'persistent',
        resolvedByUserId: f.resolvedByUserId ?? null,
        resolvedAt: f.resolvedByUserId ? AT : null,
      },
    })
    ids.push(issue.issueId)
  }
  return ids
}

/** A processed batch of the account settling `transactionId` in `cycle`. */
async function batchWith(account: string, batchNo: number, transactionId: bigint, cycle: 'E' | 'I'): Promise<string> {
  const batchId = randomUUID()
  await prisma.settlementBatch.create({
    data: {
      batchId,
      accountId: accounts[account]!,
      batchNo,
      importId: await importOf(account),
      status: 'processed',
      approvedByUserId: analystId,
    },
  })
  await prisma.settlementTransaction.create({
    data: {
      batchId,
      transactionId,
      cycle,
      statusId: cycle === 'E' ? 2 : 4,
      settlementStatusId: 0,
      amount: '10.0000',
      eventDate: new Date('2026-10-01T00:00:00.000Z'),
      appliedReservePct: '0.100000',
      reserveDaysUsed: 180,
    },
  })
  return batchId
}

const issue = (issueId: number) =>
  prisma.validationIssue.findUniqueOrThrow({
    where: { issueId },
    select: { resolutionStatus: true, resolvedInBatchId: true, resolvedAt: true, resolvedByUserId: true },
  })

describe('resolveForBatch and reopenForBatch', () => {
  let batchB: string
  let batchC: string
  let resolvedByB: number
  let otherCycle: number
  let otherTransaction: number
  let superseded: number
  let otherProvider: number
  let resolvedByC: number
  let byHand: number

  beforeAll(async () => {
    // Findings of an import of ProviderA-USD (current run), of a superseded run, and of Provider B.
    const importA = await importOf('ProviderA-USD')
    ;[superseded] = await runWithFindings(importA, [{ transactionId: x, cycle: 'E' }], true)
    ;[resolvedByB, otherCycle, otherTransaction, byHand] = await runWithFindings(importA, [
      { transactionId: x, cycle: 'E' },
      { transactionId: x, cycle: 'I' },
      { transactionId: y, cycle: 'E' },
      { transactionId: x, cycle: 'E', issueType: 'non_recorded_adjustment', resolvedByUserId: analystId },
    ])
    ;[otherProvider] = await runWithFindings(await importOf('ProviderB-Main'), [{ transactionId: foreign, cycle: 'E' }])
    ;[resolvedByC] = await runWithFindings(await importOf('ProviderA-USD'), [{ transactionId: y, cycle: 'I' }])
    // B settles X in E on another account of the same provider; C settles Y in I.
    batchB = await batchWith('ProviderA-EUR', 9711, x, 'E')
    batchC = await batchWith('ProviderA-USD', 9712, y, 'I')
  })

  it('resolves the persistent missing finding of X in E of a current run, with the batch and the instant', async () => {
    const count = await prisma.$transaction((tx) => resolution.resolveForBatch(tx, batchB, AT))

    expect(count).toBe(1)
    expect(await issue(resolvedByB)).toEqual({
      resolutionStatus: 'resolved',
      resolvedInBatchId: batchB,
      resolvedAt: AT,
      resolvedByUserId: null,
    })
  })

  it('leaves another cycle, another transaction, a superseded run, another provider and other types alone', async () => {
    for (const id of [otherCycle, otherTransaction, superseded, otherProvider])
      expect((await issue(id)).resolutionStatus).toBe('persistent')
    expect(await issue(byHand)).toMatchObject({ resolutionStatus: 'resolved', resolvedInBatchId: null })
  })

  it('rolls back with the transaction that called it', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await resolution.resolveForBatch(tx, batchC, AT)
        throw new Error('processing failed after resolving')
      }),
    ).rejects.toThrow('processing failed after resolving')

    expect((await issue(resolvedByC)).resolutionStatus).toBe('persistent')
  })

  it('reopens only the findings resolved by that batch', async () => {
    await prisma.$transaction((tx) => resolution.resolveForBatch(tx, batchC, AT))

    const reopened = await prisma.$transaction((tx) => resolution.reopenForBatch(tx, batchB))

    expect(reopened).toEqual([resolvedByB])
    expect(await issue(resolvedByB)).toEqual({
      resolutionStatus: 'persistent',
      resolvedInBatchId: null,
      resolvedAt: null,
      resolvedByUserId: null,
    })
    expect(await issue(resolvedByC)).toMatchObject({ resolutionStatus: 'resolved', resolvedInBatchId: batchC })
    expect(await issue(byHand)).toMatchObject({ resolutionStatus: 'resolved' })
  })
})

describe('reopenForBatch and the current runs (settlement-lifecycle design D5)', () => {
  const resolvedBy = (issueId: number, batchId: string) =>
    prisma.validationIssue.update({
      where: { issueId },
      data: { resolutionStatus: 'resolved', resolvedInBatchId: batchId, resolvedAt: AT },
    })

  it('leaves a finding of a superseded run resolved, as evidence of that run', async () => {
    const importA = await importOf('ProviderA-USD')
    const [inSuperseded] = await runWithFindings(importA, [{ transactionId: y, cycle: 'E' }], true)
    const [inCurrent] = await runWithFindings(importA, [{ transactionId: y, cycle: 'E' }])
    const batchId = await batchWith('ProviderA-EUR', 9713, y, 'E')
    await resolvedBy(inSuperseded!, batchId)
    await resolvedBy(inCurrent!, batchId)

    const reopened = await prisma.$transaction((tx) => resolution.reopenForBatch(tx, batchId))

    expect(reopened).toEqual([inCurrent])
    expect(await issue(inSuperseded!)).toMatchObject({ resolutionStatus: 'resolved', resolvedInBatchId: batchId })
  })

  it('keeps the detail and the identity of the reopened finding', async () => {
    const [issueId] = await runWithFindings(await importOf('ProviderA-USD'), [{ transactionId: y, cycle: 'I' }])
    const batchId = await batchWith('ProviderA-EUR', 9714, y, 'I')
    await prisma.validationIssue.update({ where: { issueId: issueId! }, data: { detailJson: '{"days":3}' } })
    await resolvedBy(issueId!, batchId)

    await prisma.$transaction((tx) => resolution.reopenForBatch(tx, batchId))

    expect(
      await prisma.validationIssue.findUniqueOrThrow({
        where: { issueId: issueId! },
        select: { transactionId: true, cycle: true, detailJson: true, resolutionStatus: true },
      }),
    ).toEqual({ transactionId: y, cycle: 'I', detailJson: '{"days":3}', resolutionStatus: 'persistent' })
  })

  // Accepted risk (design, Risks; HU2 CA9): the finding goes back to persistent although another live batch covers it.
  it('reopens a finding that another live batch also covers', async () => {
    const [issueId] = await runWithFindings(await importOf('ProviderA-USD'), [{ transactionId: x, cycle: 'I' }])
    const undone = await batchWith('ProviderA-EUR', 9715, x, 'I')
    await batchWith('ProviderA-USD', 9716, x, 'I')
    await resolvedBy(issueId!, undone)

    await prisma.$transaction((tx) => resolution.reopenForBatch(tx, undone))

    expect((await issue(issueId!)).resolutionStatus).toBe('persistent')
  })
})
