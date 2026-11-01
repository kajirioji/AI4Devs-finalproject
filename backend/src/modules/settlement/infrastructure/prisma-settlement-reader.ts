// The view of an attempt read back from what was written (settlement-process design D19): the 201 of processing and,
// in #12, GET /settlements/{id}. Skipped rows, warnings and channel assignments live in the settlement.process audit.
import {
  BatchStatus,
  type ChannelAssigned,
  type SettlementView,
  type SettlementWarning,
  type Skipped,
} from '@recon/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { PrismaClient } from '../../../generated/prisma/client.js'
import { toMoney, toPercentage } from '../../../infrastructure/decimal.js'
import type { Scope } from '../../catalog/domain/scope.js'
import { shownAccount } from '../domain/channels.js'
import { payableBreakdown } from '../domain/payable-breakdown.js'
import { settledStatusOf } from '../domain/settled.js'

const API = '/api/v1'
const day = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10))
const range = (min: Date | null, max: Date | null) =>
  min === null || max === null ? null : { min: min.toISOString(), max: max.toISOString() }

interface ProcessAudit {
  runId: number
  skipped: Skipped
  warnings: SettlementWarning[]
  /** The previous account carries its merchant since the review of #66 (older entries do not). */
  channelsAssigned: (Omit<ChannelAssigned, 'previousAccount'> & {
    previousAccount: { accountId: string; name: string; merchantId?: number } | null
  })[]
  resolvedMissing: number
}

/** What a batch without a settlement.process audit (e.g. seeded history) reports: nothing skipped, nothing warned. */
const NO_SKIPPED: Skipped = { ignored: 0, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 }

export interface SettlementReaderOptions {
  /** Warned when the stored amountPayable disagrees with the recomputed breakdown. */
  log?: Pick<FastifyBaseLogger, 'warn'>
}

export class PrismaSettlementReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: SettlementReaderOptions = {},
  ) {}

  async view(batchId: string, scope?: Scope): Promise<SettlementView | null> {
    const batch = await this.prisma.settlementBatch.findUnique({
      where: { batchId },
      include: {
        account: { select: { name: true } },
        approvedBy: { select: { userId: true, userName: true } },
        paidBy: { select: { userId: true, userName: true } },
        undoneBy: { select: { userId: true, userName: true } },
        totals: true,
        brandTotals: true,
        fees: {
          orderBy: { batchFeeId: 'asc' },
          include: {
            feeType: { select: { code: true, title: true } },
            enteredBy: { select: { userId: true, userName: true } },
          },
        },
      },
    })
    if (batch === null) return null
    const audit = await this.prisma.auditLog.findFirst({
      where: { entityType: 'SettlementBatch', entityId: batchId, action: 'settlement.process' },
      select: { detailJson: true },
    })
    const detailJson = audit?.detailJson ?? null
    const detail = detailJson === null ? null : (JSON.parse(detailJson) as ProcessAudit)
    const byCycle = await this.prisma.settlementTransaction.groupBy({
      by: ['cycle'],
      where: { batchId },
      _count: { _all: true },
    })
    const count = (cycle: string) => byCycle.find((c) => c.cycle === cycle)?._count._all ?? 0
    const sums = await this.prisma.settlementTransaction.aggregate({
      where: { batchId },
      _sum: { feeAmount: true, reserveEarlyReleasedAmt: true },
    })
    const channelRows = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT c.[name] FROM [SettlementTransaction] st
      JOIN [Transaction] t ON t.[transactionId] = st.[transactionId]
      JOIN [Channel] c ON c.[channelId] = t.[channelId]
      WHERE st.[batchId] = ${batchId}`
    // Only with a run to filter on: an undefined runId would drop the filter and group every finding of the base.
    const issues =
      detail === null
        ? []
        : await this.prisma.validationIssue.groupBy({
            by: ['resolutionStatus', 'blocking'],
            where: { result: { runId: detail.runId } },
            _count: { _all: true },
          })
    const issuesWhere = (match: (i: (typeof issues)[number]) => boolean) =>
      issues.filter(match).reduce((total, i) => total + i._count._all, 0)

    const order = ['deposit', 'declined', 'chargeback', 'refund', 'rdr']
    const totals = [...batch.totals]
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
      .map((t) => ({
        category: t.category as SettlementView['totals'][number]['category'],
        qty: t.qty,
        amount: toMoney(t.amount),
        feeAmount: toMoney(t.feeAmount),
        feeRate: toPercentage(t.feeRate),
      }))
    const amountOf = (category: string) => totals.find((t) => t.category === category)?.amount ?? '0.0000'
    const transactionalFeeAmt = toMoney(sums._sum.feeAmount) ?? '0.0000'
    const reserveEarlyReleasedAmt = toMoney(sums._sum.reserveEarlyReleasedAmt) ?? '0.0000'
    const breakdown = payableBreakdown({
      deposit: amountOf('deposit'),
      chargeback: amountOf('chargeback'),
      refund: amountOf('refund'),
      rdr: amountOf('rdr'),
      transactionalFees: transactionalFeeAmt,
      batchFees: toMoney(batch.otherFeeAmt),
      reserveHeld: toMoney(batch.reserveHeldAmt),
      reserveReleased: toMoney(batch.reserveReleasedAmt),
      reserveEarlyReleased: reserveEarlyReleasedAmt,
    })
    const amountPayable = toMoney(batch.amountPayable)
    if (breakdown.amountPayable !== amountPayable) {
      this.options.log?.warn(
        { batchId, amountPayable, breakdownAmountPayable: breakdown.amountPayable },
        'stored amountPayable differs from the sum of its breakdown',
      )
    }
    const status = BatchStatus.parse(batch.status)
    const exportOf = (type: string) => `${API}/settlements/${batchId}/export?type=${type}`
    return {
      batchId,
      importId: batch.importId,
      accountId: batch.accountId,
      accountName: batch.account.name,
      batchNo: batch.batchNo,
      attemptNo: batch.attemptNo,
      status,
      settledStatus: settledStatusOf(status),
      approvedBy: batch.approvedBy,
      processedAt: batch.processedAt.toISOString(),
      settlementDate: day(batch.settlementDate),
      paidAt: batch.paidAt?.toISOString() ?? null,
      paidBy: batch.paidBy,
      undoneAt: batch.undoneAt?.toISOString() ?? null,
      undoneBy: batch.undoneBy,
      undoReason: batch.undoReason,
      dateRanges: {
        APP: range(batch.dateMinApp, batch.dateMaxApp),
        DEC: range(batch.dateMinDec, batch.dateMaxDec),
        I: range(batch.dateMinI, batch.dateMaxI),
        R: range(batch.dateMinR, batch.dateMaxR),
      },
      channels: channelRows.map((c) => c.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      movements: { E: count('E'), I: count('I'), R: count('R') },
      totals,
      // Code order, as the engine sorts them for the preview: SQL Server's collation would order them otherwise.
      brandTotals: batch.brandTotals
        .map((b) => ({ cardBrand: b.cardBrand, qty: b.qty, amount: toMoney(b.amount) }))
        .sort((a, b) => (a.cardBrand < b.cardBrand ? -1 : a.cardBrand > b.cardBrand ? 1 : 0)),
      reservesReleasedQty: count('R'),
      mdrAmt: toMoney(batch.mdrAmt),
      mdrRate: toPercentage(batch.mdrRate),
      transactionalFeeAmt,
      batchFees: batch.fees.map((f) => ({
        batchFeeId: f.batchFeeId,
        feeTypeId: f.feeTypeId,
        code: f.feeType.code,
        title: f.feeType.title,
        feeId: f.feeId,
        amount: toMoney(f.amount),
        description: f.description,
        source: f.source === 'file' ? 'file' : 'manual',
        enteredBy: f.enteredBy,
      })),
      otherFeeAmt: toMoney(batch.otherFeeAmt),
      reserveHeldAmt: toMoney(batch.reserveHeldAmt),
      reserveReleasedAmt: toMoney(batch.reserveReleasedAmt),
      reserveEarlyReleasedAmt,
      amountPayable,
      payableBreakdown: breakdown.lines,
      skipped: detail?.skipped ?? NO_SKIPPED,
      warnings: detail?.warnings ?? [],
      channelsAssigned: (detail?.channelsAssigned ?? []).map((c) => ({
        ...c,
        previousAccount: c.previousAccount === null ? null : shownAccount(scope, c.previousAccount),
      })),
      validationSummary:
        detail === null
          ? null
          : {
              runId: detail.runId,
              persistent: issuesWhere((i) => i.resolutionStatus === 'persistent'),
              resolved: issuesWhere((i) => i.resolutionStatus === 'resolved'),
              blocking: issuesWhere((i) => i.blocking),
              resolvedMissing: detail.resolvedMissing,
            },
      exports: { summary: exportOf('summary'), transactions: exportOf('transactions'), reserves: exportOf('reserves') },
    }
  }
}
