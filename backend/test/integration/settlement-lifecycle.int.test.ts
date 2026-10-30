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
import { type AccountChannelRow, ImportFlow, restoreAccountChannels, snapshotAccountChannels } from './import-flow.js'

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

  it('pays: paid, settled, audited, and the movements read as Settled (HU3 CA7)', async () => {
    const movementsBefore = await movementsOf(batchId)

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
