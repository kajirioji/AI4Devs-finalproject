import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AccountSettlementsPage,
  type SettlementRequest,
  SettlementTransactionsPage,
  SettlementView,
} from '@recon/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, fixtureId } from './helpers.js'
import {
  type AccountChannelRow,
  expectedOf,
  ImportFlow,
  restoreAccountChannels,
  snapshotAccountChannels,
} from './import-flow.js'

// The lifecycle of an attempt against SQL Server (settlement-lifecycle design D3, D11; spec settlement "Marcar como
// pagado", "Retirar la marca de pago"). batch-clean is processed through the API and removed with its import.
let ctx: Awaited<ReturnType<typeof createTestApp>>
let flow: ImportFlow
let uploadDir: string
let channels: AccountChannelRow[]
const BATCH_CLEAN_FEES: SettlementRequest['batchFees'] = [
  { feeTypeId: 121, feeId: null, amount: '25.0000', description: 'Wire Fee', source: 'file' },
  { feeTypeId: 117, feeId: null, amount: '15.0000', description: 'Settlement Fee', source: 'file' },
]
const REASON = 'Payment was rejected by the bank'

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'recon-settlement-lifecycle-int-'))
  ctx = await createTestApp({ UPLOAD_DIR: uploadDir })
  flow = new ImportFlow(ctx)
  await flow.init()
  channels = await snapshotAccountChannels(ctx.prisma)
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

const auditOf = (batchId: string) =>
  ctx.prisma.auditLog.findMany({
    where: { entityType: 'SettlementBatch', entityId: batchId.toLowerCase(), action: { startsWith: 'settlement.' } },
    orderBy: { auditId: 'asc' },
    select: { action: true, userId: true, createdAt: true, detailJson: true },
  })

const movementsOf = (batchId: string) =>
  ctx.prisma.settlementTransaction.findMany({
    where: { batchId },
    orderBy: { settlementTxnId: 'asc' },
    select: { settlementTxnId: true, cycle: true, amount: true, feeAmount: true, settlementStatusId: true },
  })

const pay = (batchId: string) => flow.call('POST', `/settlements/${batchId}/pay`, undefined, 'payments')
const unpay = (batchId: string, reason?: string) =>
  flow.call('POST', `/settlements/${batchId}/unpay`, reason === undefined ? {} : { reason }, 'payments')

/** The three exports as downloaded; their audit rows are removed so that they do not count as actions of the attempt. */
async function exportsOf(batchId: string) {
  const bodies: Record<string, string> = {}
  for (const type of ['summary', 'transactions', 'reserves']) {
    const res = await flow.call('GET', `/settlements/${batchId}/export?type=${type}`)
    expect(res.statusCode, res.body).toBe(200)
    bodies[type] = res.body
  }
  await ctx.prisma.auditLog.deleteMany({ where: { entityId: batchId.toLowerCase(), action: 'settlement.export' } })
  return bodies
}

/** The summary export says the current state of the attempt in these two lines; everything else was fixed at processing. */
const withoutState = (summary: string) =>
  summary
    .split(/\r?\n/)
    .filter((line) => !/^(Status|Payment),/.test(line))
    .join('\n')

/** What must not change when an attempt is paid or unpaid: everything but its status and its payment fields. */
function figures(view: SettlementView) {
  const { status: _s, settledStatus: _d, paidAt: _a, paidBy: _b, ...rest } = view
  return rest
}

describe('paying and unpaying batch-clean', () => {
  let importId: string
  let batchId: string
  let processed: SettlementView

  beforeAll(async () => {
    const validated = await flow.validatedSample('batch-clean')
    importId = validated.importId
    const res = await flow.call('POST', `/imports/${importId}/settlements`, {
      runId: validated.runId,
      confirmChannelAssignment: true,
      batchFees: BATCH_CLEAN_FEES,
    })
    expect(res.statusCode, res.body).toBe(201)
    processed = SettlementView.parse(res.json())
    batchId = processed.batchId
  })

  // Its transactions stay free for the next describe, which processes batch-clean again.
  afterAll(() => flow.removeImports([importId]))

  it('pays: paid, settled, audited, and the movements read as Settled (HU3 CA7)', async () => {
    const movementsBefore = await movementsOf(batchId)
    const exportsBefore = await exportsOf(batchId)

    const res = await pay(batchId)

    expect(res.statusCode, res.body).toBe(200)
    const view = SettlementView.parse(res.json())
    expect(view).toMatchObject({
      status: 'paid',
      settledStatus: 'settled',
      paidBy: { userName: 'payments' },
    })
    expect(view.paidAt).not.toBeNull()
    expect(figures(view)).toEqual(figures(processed))
    expect(await movementsOf(batchId)).toEqual(movementsBefore)
    const exportsAfter = await exportsOf(batchId)
    expect(exportsAfter.transactions).toBe(exportsBefore.transactions)
    expect(exportsAfter.reserves).toBe(exportsBefore.reserves)
    expect(exportsAfter.summary).toContain('Status,paid')
    expect(withoutState(exportsAfter.summary!)).toBe(withoutState(exportsBefore.summary!))

    const [, audit] = await auditOf(batchId)
    expect(audit).toMatchObject({ action: 'settlement.pay', userId: flow.userIds.payments })
    expect(JSON.parse(audit!.detailJson!)).toEqual({
      importId,
      batchNo: processed.batchNo,
      attemptNo: processed.attemptNo,
      reason: null,
    })

    for (const type of ['E', 'I', 'R']) {
      const page = SettlementTransactionsPage.parse(
        (await flow.call('GET', `/settlements/${batchId}/transactions?type=${type}`)).json(),
      )
      expect(page.items.length).toBeGreaterThan(0)
      expect(page.items.every((m) => m.settled)).toBe(true)
    }
    const list = AccountSettlementsPage.parse(
      (await flow.call('GET', `/accounts/${processed.accountId}/settlements?status=paid&pageSize=100`)).json(),
    )
    expect(list.items.find((a) => a.batchId === batchId)).toMatchObject({ status: 'paid', settledStatus: 'settled' })
  })

  it('leaves the import as it was', async () => {
    const stored = await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })
    expect(stored).toMatchObject({ status: 'processed', currentBatchId: batchId })
  })

  it('answers 409 settlement_not_processed to a second pay, with one audit row', async () => {
    const res = await pay(batchId)

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'settlement_not_processed', details: { status: 'paid' } })
    expect((await auditOf(batchId)).filter((a) => a.action === 'settlement.pay')).toHaveLength(1)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(501)],
  ])('rejects a %s reason: still paid, nothing audited', async (_name, reason) => {
    const res = await unpay(batchId, reason)

    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().code).toBe('validation_error')
    expect((await ctx.prisma.settlementBatch.findUniqueOrThrow({ where: { batchId } })).status).toBe('paid')
    expect((await auditOf(batchId)).some((a) => a.action === 'settlement.unpay')).toBe(false)
  })

  it('unpays: processed, payment fields empty, and the audit keeps the reason and the previous payment', async () => {
    const before = await ctx.prisma.settlementBatch.findUniqueOrThrow({ where: { batchId } })

    const res = await unpay(batchId, `  ${REASON} `)

    expect(res.statusCode, res.body).toBe(200)
    const view = SettlementView.parse(res.json())
    expect(view).toMatchObject({ status: 'processed', settledStatus: 'pending_payment', paidAt: null, paidBy: null })
    expect(figures(view)).toEqual(figures(processed))
    const page = SettlementTransactionsPage.parse(
      (await flow.call('GET', `/settlements/${batchId}/transactions?type=E`)).json(),
    )
    expect(page.items.every((m) => !m.settled)).toBe(true)

    const audit = (await auditOf(batchId)).find((a) => a.action === 'settlement.unpay')
    expect(audit?.userId).toBe(flow.userIds.payments)
    expect(JSON.parse(audit!.detailJson!)).toEqual({
      importId,
      batchNo: processed.batchNo,
      attemptNo: processed.attemptNo,
      reason: REASON,
      previousPaidAt: before.paidAt?.toISOString(),
      previousPaidByUserId: flow.userIds.payments,
    })
  })

  it('answers 409 settlement_not_paid to a second unpay', async () => {
    const res = await unpay(batchId, REASON)

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'settlement_not_paid', details: { status: 'processed' } })
  })

  it('pays again with the new user and instant, and the audit keeps the three rows in order', async () => {
    const first = (await auditOf(batchId)).find((a) => a.action === 'settlement.pay')

    const res = await pay(batchId)

    expect(res.statusCode, res.body).toBe(200)
    const actions = (await auditOf(batchId)).map((a) => a.action)
    expect(actions).toEqual(['settlement.process', 'settlement.pay', 'settlement.unpay', 'settlement.pay'])
    expect(Date.parse(SettlementView.parse(res.json()).paidAt!)).toBeGreaterThanOrEqual(first!.createdAt.getTime())
    expect((await unpay(batchId, REASON)).statusCode).toBe(200)
  })

  it('unpaying does not reopen a finding the paid attempt resolved', async () => {
    const otherImportId = randomUUID()
    await ctx.prisma.import.create({
      data: {
        importId: otherImportId,
        accountId: fixtureId(flow.accountIds['ProviderA-EUR'], 'ProviderA-EUR'),
        createdByUserId: flow.userIds.analyst,
        status: 'analyzed',
      },
    })
    try {
      const run = await ctx.prisma.validationRun.create({
        data: { importId: otherImportId, runByUserId: flow.userIds.analyst },
      })
      const result = await ctx.prisma.validationResult.create({
        data: { runId: run.runId, validationCode: 'missing_previous_to_batch', outcome: 'warning' },
      })
      const [movement] = await movementsOf(batchId)
      const transaction = await ctx.prisma.settlementTransaction.findUniqueOrThrow({
        where: { settlementTxnId: movement!.settlementTxnId },
        select: { transactionId: true, cycle: true },
      })
      const { issueId } = await ctx.prisma.validationIssue.create({
        data: {
          resultId: result.resultId,
          issueType: 'missing',
          scope: 'previous_to_batch',
          missingType: 'previous_to_batch',
          transactionId: transaction.transactionId,
          cycle: transaction.cycle,
          resolutionStatus: 'resolved',
          resolvedInBatchId: batchId,
          resolvedAt: new Date(),
        },
      })
      expect((await pay(batchId)).statusCode).toBe(200)

      expect((await unpay(batchId, REASON)).statusCode).toBe(200)

      expect(await ctx.prisma.validationIssue.findUniqueOrThrow({ where: { issueId } })).toMatchObject({
        resolutionStatus: 'resolved',
        resolvedInBatchId: batchId,
      })
    } finally {
      await flow.removeImports([otherImportId])
    }
  })

  it('answers 403 to viewer and analyst', async () => {
    for (const user of ['viewer', 'analyst'] as const) {
      const res = await flow.call('POST', `/settlements/${batchId}/pay`, undefined, user)
      expect(res.statusCode, res.body).toBe(403)
      expect(res.json().code).toBe('forbidden')
    }
  })
})

describe('a seeded paid batch, without a settlement.process audit', () => {
  it('can be unpaid, and its validation summary stays null', async () => {
    const seeded = await ctx.prisma.settlementBatch.findFirst({
      where: { status: 'paid', account: { name: 'ProviderA-USD' } },
      orderBy: { batchNo: 'desc' },
    })
    const batchId = fixtureId(seeded?.batchId, 'a seeded paid batch')
    try {
      const res = await unpay(batchId, REASON)

      expect(res.statusCode, res.body).toBe(200)
      expect(SettlementView.parse(res.json())).toMatchObject({ status: 'processed', validationSummary: null })
    } finally {
      await ctx.prisma.settlementBatch.update({
        where: { batchId },
        data: {
          status: 'paid',
          paidAt: seeded!.paidAt,
          paidByUserId: seeded!.paidByUserId,
          updatedAt: seeded!.updatedAt,
        },
      })
      await ctx.prisma.auditLog.deleteMany({
        where: { entityType: 'SettlementBatch', entityId: batchId.toLowerCase(), action: 'settlement.unpay' },
      })
    }
  })
})

const undo = (batchId: string, reason: string | undefined = 'Wrong settlement date') =>
  flow.call('POST', `/settlements/${batchId}/undo`, reason === undefined ? {} : { reason })

const processSample = async (importId: string, runId: number, batchNo?: number) => {
  const res = await flow.call('POST', `/imports/${importId}/settlements`, {
    runId,
    ...(batchNo === undefined ? {} : { batchNo }),
    confirmChannelAssignment: true,
    batchFees: BATCH_CLEAN_FEES,
  })
  expect(res.statusCode, res.body).toBe(201)
  return SettlementView.parse(res.json())
}

describe('undoing and reprocessing batch-clean', () => {
  const RAM_07 = 1007
  let importId: string
  let reviewedRunId: number
  let first: SettlementView
  let undone: SettlementView
  let movementsBefore: Awaited<ReturnType<typeof movementsOf>>
  let otherImportId: string
  let reopenedIssue: number
  let supersededIssue: number
  let byHandIssue: number

  beforeAll(async () => {
    const validated = await flow.validatedSample('batch-clean')
    importId = validated.importId
    reviewedRunId = validated.runId
    first = await processSample(importId, reviewedRunId)
    movementsBefore = await movementsOf(first.batchId)

    // Findings of another import of the provider: resolved by the attempt in a current and in a superseded run, and by
    // hand. The ids of the attempt's movements make them real; built straight in the base, removed with the import.
    otherImportId = randomUUID()
    await ctx.prisma.import.create({
      data: {
        importId: otherImportId,
        accountId: fixtureId(flow.accountIds['ProviderA-EUR'], 'ProviderA-EUR'),
        createdByUserId: flow.userIds.analyst,
        status: 'analyzed',
      },
    })
    flow.createdImportIds.add(otherImportId)
    const [movement] = movementsBefore
    const finding = async (isSuperseded: boolean, resolvedByUserId: number | null) => {
      const run = await ctx.prisma.validationRun.create({
        data: { importId: otherImportId, runByUserId: flow.userIds.analyst, isSuperseded },
      })
      const result = await ctx.prisma.validationResult.create({
        data: { runId: run.runId, validationCode: 'missing_previous_to_batch', outcome: 'warning' },
      })
      const transaction = await ctx.prisma.settlementTransaction.findUniqueOrThrow({
        where: { settlementTxnId: movement!.settlementTxnId },
        select: { transactionId: true, cycle: true },
      })
      const issue = await ctx.prisma.validationIssue.create({
        data: {
          resultId: result.resultId,
          issueType: 'missing',
          scope: 'previous_to_batch',
          missingType: 'previous_to_batch',
          transactionId: transaction.transactionId,
          cycle: transaction.cycle,
          detailJson: '{"days":3}',
          resolutionStatus: 'resolved',
          resolvedInBatchId: resolvedByUserId === null ? first.batchId : null,
          resolvedByUserId,
          resolvedAt: new Date(),
        },
      })
      return issue.issueId
    }
    supersededIssue = await finding(true, null)
    byHandIssue = await finding(true, flow.userIds.analyst)
    reopenedIssue = await finding(false, null)

    const res = await undo(first.batchId)
    expect(res.statusCode, res.body).toBe(200)
    undone = SettlementView.parse(res.json())
  })

  it('marks the attempt undone with who, when and why, keeping every movement and figure (HU3 CA8)', async () => {
    expect(undone).toMatchObject({
      status: 'undone',
      settledStatus: 'undone',
      undoneBy: { userName: 'analyst' },
      undoReason: 'Wrong settlement date',
      movements: first.movements,
      amountPayable: first.amountPayable,
      totals: first.totals,
      batchFees: first.batchFees,
    })
    expect(undone.undoneAt).not.toBeNull()
    expect(await movementsOf(first.batchId)).toEqual(movementsBefore)
    expect(first.movements).toEqual(expectedOf('batch-clean').byCycle)
  })

  it('reads back the same, with the validation summary of its superseded run, for viewer too', async () => {
    const res = await flow.call('GET', `/settlements/${first.batchId}`, undefined, 'viewer')
    expect(res.statusCode, res.body).toBe(200)
    const view = SettlementView.parse(res.json())
    expect(view).toMatchObject({
      status: 'undone',
      undoneBy: { userName: 'analyst' },
      undoReason: 'Wrong settlement date',
    })
    expect(view.validationSummary).toEqual(first.validationSummary)
  })

  it('serves the three exports, and reads its movements as not Settled', async () => {
    for (const type of ['summary', 'transactions', 'reserves']) {
      const res = await flow.call('GET', `/settlements/${first.batchId}/export?type=${type}`)
      expect(res.statusCode, res.body).toBe(200)
      expect(res.headers['content-disposition']).toContain(`${first.batchNo}`)
    }
    const page = SettlementTransactionsPage.parse(
      (await flow.call('GET', `/settlements/${first.batchId}/transactions?type=E`)).json(),
    )
    expect(page.items.every((m) => !m.settled)).toBe(true)
    await ctx.prisma.auditLog.deleteMany({
      where: { entityId: first.batchId.toLowerCase(), action: 'settlement.export' },
    })
  })

  it('takes the import back to analyzed without a current batch', async () => {
    expect(await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })).toMatchObject({
      status: 'analyzed',
      currentBatchId: null,
    })
  })

  it('does not revert the primary account of the channel', async () => {
    const accountId = fixtureId(flow.accountIds['ProviderA-USD'], 'ProviderA-USD')
    expect(
      await ctx.prisma.accountChannel.findUnique({ where: { accountId_channelId: { accountId, channelId: RAM_07 } } }),
    ).toMatchObject({ isPrimary: true, assignedInBatchId: first.batchId })
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'account_channel.assign', entityId: `${accountId}:${RAM_07}` },
      }),
    ).toBe(1)
  })

  it('reopens only the finding of a current run, keeping its evidence', async () => {
    const issue = (issueId: number) =>
      ctx.prisma.validationIssue.findUniqueOrThrow({
        where: { issueId },
        select: { resolutionStatus: true, resolvedInBatchId: true, resolvedAt: true, detailJson: true },
      })
    expect(await issue(reopenedIssue)).toEqual({
      resolutionStatus: 'persistent',
      resolvedInBatchId: null,
      resolvedAt: null,
      detailJson: '{"days":3}',
    })
    expect(await issue(supersededIssue)).toMatchObject({
      resolutionStatus: 'resolved',
      resolvedInBatchId: first.batchId,
    })
    expect(await issue(byHandIssue)).toMatchObject({ resolutionStatus: 'resolved', resolvedInBatchId: null })
  })

  it('audits who, when and why with the import, the number, the findings and the superseded run', async () => {
    const audit = (await auditOf(first.batchId)).find((a) => a.action === 'settlement.undo')
    expect(audit?.userId).toBe(flow.userIds.analyst)
    expect(JSON.parse(audit!.detailJson!)).toEqual({
      importId,
      batchNo: first.batchNo,
      attemptNo: 1,
      reason: 'Wrong settlement date',
      reopenedMissingIssueIds: [reopenedIssue],
      supersededRunId: reviewedRunId,
    })
  })

  it('supersedes the run without another one, so review answers validation_run_required', async () => {
    const run = await ctx.prisma.validationRun.findUniqueOrThrow({ where: { runId: reviewedRunId } })
    expect(run.isSuperseded).toBe(true)

    const validations = await flow.call('GET', `/imports/${importId}/validations`)
    expect(validations.statusCode, validations.body).toBe(200)
    expect(validations.json()).toMatchObject({
      importStatus: 'analyzed',
      run: null,
      lastInvalidatedReview: { runId: reviewedRunId, reason: 'settlement_undone', newRunId: null },
    })

    const review = await flow.call('POST', `/imports/${importId}/review`, { runId: reviewedRunId })
    expect(review.statusCode).toBe(409)
    expect(review.json().code).toBe('validation_run_required')
  })

  it('answers 409 settlement_not_processed to a second undo', async () => {
    const res = await undo(first.batchId)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'settlement_not_processed', details: { status: 'undone' } })
  })

  it('proposes the same number with the next attempt, and without the import the next free one', async () => {
    const withImport = await flow.call('GET', `/accounts/${first.accountId}/batch-number/next?importId=${importId}`)
    expect(withImport.json()).toMatchObject({ batchNo: first.batchNo, attemptNo: 2, reason: 'reprocess' })
    const without = await flow.call('GET', `/accounts/${first.accountId}/batch-number/next`)
    expect(without.json()).toMatchObject({ reason: 'next' })
    expect(without.json().batchNo).toBeGreaterThan(first.batchNo)
  })

  it('processes attempt 2 end to end against expected.json, the undone one not counting as previous', async () => {
    const runId = await flow.validateAndReview(importId)
    expect(runId).not.toBe(reviewedRunId)

    const second = await processSample(importId, runId, first.batchNo)

    expect(second).toMatchObject({
      batchNo: first.batchNo,
      attemptNo: 2,
      status: 'processed',
      amountPayable: first.amountPayable,
      movements: expectedOf('batch-clean').byCycle,
      totals: first.totals,
    })
    expect(await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })).toMatchObject({
      status: 'processed',
      currentBatchId: second.batchId,
    })
    const list = (await flow.call('GET', `/imports/${importId}/settlements`)).json()
    expect(list.items.map((a: { attemptNo: number }) => a.attemptNo)).toEqual([2, 1])
  })

  it('pays, unpays and undoes attempt 2, and attempt 3 keeps all of them', async () => {
    const { currentBatchId } = await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })
    const second = fixtureId(currentBatchId, 'attempt 2')

    expect((await pay(second)).statusCode).toBe(200)
    const blocked = await undo(second)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ code: 'settlement_payment_not_removed', details: { status: 'paid' } })
    expect((await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })).status).toBe('processed')
    expect((await unpay(second, REASON)).statusCode).toBe(200)
    const res = await undo(second)
    expect(res.statusCode, res.body).toBe(200)
    expect(SettlementView.parse(res.json())).toMatchObject({ status: 'undone', paidAt: null, paidBy: null })

    const third = await processSample(importId, await flow.validateAndReview(importId), first.batchNo)

    expect(third.attemptNo).toBe(3)
    const attempts = await ctx.prisma.settlementBatch.findMany({
      where: { importId },
      orderBy: { attemptNo: 'asc' },
      select: { attemptNo: true, status: true },
    })
    expect(attempts).toEqual([
      { attemptNo: 1, status: 'undone' },
      { attemptNo: 2, status: 'undone' },
      { attemptNo: 3, status: 'processed' },
    ])
  })

  it('answers 403 to viewer and payments', async () => {
    const { currentBatchId } = await ctx.prisma.import.findUniqueOrThrow({ where: { importId } })
    for (const user of ['viewer', 'payments'] as const) {
      const res = await flow.call('POST', `/settlements/${currentBatchId}/undo`, { reason: 'no' }, user)
      expect(res.statusCode, res.body).toBe(403)
    }
  })
})

describe('after undoing, the import is open again', () => {
  const missingOf = async (runId: number) =>
    (
      await ctx.prisma.validationIssue.findMany({
        where: { issueType: 'missing', result: { runId } },
        select: { transactionId: true, cycle: true },
      })
    ).map((i) => `${i.cycle}:${i.transactionId}`)

  const processWithoutFees = async (importId: string, runId: number) => {
    const res = await flow.call('POST', `/imports/${importId}/settlements`, {
      runId,
      confirmChannelAssignment: true,
      batchFees: [],
    })
    expect(res.statusCode, res.body).toBe(201)
    return SettlementView.parse(res.json())
  }

  it('a new run of another import brings back the missing findings the undone attempt had registered', async () => {
    const validated = await flow.validatedSample('batch-issues')
    const registered = await missingOf(validated.runId)
    expect(registered.length).toBeGreaterThan(0)
    const attempt = await processWithoutFees(validated.importId, validated.runId)
    const other = await flow.analyzedSample('batch-issues')
    const run = async () => {
      const res = await flow.call('POST', `/imports/${other.importId}/validations`)
      expect(res.statusCode, res.body).toBe(201)
      return missingOf(res.json().run.runId)
    }

    const whileProcessed = await run()
    expect(registered.filter((finding) => whileProcessed.includes(finding))).toEqual([])

    expect((await undo(attempt.batchId)).statusCode).toBe(200)

    expect(await run()).toEqual(expect.arrayContaining(registered))

    await flow.removeImports([validated.importId, other.importId])
  })

  it('admits validating, changing an inclusion and cancelling', async () => {
    const validated = await flow.validatedSample('batch-issues')
    const attempt = await processWithoutFees(validated.importId, validated.runId)
    expect((await undo(attempt.batchId)).statusCode).toBe(200)

    const run = await flow.call('POST', `/imports/${validated.importId}/validations`)
    expect(run.statusCode, run.body).toBe(201)
    const issues = await flow.call(
      'GET',
      `/imports/${validated.importId}/validation-issues?type=duplicate&scope=in_batch`,
    )
    const detail = await flow.call('GET', `/validation-issues/${issues.json().items[0].issueId}`)
    const excluded = detail.json().occurrences.find((o: { defaultIncluded: boolean }) => !o.defaultIncluded)
    const inclusion = await flow.call('PATCH', `/conflict-occurrences/${excluded.occurrenceId}`, {
      includeInSettlement: true,
    })
    expect(inclusion.statusCode, inclusion.body).toBe(200)

    const cancel = await flow.call('POST', `/imports/${validated.importId}/cancel`)
    expect(cancel.statusCode, cancel.body).toBe(200)
    expect((await ctx.prisma.import.findUniqueOrThrow({ where: { importId: validated.importId } })).status).toBe(
      'cancelled',
    )

    await flow.removeImports([validated.importId])
  })
})

describe('a seeded attempt, without a process audit nor a run', () => {
  it('can be undone: its import ends analyzed, and nothing is superseded', async () => {
    const seeded = await ctx.prisma.settlementBatch.findFirst({
      where: { status: 'paid', account: { name: 'ProviderA-USD' }, import: { status: 'processed' } },
      orderBy: { batchNo: 'desc' },
    })
    const batchId = fixtureId(seeded?.batchId, 'a seeded paid batch')
    const before = await ctx.prisma.import.findUniqueOrThrow({ where: { importId: seeded!.importId } })
    expect(before.currentBatchId?.toLowerCase()).toBe(batchId.toLowerCase())
    try {
      // The seed only writes paid batches: the payment goes first.
      expect((await unpay(batchId, REASON)).statusCode).toBe(200)
      const res = await undo(batchId)

      expect(res.statusCode, res.body).toBe(200)
      expect(SettlementView.parse(res.json())).toMatchObject({ status: 'undone', validationSummary: null })
      const audit = (await auditOf(batchId)).find((a) => a.action === 'settlement.undo')
      expect(JSON.parse(audit!.detailJson!)).toMatchObject({ reopenedMissingIssueIds: [], supersededRunId: null })
    } finally {
      await ctx.prisma.settlementBatch.update({
        where: { batchId },
        data: {
          status: 'paid',
          paidAt: seeded!.paidAt,
          paidByUserId: seeded!.paidByUserId,
          undoneAt: null,
          undoneByUserId: null,
          undoReason: null,
          updatedAt: seeded!.updatedAt,
        },
      })
      await ctx.prisma.import.update({
        where: { importId: seeded!.importId },
        data: { status: before.status, currentBatchId: before.currentBatchId, updatedAt: before.updatedAt },
      })
      await ctx.prisma.auditLog.deleteMany({
        where: {
          entityType: 'SettlementBatch',
          entityId: batchId.toLowerCase(),
          action: { in: ['settlement.unpay', 'settlement.undo'] },
        },
      })
    }
  })
})
