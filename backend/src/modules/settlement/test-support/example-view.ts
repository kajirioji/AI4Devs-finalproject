/** A SettlementView as the contract example for #13 shows it (design "Contrato para #13"), for service and route tests. */
import type { SettlementView } from '@recon/shared'

export const EXAMPLE_BATCH_ID = '5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d'

export function exampleView(overrides: Partial<SettlementView> = {}): SettlementView {
  const zero = '0.0000'
  return {
    batchId: EXAMPLE_BATCH_ID,
    importId: '7b0c2a52-3f8e-4d0a-9a61-0d8f3b1e2c44',
    accountId: 'a0000000-0000-4000-8000-000000000001',
    accountName: 'ProviderA-USD',
    batchNo: 123,
    attemptNo: 1,
    status: 'processed',
    settledStatus: 'pending_payment',
    approvedBy: { userId: 2, userName: 'analyst' },
    processedAt: '2026-10-19T15:40:03.120Z',
    settlementDate: null,
    paidAt: null,
    paidBy: null,
    undoneAt: null,
    undoneBy: null,
    undoReason: null,
    dateRanges: { APP: null, DEC: null, I: null, R: null },
    channels: ['RAM-01'],
    movements: { E: 1, I: 0, R: 0 },
    totals: (['deposit', 'declined', 'chargeback', 'refund', 'rdr'] as const).map((category) => ({
      category,
      qty: category === 'deposit' ? 1 : 0,
      amount: category === 'deposit' ? '100.0000' : zero,
      feeAmount: zero,
      feeRate: null,
    })),
    brandTotals: [{ cardBrand: 'VISA', qty: 1, amount: '100.0000' }],
    reservesReleasedQty: 0,
    mdrAmt: zero,
    mdrRate: null,
    transactionalFeeAmt: zero,
    batchFees: [],
    otherFeeAmt: zero,
    reserveHeldAmt: '10.0000',
    reserveReleasedAmt: zero,
    reserveEarlyReleasedAmt: zero,
    amountPayable: '90.0000',
    payableBreakdown: [
      { code: 'deposit', label: 'Deposits', sign: '+', amount: '100.0000' },
      { code: 'chargeback', label: 'Chargebacks', sign: '-', amount: zero },
      { code: 'refund', label: 'Refunds', sign: '-', amount: zero },
      { code: 'rdr', label: 'RDR', sign: '-', amount: zero },
      { code: 'transactional_fees', label: 'Transaction fees', sign: '-', amount: zero },
      { code: 'batch_fees', label: 'Batch fees', sign: '-', amount: zero },
      { code: 'reserve_held', label: 'Reserve held', sign: '-', amount: '10.0000' },
      { code: 'reserve_released', label: 'Reserve released', sign: '+', amount: zero },
      { code: 'reserve_early_released', label: 'Reserve released on chargeback', sign: '+', amount: zero },
    ],
    skipped: { ignored: 0, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 },
    warnings: [{ code: 'transactional_fees_not_computed' }],
    channelsAssigned: [],
    validationSummary: { runId: 1, persistent: 0, resolved: 0, blocking: 0, resolvedMissing: 0 },
    exports: {
      summary: `/api/v1/settlements/${EXAMPLE_BATCH_ID}/export?type=summary`,
      transactions: `/api/v1/settlements/${EXAMPLE_BATCH_ID}/export?type=transactions`,
      reserves: `/api/v1/settlements/${EXAMPLE_BATCH_ID}/export?type=reserves`,
    },
    ...overrides,
  }
}
