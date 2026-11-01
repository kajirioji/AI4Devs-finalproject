import { describe, expect, it } from 'vitest'
import {
  BatchFeeInput,
  BatchFeeInvalidDetails,
  BatchFeeInvalidReason,
  BatchNoTakenDetails,
  ChannelAssignmentNotConfirmedDetails,
  ImportNotValidatedDetails,
  NextBatchNumber,
  PAYABLE_LINE_CODES,
  PayableLine,
  ReasonRequest,
  SettlementNotCurrentDetails,
  SettlementPreview,
  SettlementRequest,
  SettlementStateDetails,
  SettlementView,
  SettlementWarning,
  Skipped,
} from './settlement.js'

// Contract for #13 and #12 (settlement-process design, "Contrato para #13"): money as decimal strings, never numbers.
const user = { userId: 2, userName: 'analyst' }
const range = { min: '2026-09-28T00:04:11.000Z', max: '2026-10-07T23:58:40.000Z' }
const totals = [
  { category: 'deposit', qty: 340, amount: '39181.0700', feeAmount: '4139.1070', feeRate: '0.100000' },
  { category: 'declined', qty: 110, amount: '0.0000', feeAmount: '27.5000', feeRate: null },
  { category: 'chargeback', qty: 2, amount: '193.8600', feeAmount: '90.0000', feeRate: null },
  { category: 'refund', qty: 6, amount: '843.9900', feeAmount: '30.0000', feeRate: null },
  { category: 'rdr', qty: 2, amount: '391.5500', feeAmount: '50.0000', feeRate: null },
]
const breakdown = [
  { code: 'deposit', label: 'Deposits', sign: '+', amount: '39181.0700' },
  { code: 'chargeback', label: 'Chargebacks', sign: '-', amount: '193.8600' },
  { code: 'refund', label: 'Refunds', sign: '-', amount: '843.9900' },
  { code: 'rdr', label: 'RDR', sign: '-', amount: '391.5500' },
  { code: 'transactional_fees', label: 'Transaction fees', sign: '-', amount: '4336.6070' },
  { code: 'batch_fees', label: 'Batch fees', sign: '-', amount: '40.0000' },
  { code: 'reserve_held', label: 'Reserve held', sign: '-', amount: '3918.1070' },
  { code: 'reserve_released', label: 'Reserve released', sign: '+', amount: '4314.4040' },
  { code: 'reserve_early_released', label: 'Reserve released on chargeback', sign: '+', amount: '0.0000' },
]
const figures = {
  dateRanges: { APP: range, DEC: range, I: range, R: null },
  channels: ['RAM-01', 'RAM-07'],
  movements: { E: 450, I: 10, R: 320 },
  totals,
  brandTotals: [{ cardBrand: 'VISA', qty: 204, amount: '23508.6400' }],
  reservesReleasedQty: 320,
  mdrAmt: '3918.1070',
  mdrRate: '0.100000',
  transactionalFeeAmt: '4336.6070',
  batchFees: [
    {
      batchFeeId: 41,
      feeTypeId: 121,
      code: 'Wire Fee',
      title: 'Wire Fee',
      feeId: null,
      amount: '25.0000',
      description: 'Wire Fee',
      source: 'file',
      enteredBy: user,
    },
  ],
  otherFeeAmt: '40.0000',
  reserveHeldAmt: '3918.1070',
  reserveReleasedAmt: '4314.4040',
  reserveEarlyReleasedAmt: '0.0000',
  amountPayable: '33771.3600',
  payableBreakdown: breakdown,
  skipped: { ignored: 3, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 },
  warnings: [],
}
const view = {
  ...figures,
  batchId: '5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d',
  importId: '7b0c2a52-3f8e-4d0a-9a61-0d8f3b1e2c44',
  accountId: 'efb2446e-1c0d-4c55-9a3e-2f7d1b9e0a11',
  accountName: 'ProviderA-USD',
  batchNo: 123,
  attemptNo: 1,
  status: 'processed',
  settledStatus: 'pending_payment',
  approvedBy: user,
  processedAt: '2026-10-19T15:40:03.120Z',
  settlementDate: '2026-10-24',
  paidAt: null,
  paidBy: null,
  undoneAt: null,
  undoneBy: null,
  undoReason: null,
  channelsAssigned: [{ channelId: 1007, name: 'RAM-07', assignment: 'new_primary', previousAccount: null }],
  validationSummary: { runId: 12, persistent: 0, resolved: 0, blocking: 0, resolvedMissing: 0 },
  exports: {
    summary: '/api/v1/settlements/5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d/export?type=summary',
    transactions: '/api/v1/settlements/5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d/export?type=transactions',
    reserves: '/api/v1/settlements/5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d/export?type=reserves',
  },
}
const preview = {
  ...figures,
  batchFees: [{ ...figures.batchFees[0], batchFeeId: null, enteredBy: null }],
  importId: view.importId,
  accountId: view.accountId,
  runId: 12,
  batchNo: 123,
  attemptNo: 1,
  batchNoAvailable: true,
  requiresChannelConfirmation: true,
  channelsToAssign: [{ channelId: 1007, name: 'RAM-07', assignment: 'unassigned', otherAccount: null }],
}

describe('SettlementRequest (README §4.3, runId required)', () => {
  const body = {
    runId: 12,
    batchNo: 123,
    settlementDate: '2026-10-24',
    confirmChannelAssignment: true,
    batchFees: [{ feeTypeId: 121, feeId: null, amount: '25.0000', description: 'Wire Fee', source: 'file' }],
  }

  it('accepts the example of the contract and a body with only runId', () => {
    expect(SettlementRequest.safeParse(body).success).toBe(true)
    expect(SettlementRequest.safeParse({ runId: 12 }).success).toBe(true)
  })

  it('requires runId', () => {
    const { runId: _, ...withoutRunId } = body
    expect(SettlementRequest.safeParse(withoutRunId).success).toBe(false)
  })

  it('is strict and rejects a non-positive batchNo or a malformed settlementDate', () => {
    expect(SettlementRequest.safeParse({ ...body, extra: 1 }).success).toBe(false)
    expect(SettlementRequest.safeParse({ ...body, batchNo: 0 }).success).toBe(false)
    expect(SettlementRequest.safeParse({ ...body, settlementDate: '24/10/2026' }).success).toBe(false)
  })

  it('keeps runId and batchNo within an INT column', () => {
    expect(SettlementRequest.safeParse({ ...body, runId: 2_147_483_647, batchNo: 2_147_483_647 }).success).toBe(true)
    expect(SettlementRequest.safeParse({ ...body, runId: 2_147_483_648 }).success).toBe(false)
    expect(SettlementRequest.safeParse({ ...body, batchNo: 3_000_000_000 }).success).toBe(false)
  })

  it('rejects an impossible settlementDate', () => {
    expect(SettlementRequest.safeParse({ ...body, settlementDate: '2026-13-01' }).success).toBe(false)
    expect(SettlementRequest.safeParse({ ...body, settlementDate: '2026-02-30' }).success).toBe(false)
  })

  it('takes at most 100 batch fees', () => {
    const fee = body.batchFees[0]
    expect(SettlementRequest.safeParse({ ...body, batchFees: Array(100).fill(fee) }).success).toBe(true)
    expect(SettlementRequest.safeParse({ ...body, batchFees: Array(101).fill(fee) }).success).toBe(false)
  })

  it('caps the note at 500 characters', () => {
    expect(SettlementRequest.safeParse({ ...body, note: 'x'.repeat(500) }).success).toBe(true)
    expect(SettlementRequest.safeParse({ ...body, note: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('BatchFeeInput', () => {
  const fee = {
    feeTypeId: 119,
    feeId: null,
    amount: '-42.5000',
    description: 'Duplicate in batch 115',
    source: 'manual',
  }

  it('takes the amount as a decimal string with sign and up to 4 decimals', () => {
    expect(BatchFeeInput.safeParse(fee).success).toBe(true)
    expect(BatchFeeInput.safeParse({ ...fee, amount: '150' }).success).toBe(true)
  })

  it('rejects more than 15 integer digits, which DECIMAL(19,4) cannot hold', () => {
    expect(BatchFeeInput.safeParse({ ...fee, amount: '999999999999999.9999' }).success).toBe(true)
    expect(BatchFeeInput.safeParse({ ...fee, amount: '1234567890123456789.1' }).success).toBe(false)
  })

  it('rejects a JSON number, more than 4 decimals and zero', () => {
    expect(BatchFeeInput.safeParse({ ...fee, amount: -42.5 }).success).toBe(false)
    expect(BatchFeeInput.safeParse({ ...fee, amount: '1.00001' }).success).toBe(false)
    expect(BatchFeeInput.safeParse({ ...fee, amount: '0.0000' }).success).toBe(false)
  })

  it('caps the description at 200 and accepts only file or manual as source', () => {
    expect(BatchFeeInput.safeParse({ ...fee, description: 'x'.repeat(201) }).success).toBe(false)
    expect(BatchFeeInput.safeParse({ ...fee, source: 'other' }).success).toBe(false)
  })

  it('takes feeId as a uuid or null', () => {
    expect(BatchFeeInput.safeParse({ ...fee, feeId: 'b7e1' }).success).toBe(false)
    expect(BatchFeeInput.safeParse({ ...fee, feeId: '0b6f4c1e-1a2b-4c3d-8e4f-000000000005' }).success).toBe(true)
  })
})

describe('PayableLine', () => {
  it('has the nine codes in the fixed order of the breakdown', () => {
    expect(PAYABLE_LINE_CODES).toEqual([
      'deposit',
      'chargeback',
      'refund',
      'rdr',
      'transactional_fees',
      'batch_fees',
      'reserve_held',
      'reserve_released',
      'reserve_early_released',
    ])
  })

  it('takes + or - as sign and a 4-decimal amount', () => {
    expect(PayableLine.safeParse(breakdown[0]).success).toBe(true)
    expect(PayableLine.safeParse({ ...breakdown[0], sign: 'plus' }).success).toBe(false)
    expect(PayableLine.safeParse({ ...breakdown[0], amount: 39181.07 }).success).toBe(false)
  })
})

describe('SettlementView and SettlementPreview', () => {
  it('parse the examples of the contract', () => {
    expect(SettlementView.safeParse(view).success).toBe(true)
    expect(SettlementPreview.safeParse(preview).success).toBe(true)
  })

  it('always carry the five categories in their order', () => {
    expect(SettlementView.safeParse({ ...view, totals: totals.slice(0, 4) }).success).toBe(false)
    expect(SettlementView.safeParse({ ...view, totals: [totals[1], totals[0], ...totals.slice(2)] }).success).toBe(
      false,
    )
  })

  it('carry the nine lines of the breakdown in their order', () => {
    expect(SettlementView.safeParse({ ...view, payableBreakdown: breakdown.slice(1) }).success).toBe(false)
  })

  it('reject money as a JSON number and amounts without 4 decimals', () => {
    expect(SettlementView.safeParse({ ...view, amountPayable: 33771.36 }).success).toBe(false)
    expect(SettlementView.safeParse({ ...view, amountPayable: '33771.36' }).success).toBe(false)
  })

  it('know the three statuses of an attempt and their settled status', () => {
    expect(SettlementView.safeParse({ ...view, status: 'paid', settledStatus: 'settled' }).success).toBe(true)
    expect(SettlementView.safeParse({ ...view, status: 'pending' }).success).toBe(false)
  })

  it('accept a null validation summary for an attempt without a process audit', () => {
    expect(SettlementView.safeParse({ ...view, validationSummary: null }).success).toBe(true)
    expect(SettlementView.safeParse({ ...view, validationSummary: undefined }).success).toBe(false)
  })
})

describe('SettlementView, payment and undo fields', () => {
  const instant = '2026-10-20T15:00:00.000Z'

  it('are null while they do not apply, and required', () => {
    expect(view).toMatchObject({ paidAt: null, paidBy: null, undoneAt: null, undoneBy: null, undoReason: null })
    for (const key of ['paidAt', 'paidBy', 'undoneAt', 'undoneBy', 'undoReason'])
      expect(SettlementView.safeParse({ ...view, [key]: undefined }).success).toBe(false)
  })

  it('carry who paid and who undid, with their instants', () => {
    const paid = { ...view, status: 'paid', settledStatus: 'settled', paidAt: instant, paidBy: user }
    const undone = { ...view, status: 'undone', settledStatus: 'undone', undoneAt: instant, undoneBy: user }
    expect(SettlementView.safeParse(paid).success).toBe(true)
    expect(SettlementView.safeParse({ ...undone, undoReason: 'Wrong settlement date' }).success).toBe(true)
    expect(SettlementView.safeParse({ ...paid, paidAt: '2026-10-20' }).success).toBe(false)
  })
})

describe('ReasonRequest', () => {
  it('takes a reason and returns it without the spaces of its ends', () => {
    expect(ReasonRequest.parse({ reason: '  Wrong settlement date ' })).toEqual({ reason: 'Wrong settlement date' })
    expect(ReasonRequest.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true)
  })

  it('rejects a missing, empty, blank or too long reason, and anything else in the body', () => {
    expect(ReasonRequest.safeParse({}).success).toBe(false)
    expect(ReasonRequest.safeParse({ reason: '' }).success).toBe(false)
    expect(ReasonRequest.safeParse({ reason: '   ' }).success).toBe(false)
    expect(ReasonRequest.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false)
    expect(ReasonRequest.safeParse({ reason: 'ok', note: 'no' }).success).toBe(false)
  })

  it('counts the length after trimming', () => {
    expect(ReasonRequest.safeParse({ reason: `  ${'x'.repeat(500)}  ` }).success).toBe(true)
  })
})

describe('Details of the lifecycle errors', () => {
  it('carry the status of the attempt', () => {
    expect(SettlementStateDetails.safeParse({ status: 'paid' }).success).toBe(true)
    expect(SettlementStateDetails.safeParse({ status: 'analyzed' }).success).toBe(false)
  })

  it('carry the state of the import for an attempt that is not its current one', () => {
    expect(SettlementNotCurrentDetails.safeParse({ importStatus: 'analyzed', currentBatchId: null }).success).toBe(true)
  })
})

describe('Skipped and SettlementWarning', () => {
  it('Skipped counts the six reasons', () => {
    expect(Skipped.safeParse(figures.skipped).success).toBe(true)
    expect(Skipped.safeParse({ ...figures.skipped, pending: -1 }).success).toBe(false)
  })

  it('SettlementWarning knows each code with its own fields', () => {
    const where = { transactionId: '42', sheetId: '0b6f4c1e-1a2b-4c3d-8e4f-000000000005', rowNo: 7 }
    expect(SettlementWarning.safeParse({ code: 'undated_adjustment', ...where, feeSkipped: true }).success).toBe(true)
    expect(SettlementWarning.safeParse({ code: 'reserve_already_released', ...where }).success).toBe(true)
    for (const code of [
      'no_transactional_fees',
      'reserve_cap_not_applied',
      'transactional_fees_not_computed',
      'chargeback_reserve_policy_not_applied',
    ])
      expect(SettlementWarning.safeParse({ code }).success).toBe(true)
    expect(SettlementWarning.safeParse({ code: 'fee_variant_not_applied', feeId: where.sheetId }).success).toBe(true)
    expect(SettlementWarning.safeParse({ code: 'undated_adjustment' }).success).toBe(false)
    expect(SettlementWarning.safeParse({ code: 'odd' }).success).toBe(false)
  })
})

describe('NextBatchNumber', () => {
  it('parses next and reprocess', () => {
    const next = { accountId: view.accountId, batchNo: 123, attemptNo: 1, reason: 'next' }
    expect(NextBatchNumber.safeParse(next).success).toBe(true)
    expect(NextBatchNumber.safeParse({ ...next, attemptNo: 2, reason: 'reprocess' }).success).toBe(true)
    expect(NextBatchNumber.safeParse({ ...next, reason: 'other' }).success).toBe(false)
  })
})

describe('error details', () => {
  it('batch_fee_invalid names the index and one of the reasons, description_required included', () => {
    expect(BatchFeeInvalidReason.options).toEqual([
      'unknown_fee_type',
      'transactional_fee_type',
      'fee_not_in_account',
      'fee_type_mismatch',
      'fee_not_in_force',
      'free_amount_not_allowed',
      'description_required',
    ])
    expect(BatchFeeInvalidDetails.safeParse({ index: 1, reason: 'free_amount_not_allowed' }).success).toBe(true)
  })

  it('batch_no_taken, channel_assignment_not_confirmed and import_not_validated', () => {
    expect(BatchNoTakenDetails.safeParse({ batchNo: 123, attemptNo: 1, importId: view.importId }).success).toBe(true)
    expect(ChannelAssignmentNotConfirmedDetails.safeParse({ channels: preview.channelsToAssign }).success).toBe(true)
    expect(ImportNotValidatedDetails.safeParse({ status: 'analyzed' }).success).toBe(true)
  })
})
