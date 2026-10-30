import { SettlementView } from '@recon/shared'
import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js'
import { PrismaSettlementReader } from './prisma-settlement-reader.js'

const BATCH_ID = '6f1c2a5e-0000-4000-8000-000000000001'
const money = (value: string) => new Prisma.Decimal(value)

/** A Prisma client that answers the reader's queries for one batch: deposit 1000, fee 30, held 100 → payable 870. */
function stubPrisma(amountPayable: string, audit: { detailJson: string } | null = null) {
  const groupBy = vi.fn(async (args: { by: string[] }) =>
    args.by[0] === 'cycle' ? [{ cycle: 'E', _count: { _all: 1 } }] : [],
  )
  const prisma = {
    settlementBatch: {
      findUnique: vi.fn(async () => ({
        batchId: BATCH_ID,
        importId: '6f1c2a5e-0000-4000-8000-000000000002',
        accountId: '6f1c2a5e-0000-4000-8000-000000000003',
        account: { name: 'ProviderA-USD' },
        approvedBy: { userId: 1, userName: 'analyst' },
        batchNo: 7,
        attemptNo: 1,
        status: 'paid',
        processedAt: new Date('2026-01-10T12:00:00.000Z'),
        settlementDate: null,
        paidAt: new Date('2026-01-11T09:30:00.000Z'),
        paidBy: { userId: 3, userName: 'payments' },
        undoneAt: null,
        undoneBy: null,
        undoReason: null,
        dateMinApp: null,
        dateMaxApp: null,
        dateMinDec: null,
        dateMaxDec: null,
        dateMinI: null,
        dateMaxI: null,
        dateMinR: null,
        dateMaxR: null,
        totals: ['deposit', 'declined', 'chargeback', 'refund', 'rdr'].map((category) => ({
          category,
          qty: category === 'deposit' ? 1 : 0,
          amount: money(category === 'deposit' ? '1000' : '0'),
          feeAmount: money(category === 'deposit' ? '30' : '0'),
          feeRate: null,
        })),
        brandTotals: [],
        fees: [],
        mdrAmt: money('30'),
        mdrRate: null,
        otherFeeAmt: money('0'),
        reserveHeldAmt: money('100'),
        reserveReleasedAmt: money('0'),
        amountPayable: money(amountPayable),
      })),
    },
    auditLog: { findFirst: vi.fn(async () => audit) },
    settlementTransaction: {
      groupBy,
      aggregate: vi.fn(async () => ({ _sum: { feeAmount: money('30'), reserveEarlyReleasedAmt: null } })),
    },
    validationIssue: { groupBy },
    $queryRaw: vi.fn(async () => [{ name: 'RAM-01' }]),
  }
  return { prisma: prisma as unknown as PrismaClient, groupBy }
}

describe('PrismaSettlementReader', () => {
  it('warns with both figures when the stored amountPayable differs from the breakdown, and returns the column', async () => {
    const log = { warn: vi.fn() }
    const view = await new PrismaSettlementReader(stubPrisma('875.0000').prisma, { log }).view(BATCH_ID)

    expect(view?.amountPayable).toBe('875.0000')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      { batchId: BATCH_ID, amountPayable: '875.0000', breakdownAmountPayable: '870.0000' },
      expect.any(String),
    )
  })

  it('does not warn when the column equals the breakdown', async () => {
    const log = { warn: vi.fn() }
    const view = await new PrismaSettlementReader(stubPrisma('870.0000').prisma, { log }).view(BATCH_ID)

    expect(view?.amountPayable).toBe('870.0000')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reads a batch without a process audit as neutral, without querying findings', async () => {
    const { prisma, groupBy } = stubPrisma('870.0000')
    const view = await new PrismaSettlementReader(prisma).view(BATCH_ID)

    expect(SettlementView.parse(view)).toMatchObject({ validationSummary: null, warnings: [], channelsAssigned: [] })
    expect(groupBy).toHaveBeenCalledTimes(1)
    expect(groupBy.mock.calls[0]?.[0].by).toEqual(['cycle'])
  })

  it('carries who paid and when, and leaves the undo fields empty', async () => {
    const view = await new PrismaSettlementReader(stubPrisma('870.0000').prisma).view(BATCH_ID)

    expect(SettlementView.parse(view)).toMatchObject({
      status: 'paid',
      settledStatus: 'settled',
      paidAt: '2026-01-11T09:30:00.000Z',
      paidBy: { userId: 3, userName: 'payments' },
      undoneAt: null,
      undoneBy: null,
      undoReason: null,
    })
  })

  it('takes the run of the process audit for the validation summary', async () => {
    const detail = {
      runId: 42,
      skipped: { ignored: 1, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 },
      warnings: [],
      channelsAssigned: [],
      resolvedMissing: 2,
    }
    const { prisma, groupBy } = stubPrisma('870.0000', { detailJson: JSON.stringify(detail) })
    const view = await new PrismaSettlementReader(prisma).view(BATCH_ID)

    expect(view?.validationSummary).toEqual({ runId: 42, persistent: 0, resolved: 0, blocking: 0, resolvedMissing: 2 })
    expect(view?.skipped).toEqual(detail.skipped)
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { result: { runId: 42 } } }))
  })
})
