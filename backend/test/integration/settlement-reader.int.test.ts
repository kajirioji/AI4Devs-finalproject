import { SettlementView } from '@recon/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../src/generated/prisma/client.js'
import { toMoney } from '../../src/infrastructure/decimal.js'
import { Decimal } from '../../src/modules/settlement/domain/money.js'
import { PrismaSettlementReader } from '../../src/modules/settlement/infrastructure/prisma-settlement-reader.js'
import { createPrismaClient } from './helpers.js'

// The reader against the seeded history (code review M3): seeded batches have no settlement.process audit, so the
// view carries neutral skipped/warnings/channelsAssigned and a null validation summary. Read only: nothing is written.
let prisma: PrismaClient

beforeAll(() => {
  prisma = createPrismaClient()
})

afterAll(async () => {
  await prisma?.$disconnect()
})

/** A paid batch of ProviderA-USD written by the seed, i.e. without a settlement.process audit. */
async function seededPaidBatch() {
  const batches = await prisma.settlementBatch.findMany({
    where: { status: 'paid', account: { name: 'ProviderA-USD' } },
    orderBy: { batchNo: 'asc' },
    select: { batchId: true },
  })
  const audited = await prisma.auditLog.findMany({
    where: {
      entityType: 'SettlementBatch',
      action: 'settlement.process',
      entityId: { in: batches.map((b) => b.batchId) },
    },
    select: { entityId: true },
  })
  const auditedIds = new Set(audited.map((a) => a.entityId))
  const batch = batches.find((b) => !auditedIds.has(b.batchId))
  if (batch === undefined) throw new Error('the seed has no paid batch of ProviderA-USD without a process audit')
  return prisma.settlementBatch.findUniqueOrThrow({ where: { batchId: batch.batchId }, include: { totals: true } })
}

describe('PrismaSettlementReader on a seeded batch without a process audit', () => {
  it('returns a view that satisfies the contract with neutral audit values', async () => {
    const batch = await seededPaidBatch()
    const log = { warn: vi.fn() }
    const view = await new PrismaSettlementReader(prisma, { log }).view(batch.batchId)

    expect(view).not.toBeNull()
    expect(() => SettlementView.parse(view)).not.toThrow()
    expect(view!.skipped).toEqual({
      ignored: 0,
      unmatched: 0,
      ambiguous: 0,
      excluded: 0,
      unresolvedStatus: 0,
      pending: 0,
    })
    expect(view!.warnings).toEqual([])
    expect(view!.channelsAssigned).toEqual([])
    expect(view!.validationSummary).toBeNull()

    expect(view!.status).toBe('paid')
    expect(view!.settledStatus).toBe('settled')
    expect(view!.paidBy?.userName).toBe('payments')
    expect(view!.paidAt).toBe(batch.paidAt?.toISOString())
    expect(view!).toMatchObject({ undoneAt: null, undoneBy: null, undoReason: null })
    expect(view!.amountPayable).toBe(toMoney(batch.amountPayable))
    expect(view!.otherFeeAmt).toBe(toMoney(batch.otherFeeAmt))
    expect(view!.reserveHeldAmt).toBe(toMoney(batch.reserveHeldAmt))
    expect(view!.reserveReleasedAmt).toBe(toMoney(batch.reserveReleasedAmt))
    expect(view!.mdrAmt).toBe(toMoney(batch.mdrAmt))
    for (const total of batch.totals) {
      const line = view!.totals.find((t) => t.category === total.category)
      expect(line).toMatchObject({ qty: total.qty, amount: toMoney(total.amount), feeAmount: toMoney(total.feeAmount) })
    }

    // L2: the column is returned as is; a warning is logged only when it disagrees with the breakdown.
    const sum = view!.payableBreakdown
      .reduce((t, l) => (l.sign === '+' ? t.plus(l.amount) : t.minus(l.amount)), new Decimal(0))
      .toFixed(4)
    expect(log.warn).toHaveBeenCalledTimes(sum === view!.amountPayable ? 0 : 1)
  })
})
