// Processing a batch (README §4.3, settlement-process design "Contrato para #13" and "Contrato para #12"): the request,
// the preview, the view of an attempt and the details of its errors. Money travels as decimal strings, never numbers.
import { z } from 'zod'
import { UserRef } from './auth.js'
import { AccountRef } from './catalog.js'
import { HiddenAccountRef } from './imports.js'
import { BatchStatus, ImportStatus, IsoDate, Money } from './vocabulary.js'

/** BIGINT ids travel as decimal strings, never as JSON numbers (README §4). */
const BigIntId = z.string().regex(/^\d+$/)
const nonNegativeInt = z.number().int().nonnegative()
const positiveInt = z.number().int().positive()

/** DECIMAL(19,4) as the API returns it: always four decimals. */
export const Money4 = z.string().regex(/^-?\d+\.\d{4}$/, 'decimal string with 4 decimals expected')
/** DECIMAL(9,6) fraction as the API returns it: always six decimals. */
export const Rate6 = z.string().regex(/^(0\.\d{6}|1\.0{6})$/, 'fraction with 6 decimals expected')

// ───────────────────────── Request ─────────────────────────

export const BatchFeeSource = z.enum(['file', 'manual'])
export type BatchFeeSource = z.infer<typeof BatchFeeSource>

/**
 * A batch fee as the analyst confirms it: a preset of the account (`feeId`) or a free amount (`feeId: null`).
 * Rules that need the catalog (type, preset, free amount, required description) answer 400 batch_fee_invalid.
 */
export const BatchFeeInput = z.strictObject({
  feeTypeId: positiveInt,
  feeId: z.uuid().nullable(),
  amount: Money.refine((v) => !/^-?0+(\.0+)?$/.test(v), 'amount must not be zero'),
  description: z.string().max(200).optional(),
  /** `file`: pre-filled from the Other Fees sheet, as GET /imports/{id} returns it; `manual`: added by the analyst. */
  source: BatchFeeSource,
})
export type BatchFeeInput = z.infer<typeof BatchFeeInput>

/** INT columns: a larger number is a 400, not a failed query. */
const intColumn = positiveInt.max(2_147_483_647)
/**
 * A batch carries a handful of fees (the Other Fees sheet plus a few manual ones); 100 is far above any real batch
 * and bounds the catalog checks and inserts one request can ask for.
 */
const MAX_BATCH_FEES = 100

/** Body of POST /imports/{id}/settlements and of its preview. */
export const SettlementRequest = z.strictObject({
  /** The validation run the analyst reviewed. */
  runId: intColumn,
  /** Omitted: the proposed number of the account. */
  batchNo: intColumn.optional(),
  /** Business date (YYYY-MM-DD). */
  settlementDate: IsoDate.optional(),
  /** Audit only. */
  note: z.string().max(500).optional(),
  confirmChannelAssignment: z.boolean().optional(),
  batchFees: z.array(BatchFeeInput).max(MAX_BATCH_FEES).optional(),
})
export type SettlementRequest = z.infer<typeof SettlementRequest>

// ───────────────────────── Figures shared by the preview and the view ─────────────────────────

export const SETTLEMENT_CATEGORIES = ['deposit', 'declined', 'chargeback', 'refund', 'rdr'] as const
export const SettlementCategory = z.enum(SETTLEMENT_CATEGORIES)
export type SettlementCategory = z.infer<typeof SettlementCategory>

export const PAYABLE_LINE_CODES = [
  'deposit',
  'chargeback',
  'refund',
  'rdr',
  'transactional_fees',
  'batch_fees',
  'reserve_held',
  'reserve_released',
  'reserve_early_released',
] as const
export const PayableLineCode = z.enum(PAYABLE_LINE_CODES)
export type PayableLineCode = z.infer<typeof PayableLineCode>

/** A line of the amount payable: Σ (sign === '+' ? amount : −amount) over the nine lines is amountPayable. */
export const PayableLine = z.object({
  code: PayableLineCode,
  label: z.string(),
  sign: z.enum(['+', '-']),
  amount: Money4,
})
export type PayableLine = z.infer<typeof PayableLine>

export const CategoryTotal = z.object({
  category: SettlementCategory,
  qty: nonNegativeInt,
  /** Positive: the sign is applied by whoever presents it (README §1.2). */
  amount: Money4,
  feeAmount: Money4,
  feeRate: Rate6.nullable(),
})
export type CategoryTotal = z.infer<typeof CategoryTotal>

export const BrandTotal = z.object({ cardBrand: z.string(), qty: nonNegativeInt, amount: Money4 })
export type BrandTotal = z.infer<typeof BrandTotal>

export const BatchFeeView = z.object({
  /** null in a preview. */
  batchFeeId: positiveInt.nullable(),
  feeTypeId: positiveInt,
  code: z.string(),
  title: z.string(),
  feeId: z.uuid().nullable(),
  amount: Money4,
  description: z.string().nullable(),
  source: BatchFeeSource,
  /** null in a preview. */
  enteredBy: UserRef.nullable(),
})
export type BatchFeeView = z.infer<typeof BatchFeeView>

export const Skipped = z.object({
  ignored: nonNegativeInt,
  unmatched: nonNegativeInt,
  ambiguous: nonNegativeInt,
  excluded: nonNegativeInt,
  unresolvedStatus: nonNegativeInt,
  pending: nonNegativeInt,
})
export type Skipped = z.infer<typeof Skipped>

const RowRef = { transactionId: BigIntId, sheetId: z.uuid(), rowNo: positiveInt }

export const SettlementWarning = z.discriminatedUnion('code', [
  z.object({ code: z.literal('undated_adjustment'), ...RowRef, feeSkipped: z.boolean() }),
  /** Emitted once the chargeback reserve policy exists (#62). */
  z.object({ code: z.literal('reserve_already_released'), ...RowRef }),
  z.object({ code: z.literal('no_transactional_fees') }),
  z.object({ code: z.literal('reserve_cap_not_applied') }),
  z.object({ code: z.literal('transactional_fees_not_computed') }),
  z.object({ code: z.literal('chargeback_reserve_policy_not_applied') }),
  z.object({ code: z.literal('fee_variant_not_applied'), feeId: z.uuid() }),
])
export type SettlementWarning = z.infer<typeof SettlementWarning>

export const BatchDateRange = z.object({ min: z.iso.datetime(), max: z.iso.datetime() })
export type BatchDateRange = z.infer<typeof BatchDateRange>

const inOrder =
  <T>(key: (item: T) => string, order: readonly string[]) =>
  (items: T[]) =>
    items.length === order.length && items.every((item, i) => key(item) === order[i])

const SettlementFigures = z.object({
  /** Business dates (New York wall time; the Z is transport only, debt #48). */
  dateRanges: z.object({
    APP: BatchDateRange.nullable(),
    DEC: BatchDateRange.nullable(),
    I: BatchDateRange.nullable(),
    R: BatchDateRange.nullable(),
  }),
  /** Channel names of the movements, sorted. */
  channels: z.array(z.string()),
  movements: z.object({ E: nonNegativeInt, I: nonNegativeInt, R: nonNegativeInt }),
  /** Always the five categories, in this order. */
  totals: z.array(CategoryTotal).refine(
    inOrder((t: CategoryTotal) => t.category, SETTLEMENT_CATEGORIES),
    'the five categories in their order',
  ),
  brandTotals: z.array(BrandTotal),
  reservesReleasedQty: nonNegativeInt,
  mdrAmt: Money4,
  mdrRate: Rate6.nullable(),
  transactionalFeeAmt: Money4,
  /** In the order of the request. */
  batchFees: z.array(BatchFeeView),
  otherFeeAmt: Money4,
  reserveHeldAmt: Money4,
  reserveReleasedAmt: Money4,
  reserveEarlyReleasedAmt: Money4,
  amountPayable: Money4,
  /** Always the nine lines, in this order. */
  payableBreakdown: z.array(PayableLine).refine(
    inOrder((l: PayableLine) => l.code, PAYABLE_LINE_CODES),
    'the nine lines in their order',
  ),
  skipped: Skipped,
  warnings: z.array(SettlementWarning),
})

export const ChannelToAssign = z.object({
  channelId: z.number().int(),
  name: z.string(),
  assignment: z.enum(['unassigned', 'assigned_to_other_account']),
  /** Hidden outside the caller's scope, as in the channel notice of the analysis. */
  otherAccount: z.union([AccountRef, HiddenAccountRef]).nullable(),
})
export type ChannelToAssign = z.infer<typeof ChannelToAssign>

/** What processing would do, without writing anything (POST /imports/{id}/settlements/preview). */
export const SettlementPreview = SettlementFigures.extend({
  importId: z.uuid(),
  accountId: z.uuid(),
  runId: positiveInt,
  batchNo: positiveInt,
  attemptNo: positiveInt,
  /** false: the number has an active attempt in the account; processing would answer 409 batch_no_taken. */
  batchNoAvailable: z.boolean(),
  requiresChannelConfirmation: z.boolean(),
  channelsToAssign: z.array(ChannelToAssign),
})
export type SettlementPreview = z.infer<typeof SettlementPreview>

export const SettledStatus = z.enum(['pending_payment', 'settled', 'undone'])
export type SettledStatus = z.infer<typeof SettledStatus>

export const ChannelAssigned = z.object({
  channelId: z.number().int(),
  name: z.string(),
  assignment: z.enum(['new_primary', 'primary_moved_from']),
  /** Hidden outside the caller's scope, as in the channel notice of the analysis. */
  previousAccount: z.union([AccountRef, HiddenAccountRef]).nullable(),
})
export type ChannelAssigned = z.infer<typeof ChannelAssigned>

/** An attempt as written: the 201 of processing, GET /settlements/{id} and the 200 of pay, unpay and undo. */
export const SettlementView = SettlementFigures.extend({
  batchId: z.uuid(),
  importId: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  batchNo: positiveInt,
  attemptNo: positiveInt,
  status: BatchStatus,
  settledStatus: SettledStatus,
  approvedBy: UserRef,
  /** Audit instant (UTC). */
  processedAt: z.iso.datetime(),
  settlementDate: IsoDate.nullable(),
  /** Audit instant (UTC); null unless the attempt is paid (unpaying empties them, the audit keeps the previous ones). */
  paidAt: z.iso.datetime().nullable(),
  paidBy: UserRef.nullable(),
  /** Audit instant (UTC); null unless the attempt is undone. */
  undoneAt: z.iso.datetime().nullable(),
  undoneBy: UserRef.nullable(),
  undoReason: z.string().nullable(),
  channelsAssigned: z.array(ChannelAssigned),
  /** null when the attempt has no settlement.process audit (e.g. seeded history). */
  validationSummary: z
    .object({
      runId: positiveInt,
      persistent: nonNegativeInt,
      resolved: nonNegativeInt,
      blocking: nonNegativeInt,
      resolvedMissing: nonNegativeInt,
    })
    .nullable(),
  /** Served by #12. */
  exports: z.object({ summary: z.string(), transactions: z.string(), reserves: z.string() }),
})
export type SettlementView = z.infer<typeof SettlementView>

/** GET /accounts/{id}/batch-number/next: a proposal, not a reservation. */
export const NextBatchNumber = z.object({
  accountId: z.uuid(),
  batchNo: positiveInt,
  attemptNo: positiveInt,
  /** reprocess: the same number as the import's undone attempt, with the next attempt. */
  reason: z.enum(['next', 'reprocess']),
})
export type NextBatchNumber = z.infer<typeof NextBatchNumber>

export const NextBatchNumberQuery = z.object({ importId: z.uuid().optional() })
export type NextBatchNumberQuery = z.infer<typeof NextBatchNumberQuery>

/** Body of POST /settlements/{id}/unpay and /undo: the reason, without the spaces of its ends (NVARCHAR(500)). */
export const ReasonRequest = z.strictObject({ reason: z.string().trim().min(1).max(500) })
export type ReasonRequest = z.infer<typeof ReasonRequest>

// ───────────────────────── Error details ─────────────────────────

export const BatchFeeInvalidReason = z.enum([
  'unknown_fee_type',
  'transactional_fee_type',
  'fee_not_in_account',
  'fee_type_mismatch',
  'fee_not_in_force',
  'free_amount_not_allowed',
  'description_required',
])
export type BatchFeeInvalidReason = z.infer<typeof BatchFeeInvalidReason>

/** 400 batch_fee_invalid: the first batch fee of the request that fails, by its position. */
export const BatchFeeInvalidDetails = z.object({ index: nonNegativeInt, reason: BatchFeeInvalidReason })
export type BatchFeeInvalidDetails = z.infer<typeof BatchFeeInvalidDetails>

/** 409 batch_no_taken: the active attempt holding the number. */
export const BatchNoTakenDetails = z.object({ batchNo: positiveInt, attemptNo: positiveInt, importId: z.uuid() })
export type BatchNoTakenDetails = z.infer<typeof BatchNoTakenDetails>

/** 409 channel_assignment_not_confirmed. */
export const ChannelAssignmentNotConfirmedDetails = z.object({ channels: z.array(ChannelToAssign) })
export type ChannelAssignmentNotConfirmedDetails = z.infer<typeof ChannelAssignmentNotConfirmedDetails>

/** 409 import_not_validated. */
export const ImportNotValidatedDetails = z.object({ status: ImportStatus })
export type ImportNotValidatedDetails = z.infer<typeof ImportNotValidatedDetails>

/** 409 settlement_not_processed, settlement_not_paid and settlement_payment_not_removed: the status it has now. */
export const SettlementStateDetails = z.object({ status: BatchStatus })
export type SettlementStateDetails = z.infer<typeof SettlementStateDetails>

/** 409 settlement_not_current: a processed attempt that is not the current one of its import. */
export const SettlementNotCurrentDetails = z.object({ importStatus: ImportStatus, currentBatchId: z.uuid().nullable() })
export type SettlementNotCurrentDetails = z.infer<typeof SettlementNotCurrentDetails>
