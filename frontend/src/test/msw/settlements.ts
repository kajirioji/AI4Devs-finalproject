// In-memory stand-in for the settlement API of #11 and #12 (web-settlement design D15). It does NOT compute figures
// nor decide business rules: totals, the payable and its breakdown, skipped, warnings and the channels to assign are
// fixed by the fixture of each scenario, whatever fees the request sends. A preview only copies two fields of the
// body: `batchNo` and `batchFees` (field by field, with the title of the fee type and each amount written with four
// decimals, as the API returns it). Bodies are checked with the SettlementRequest schema of @recon/shared and the
// export query with ExportQuery (settlement-reads); downloads answer as #12: a CSV named by attempt in
// Content-Disposition, errors as JSON. The fake models what changes
// between requests: the batch numbers with an active attempt per account, the import validated → processed with its
// currentBatchId, the attempts it creates (read back by GET /settlements/{id}) and the scripted answers. The
// rejections follow from that state, not from business rules: import_not_validated from the status of the import,
// validation_run_superseded from the current run, batch_no_taken from the active numbers, and
// channel_assignment_not_confirmed when the fixture requires a confirmation the body does not carry. The attempts of
// an account and the movements of an attempt (settlements-browse D13) are fixtures in the order of the API: the fake
// only paginates them and records the query, never filtering by status or days nor sorting. Pay, unpay and undo
// (settlement-lifecycle) change the stored attempt, its row in the list and the settled flag of its movements; undo
// also takes the import back to analyzed and supersedes its run. The 409 of each follows from the stored status.
import {
  Cycle,
  ExportQuery,
  ReasonRequest,
  SettlementRequest as SettlementRequestSchema,
  TRANSACTION_STATUSES,
} from '@recon/shared'
import { HttpResponse, http, type PathParams } from 'msw'
import type {
  AccountFee,
  AccountSettlement,
  BatchFeeInput,
  BatchFeeView,
  ChannelToAssign,
  Cycle as CycleCode,
  FeeTypeView,
  ImportSettlementAttempt,
  ImportSettlements,
  NextBatchNumber,
  SettlementFigures,
  SettlementMovement,
  SettlementPreview,
  SettlementRequest,
  SettlementView,
  ValidationSummary,
} from '@/features/settlements/contract'
import { auditInstant, businessDate } from '@/lib/format'
import { ACCOUNT_IDS, ACCOUNTS, PROVIDERS, USERS, type UserName } from './fixtures'
import type { AccountName } from './import-fixtures'
import { type FakeImport, importRecord, visibleImport } from './imports'
import { currentRunId, supersedeRunOnUndo } from './validations'

const API = '*/api/v1'

// --- Fixtures -------------------------------------------------------------------------------------------------------

const statusId = (name: string) => TRANSACTION_STATUSES.find((s) => s.name === name)?.statusId ?? null

/** The fee types of the seed (backend/prisma/synthetic.ts): transactional 1–6 and non-transactional 101–121. */
export const FEE_TYPE_VIEWS: FeeTypeView[] = [
  [1, 'MDR', 'MDR', 'Successful'],
  [2, 'TRX Fee - Deposit', 'Deposit per txn fee', 'Successful'],
  [3, 'TRX Fee - Decline', 'Decline fee', 'Declined'],
  [4, 'Chargeback', 'Chargeback per txn fee', 'Chargeback'],
  [5, 'Refund', 'Refund per txn fee', 'Refund'],
  [6, 'RDR', 'RDR per txn fee', 'RDR'],
]
  .map(([feeTypeId, code, title, status]) => ({
    feeTypeId: feeTypeId as number,
    code: code as string,
    title: title as string,
    isTransactional: true,
    appliesToStatusId: statusId(status as string),
    allowsFreeAmount: false,
  }))
  .concat(
    (
      [
        ['Annual Fee', false],
        ['Bram Fine', true],
        ['Chargeback Assessment Fee', false],
        ['Chargeback Order Deduction', false],
        ['Chargeback over 1%', true],
        ['Chargeback over 2%', true],
        ['Chargeback over 3%', true],
        ['Chargeback Reversed', true],
        ['Cross Border Fee', false],
        ['Customer Service Fee', false],
        ['Monthly Fee', false],
        ['Rebate 2%', true],
        ['Rebate 3%', true],
        ['Release of Frozen Funds', true],
        ['Remittance Charges', false],
        ['Service Fee', false],
        ['Settlement Fee', false],
        ['Setup Fee', false],
        ['Special Adjustment', true],
        ['Special Deduction', true],
        ['Wire Fee', false],
      ] as const
    ).map(([code, free], i) => ({
      feeTypeId: 101 + i,
      code,
      title: code,
      isTransactional: false,
      appliesToStatusId: null,
      allowsFreeAmount: free,
    })),
  )

const feeType = (feeTypeId: number) => FEE_TYPE_VIEWS.find((t) => t.feeTypeId === feeTypeId)

const preset = (feeId: string, feeTypeId: number, fixedAmount: string | null, percentage: string | null) => ({
  feeId,
  feeTypeId,
  code: feeType(feeTypeId)!.code,
  title: feeType(feeTypeId)!.title,
  isTransactional: false,
  fixedAmount,
  percentage,
  startDate: null,
  endDate: null,
  description: null,
})

/** The non-transactional fees of each account in the seed (ACCOUNT_FEES of synthetic.ts). */
export const ACCOUNT_FEES: Record<AccountName, AccountFee[]> = {
  'ProviderA-USD': [preset('f0000000-0000-4000-8000-000000000105', 105, null, '0.010000')],
  'ProviderA-EUR': [preset('f0000000-0000-4000-8000-000000000205', 105, null, '0.010000')],
  'ProviderB-Main': [preset('f0000000-0000-4000-8000-000000000311', 111, '250.0000', null)],
  'ProviderC-USD': [],
  'ProviderC-Alt': [],
}

/** The proposed batch number of each account (`proposedBatchNo` of the samples' expected.json where there is one). */
const NEXT_BATCH_NO: Record<AccountName, number> = {
  'ProviderA-USD': 123,
  'ProviderA-EUR': 31,
  'ProviderB-Main': 52,
  'ProviderC-USD': 19,
  'ProviderC-Alt': 7,
}

/** What a preview answers for an import, besides the identifiers and the two fields copied from the body. */
export interface PreviewFixture extends Omit<SettlementFigures, 'batchFees'> {
  attemptNo: number
  requiresChannelConfirmation: boolean
  channelsToAssign: ChannelToAssign[]
  /** What the attempt reports once processed (without its runId, filled in from the body). */
  validationSummary: Omit<ValidationSummary, 'runId'> | null
}

const range = (min: string, max: string) => ({ min: businessDate(min), max: businessDate(max) })

const breakdown = (amounts: Record<SettlementFigures['payableBreakdown'][number]['code'], string>) =>
  (
    [
      ['deposit', 'Deposits', '+'],
      ['chargeback', 'Chargebacks', '-'],
      ['refund', 'Refunds', '-'],
      ['rdr', 'RDR', '-'],
      ['transactional_fees', 'Transaction fees', '-'],
      ['batch_fees', 'Batch fees', '-'],
      ['reserve_held', 'Reserve held', '-'],
      ['reserve_released', 'Reserve released', '+'],
      ['reserve_early_released', 'Reserve released on chargeback', '+'],
    ] as const
  ).map(([code, label, sign]) => ({ code, label, sign, amount: amounts[code] }))

const NOTHING_SKIPPED = { ignored: 0, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 }

/**
 * The preview of batch-clean: the illustrative figures of the "Contract for #13" example, consistent with each other
 * (the signed sum of the breakdown is amountPayable). The real figures come from the corrected expected.json of #11.
 */
export function batchCleanPreview(): PreviewFixture {
  return {
    attemptNo: 1,
    dateRanges: {
      APP: range('2026-09-28T00:04:11.000Z', '2026-10-07T23:58:40.000Z'),
      DEC: range('2026-09-28T00:10:02.000Z', '2026-10-07T23:41:19.000Z'),
      I: range('2026-09-28T03:00:00.000Z', '2026-10-11T21:12:00.000Z'),
      R: range('2026-09-27T05:00:00.000Z', '2026-10-06T22:00:00.000Z'),
    },
    channels: ['RAM-01', 'RAM-02', 'RAM-07'],
    movements: { E: 450, I: 10, R: 320 },
    totals: [
      { category: 'deposit', qty: 340, amount: '39181.0700', feeAmount: '4139.2500', feeRate: '0.100000' },
      { category: 'declined', qty: 110, amount: '0.0000', feeAmount: '27.5000', feeRate: null },
      { category: 'chargeback', qty: 2, amount: '193.8600', feeAmount: '90.0000', feeRate: null },
      { category: 'refund', qty: 6, amount: '843.9900', feeAmount: '30.0000', feeRate: null },
      { category: 'rdr', qty: 2, amount: '210.0000', feeAmount: '50.0000', feeRate: null },
    ],
    brandTotals: [
      { cardBrand: 'VISA', qty: 204, amount: '23508.6400' },
      { cardBrand: 'MASTERCARD', qty: 136, amount: '15672.4300' },
    ],
    reservesReleasedQty: 320,
    mdrAmt: '3918.1070',
    mdrRate: '0.100000',
    transactionalFeeAmt: '4336.7500',
    otherFeeAmt: '40.0000',
    reserveHeldAmt: '3918.1070',
    reserveReleasedAmt: '4314.5455',
    reserveEarlyReleasedAmt: '0.0000',
    amountPayable: '33952.9085',
    payableBreakdown: breakdown({
      deposit: '39181.0700',
      chargeback: '193.8600',
      refund: '843.9900',
      rdr: '210.0000',
      transactional_fees: '4336.7500',
      batch_fees: '40.0000',
      reserve_held: '3918.1070',
      reserve_released: '4314.5455',
      reserve_early_released: '0.0000',
    }),
    skipped: { ...NOTHING_SKIPPED, ignored: 3 },
    warnings: [],
    requiresChannelConfirmation: true,
    channelsToAssign: [{ channelId: 1007, name: 'RAM-07', assignment: 'unassigned', otherAccount: null }],
    validationSummary: { persistent: 0, resolved: 0, blocking: 0, resolvedMissing: 0 },
  }
}

/** A preview of ProviderB-Main (release_on_chargeback, `Monthly Fee` preset); figures illustrative and consistent. */
export function providerBPreview(): PreviewFixture {
  return {
    attemptNo: 1,
    dateRanges: {
      APP: range('2026-09-29T00:02:00.000Z', '2026-10-08T23:50:00.000Z'),
      DEC: range('2026-09-29T00:05:00.000Z', '2026-10-08T23:40:00.000Z'),
      I: range('2026-09-30T10:00:00.000Z', '2026-10-12T18:00:00.000Z'),
      R: range('2026-09-28T05:00:00.000Z', '2026-10-07T22:00:00.000Z'),
    },
    channels: ['RAM-11', 'RAM-12', 'RAM-13'],
    movements: { E: 460, I: 6, R: 280 },
    totals: [
      { category: 'deposit', qty: 360, amount: '41250.0000', feeAmount: '3918.7500', feeRate: '0.095000' },
      { category: 'declined', qty: 100, amount: '0.0000', feeAmount: '20.0000', feeRate: null },
      { category: 'chargeback', qty: 2, amount: '245.0000', feeAmount: '70.0000', feeRate: null },
      { category: 'refund', qty: 3, amount: '310.5000', feeAmount: '10.5000', feeRate: null },
      { category: 'rdr', qty: 1, amount: '99.0000', feeAmount: '25.0000', feeRate: null },
    ],
    brandTotals: [
      { cardBrand: 'VISA', qty: 220, amount: '25000.0000' },
      { cardBrand: 'MASTERCARD', qty: 140, amount: '16250.0000' },
    ],
    reservesReleasedQty: 280,
    mdrAmt: '3918.7500',
    mdrRate: '0.095000',
    transactionalFeeAmt: '4044.2500',
    otherFeeAmt: '25.0000',
    reserveHeldAmt: '4125.0000',
    reserveReleasedAmt: '3010.0000',
    reserveEarlyReleasedAmt: '0.0000',
    amountPayable: '35411.2500',
    payableBreakdown: breakdown({
      deposit: '41250.0000',
      chargeback: '245.0000',
      refund: '310.5000',
      rdr: '99.0000',
      transactional_fees: '4044.2500',
      batch_fees: '25.0000',
      reserve_held: '4125.0000',
      reserve_released: '3010.0000',
      reserve_early_released: '0.0000',
    }),
    skipped: { ...NOTHING_SKIPPED, ignored: 3, excluded: 1 },
    warnings: [{ code: 'chargeback_reserve_policy_not_applied' }],
    requiresChannelConfirmation: true,
    channelsToAssign: [{ channelId: 1013, name: 'RAM-13', assignment: 'unassigned', otherAccount: null }],
    validationSummary: { persistent: 13, resolved: 2, blocking: 0, resolvedMissing: 4 },
  }
}

// --- State ----------------------------------------------------------------------------------------------------------

export interface ScriptedError {
  status: number
  code: string
  message?: string
  details?: unknown
}

type PreviewStep = PreviewFixture | ScriptedError

const isError = (step: PreviewStep): step is ScriptedError => 'code' in step && 'status' in step

export type SettlementRoute =
  | 'next'
  | 'fees'
  | 'feeTypes'
  | 'preview'
  | 'process'
  | 'get'
  | 'export'
  | 'accountSettlements'
  | 'transactions'
  | 'pay'
  | 'unpay'
  | 'undo'
  | 'importSettlements'

export interface SettlementRequestLog {
  route: SettlementRoute
  method: string
  /** Path and query string. */
  url: string
  body: unknown
  /** Status of the answer; null while held, or for a network failure. */
  status: number | null
}

interface ActiveAttempt {
  accountId: string
  batchNo: number
  attemptNo: number
  importId: string
}

interface Hold {
  arrive: () => void
  released: Promise<void>
}

function freshState() {
  return {
    active: [] as ActiveAttempt[],
    attempts: new Map<string, SettlementView>(),
    /** The attempts of each account, newest first as the API orders them; the fake never reorders nor filters. */
    accountSettlements: new Map<string, AccountSettlement[]>(),
    /** The movements of each `batchId:cycle`, in the order of the API. */
    movements: new Map<string, SettlementMovement[]>(),
    /** What GET /imports/{id}/settlements answers for an import; otherwise, its attempts in the fake. */
    importSettlements: new Map<string, ImportSettlements>(),
    fixtures: new Map<string, PreviewFixture>(),
    nextNumbers: new Map<string, NextBatchNumber>(),
    scripts: new Map<string, PreviewStep[]>(),
    responses: new Map<SettlementRoute, ScriptedError[]>(),
    requests: [] as SettlementRequestLog[],
    holds: new Map<SettlementRoute, Hold[]>(),
    failures: new Map<SettlementRoute, number>(),
    exportDisposition: true,
    seq: 0,
    tick: 0,
  }
}

let state = freshState()

export function resetSettlements() {
  state = freshState()
}

function nextId(prefix: string): string {
  state.seq += 1
  return `${prefix}-0000-4000-8000-${String(state.seq).padStart(12, '0')}`
}

/** Audit instants of the fake: 2026-10-19 from 15:40:03 UTC (11:40 ET), one second apart. */
function now(): string {
  const at = new Date(Date.UTC(2026, 9, 19, 15, 40, 3 + state.tick, 120)).toISOString()
  state.tick += 1
  return at
}

const accountNameOf = (accountId: string) =>
  (Object.keys(ACCOUNT_IDS) as AccountName[]).find((name) => ACCOUNT_IDS[name] === accountId) ?? null

function canSeeAccount(user: UserName, accountId: string): boolean {
  const account = ACCOUNTS.find((a) => a.accountId === accountId)
  const merchantId = PROVIDERS.find((p) => p.providerId === account?.providerId)?.merchantId
  return USERS[user].merchants.some((m) => m.merchantId === merchantId)
}

const userRef = (user: UserName) => ({ userId: USERS[user].userId, userName: USERS[user].userName })

function fixtureOf(record: FakeImport): PreviewFixture {
  return (
    state.fixtures.get(record.importId) ??
    (record.accountId === ACCOUNT_IDS['ProviderB-Main'] ? providerBPreview() : batchCleanPreview())
  )
}

function proposedNumber(accountId: string): NextBatchNumber {
  const seeded = state.nextNumbers.get(accountId)
  if (seeded) return seeded
  return { accountId, batchNo: NEXT_BATCH_NO[accountNameOf(accountId)!], attemptNo: 1, reason: 'next' }
}

const activeAttempt = (accountId: string, batchNo: number) =>
  state.active.find((a) => a.accountId === accountId && a.batchNo === batchNo)

/** An amount of the body as the API returns a DECIMAL(19,4): the same digits with four decimals, as text only. */
function money4(amount: string): string {
  const [whole, decimals = ''] = amount.split('.')
  return `${whole}.${decimals.padEnd(4, '0')}`
}

/** The batch fees of the body as the API shows them: a copy field by field, with the title of the fee type. */
function feeViews(fees: BatchFeeInput[] | undefined, enteredBy: UserName | null): BatchFeeView[] {
  return (fees ?? []).map((fee) => {
    const type = feeType(fee.feeTypeId)
    if (enteredBy) state.seq += 1
    return {
      batchFeeId: enteredBy ? state.seq : null,
      feeTypeId: fee.feeTypeId,
      code: type?.code ?? String(fee.feeTypeId),
      title: type?.title ?? String(fee.feeTypeId),
      feeId: fee.feeId,
      amount: money4(fee.amount),
      description: fee.description ?? null,
      source: fee.source,
      enteredBy: enteredBy ? userRef(enteredBy) : null,
    }
  })
}

function figuresOf(fixture: PreviewFixture): Omit<SettlementFigures, 'batchFees'> {
  const {
    attemptNo: _a,
    requiresChannelConfirmation: _r,
    channelsToAssign: _c,
    validationSummary: _v,
    ...figures
  } = fixture
  return figures
}

/** Stores a processed attempt of the import, from its fixture, and moves the import to processed. */
function createAttempt(
  record: FakeImport,
  fixture: PreviewFixture,
  body: SettlementRequest,
  by: UserName,
  batchNo: number,
): SettlementView {
  const batchId = nextId('5c3f9e21')
  const view: SettlementView = {
    ...figuresOf(fixture),
    batchFees: feeViews(body.batchFees, by),
    batchId,
    importId: record.importId,
    accountId: record.accountId,
    accountName: accountNameOf(record.accountId)!,
    batchNo,
    attemptNo: fixture.attemptNo,
    status: 'processed',
    settledStatus: 'pending_payment',
    approvedBy: userRef(by),
    processedAt: auditInstant(now()),
    settlementDate: body.settlementDate ? businessDate(body.settlementDate) : null,
    paidAt: null,
    paidBy: null,
    undoneAt: null,
    undoneBy: null,
    undoReason: null,
    channelsAssigned: fixture.channelsToAssign.map((c) => ({
      channelId: c.channelId,
      name: c.name,
      assignment: c.assignment === 'unassigned' ? 'new_primary' : 'primary_moved_from',
      previousAccount: c.otherAccount,
    })),
    validationSummary: fixture.validationSummary && { runId: body.runId, ...fixture.validationSummary },
    exports: {
      summary: `/api/v1/settlements/${batchId}/export?type=summary`,
      transactions: `/api/v1/settlements/${batchId}/export?type=transactions`,
      reserves: `/api/v1/settlements/${batchId}/export?type=reserves`,
    },
  }
  state.attempts.set(batchId, view)
  // The newest attempt goes first in the list of its account, as GET /accounts/{id}/settlements orders it.
  state.accountSettlements.set(record.accountId, [
    {
      batchId,
      importId: record.importId,
      batchNo,
      attemptNo: view.attemptNo,
      status: view.status,
      settledStatus: view.settledStatus,
      settlementDate: view.settlementDate,
      processedAt: view.processedAt,
      approvedBy: view.approvedBy,
      amountPayable: view.amountPayable,
      channels: fixture.channels.join(','),
    },
    ...(state.accountSettlements.get(record.accountId) ?? []),
  ])
  state.active.push({ accountId: record.accountId, batchNo, attemptNo: view.attemptNo, importId: record.importId })
  record.status = 'processed'
  record.currentBatchId = batchId
  return view
}

// --- Test helpers -----------------------------------------------------------------------------------------------------

/** The preview fixture of an import (by default, the one of its account). */
export function seedSettlementPreview(importId: string, fixture: PreviewFixture) {
  state.fixtures.set(importId, fixture)
}

/** The answers of the next previews of an import, in order: a fixture or an error each. */
export function scriptPreview(importId: string, steps: PreviewStep[]) {
  state.scripts.set(importId, [...(state.scripts.get(importId) ?? []), ...steps])
}

/** What GET batch-number/next answers for an account (e.g. a reprocess after an undone attempt). */
export function seedNextBatchNumber(next: NextBatchNumber) {
  state.nextNumbers.set(next.accountId, next)
}

/** A batch number of the account with an active attempt of another import; returns that import's id. */
export function seedActiveBatch(accountId: string, batchNo: number, attemptNo = 1) {
  const importId = nextId('0a1b2c3d')
  state.active.push({ accountId, batchNo, attemptNo, importId })
  return { importId }
}

export interface SeedSettlementOptions {
  batchNo?: number
  settlementDate?: string
  batchFees?: BatchFeeInput[]
  by?: UserName
  /** Fields of the stored view a scenario needs different from the fixture. */
  overrides?: Partial<SettlementView>
}

/** Stores a processed attempt of an import directly, as if processed through the API, and returns its view. */
export function seedSettlement(importId: string, options: SeedSettlementOptions = {}): SettlementView {
  const record = importRecord(importId)
  const runId = currentRunId(importId) ?? 0
  const body: SettlementRequest = {
    runId,
    settlementDate: options.settlementDate ?? '2026-10-24',
    batchFees: options.batchFees ?? [],
  }
  const view = createAttempt(
    record,
    fixtureOf(record),
    body,
    options.by ?? 'analyst',
    options.batchNo ?? proposedNumber(record.accountId).batchNo,
  )
  const stored = { ...view, ...options.overrides }
  state.attempts.set(view.batchId, stored)
  return stored
}

/** An attempt of an account as the list shows it: by default batch 122 of ProviderA-USD, paid by analyst. */
export function accountSettlement(overrides: Partial<AccountSettlement> = {}): AccountSettlement {
  return {
    batchId: nextId('7d1c2b3a'),
    importId: nextId('0a1b2c3d'),
    batchNo: 122,
    attemptNo: 1,
    status: 'paid',
    settledStatus: 'settled',
    settlementDate: businessDate('2026-10-02'),
    processedAt: auditInstant('2026-09-30T15:40:03.120Z'),
    approvedBy: userRef('analyst'),
    amountPayable: '33771.3600',
    channels: 'RAM-01,RAM-02',
    ...overrides,
  }
}

/**
 * The seeded history of an account, newest first: `count` paid attempts ending at `lastBatchNo`, one a week, each
 * processed at 15:40 UTC and settled two days later. Amounts are illustrative text, never computed by a screen.
 */
export function paidHistory(_accountId: string, count: number, lastBatchNo = 122): AccountSettlement[] {
  return Array.from({ length: count }, (_, i) => {
    const batchNo = lastBatchNo - i
    const processed = new Date(Date.UTC(2026, 8, 30, 15, 40, 3, 120) - i * 7 * 86_400_000)
    const settled = new Date(processed.getTime() + 2 * 86_400_000)
    return accountSettlement({
      batchNo,
      processedAt: auditInstant(processed.toISOString()),
      settlementDate: businessDate(settled.toISOString().slice(0, 10)),
      amountPayable: `${30_000 + batchNo}.4500`,
    })
  })
}

/** The attempts GET /accounts/{id}/settlements serves for an account, already in the order of the API. */
export function seedAccountSettlements(accountId: string, items: AccountSettlement[]) {
  state.accountSettlements.set(accountId, items)
}

/** An attempt of an import as GET /imports/{id}/settlements shows it: by default, processed and current. */
export function importAttempt(overrides: Partial<ImportSettlementAttempt> = {}): ImportSettlementAttempt {
  return {
    batchId: nextId('7d1c2b3a'),
    batchNo: 118,
    attemptNo: 1,
    status: 'processed',
    settledStatus: 'pending_payment',
    processedAt: auditInstant('2026-10-19T15:40:03.120Z'),
    approvedBy: userRef('analyst'),
    amountPayable: '33771.3600',
    isCurrent: true,
    ...overrides,
  }
}

/** What GET /imports/{id}/settlements serves for an import, already in the order of the API. */
export function seedImportSettlements(importId: string, attempts: ImportSettlements) {
  state.importSettlements.set(importId, attempts)
}

/** A movement as the contract example for #13 shows it: an E deposit of batch-clean, not settled. */
export function settlementMovement(overrides: Partial<SettlementMovement> = {}): SettlementMovement {
  return {
    settlementTxnId: '88213',
    transactionId: '40711',
    sourceTransactionId: '911545593909470',
    gatewayId: 1,
    cycle: 'E',
    status: 'Successful',
    roundNo: null,
    sheetId: '2d4e6f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    sheetName: 'APP',
    rowNo: 2,
    amount: '115.2400',
    excludeAmount: false,
    feeAmount: '12.0240',
    eventDate: businessDate('2026-09-28T00:04:11.000Z'),
    appliedReservePct: '0.100000',
    reserveDaysUsed: 180,
    expectedReserveReleaseAt: businessDate('2027-03-27T00:04:11.000Z'),
    reserveHeldAmt: '11.5240',
    reserveReleasedAmt: '0.0000',
    reserveEarlyReleasedAmt: '0.0000',
    reservePolicySnapshot: null,
    settled: false,
    fees: [
      {
        appliedFeeId: '120334',
        feeId: 'f0000000-0000-4000-8000-000000000001',
        feeTypeId: 1,
        code: 'MDR',
        title: 'MDR',
        eventDate: businessDate('2026-09-28T00:04:11.000Z'),
        amountUsd: '11.5240',
        configurationSnapshot: null,
      },
      {
        appliedFeeId: '120335',
        feeId: 'f0000000-0000-4000-8000-000000000002',
        feeTypeId: 2,
        code: 'TRX Fee - Deposit',
        title: 'Deposit per txn fee',
        eventDate: businessDate('2026-09-28T00:04:11.000Z'),
        amountUsd: '0.5000',
        configurationSnapshot: null,
      },
    ],
    ...overrides,
  }
}

/** The movements GET /settlements/{id}/transactions serves for a cycle of an attempt, in the order of the API. */
export function seedMovements(batchId: string, cycle: CycleCode, items: SettlementMovement[]) {
  state.movements.set(`${batchId}:${cycle}`, items)
}

/** Stores an attempt as GET /settlements/{id} reads it, without an import (a seeded batch of the history). */
export function seedSettlementView(view: SettlementView) {
  state.attempts.set(view.batchId, view)
}

/** The export downloads answer without Content-Disposition, as when CORS does not expose it. */
export function omitExportDisposition() {
  state.exportDisposition = false
}

/** Requests the fake received, oldest first; optionally only those of one route. */
export function settlementRequests(route?: SettlementRoute): SettlementRequestLog[] {
  return route ? state.requests.filter((r) => r.route === route) : [...state.requests]
}

/** The next request to `route` waits until `release()`; `arrived` resolves when it reaches the fake. */
export function holdNextSettlement(route: SettlementRoute) {
  let arrive!: () => void
  let release!: () => void
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  state.holds.set(route, [...(state.holds.get(route) ?? []), { arrive, released }])
  return { arrived, release }
}

/** The next request to `route` fails as a network error, without changing anything. */
export function failNextSettlement(route: SettlementRoute) {
  state.failures.set(route, (state.failures.get(route) ?? 0) + 1)
}

/** The next request to `route` answers this error without changing anything. */
export function respondNextSettlement(route: SettlementRoute, error: ScriptedError) {
  state.responses.set(route, [...(state.responses.get(route) ?? []), error])
}

// --- HTTP ------------------------------------------------------------------------------------------------------------

const error = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ code, message, ...(details === undefined ? {} : { details }) }, { status })
const notFound = (entity: string) => error(404, 'not_found', `${entity} not found`)
const forbidden = () => error(403, 'forbidden', 'Forbidden')
const scripted = (e: ScriptedError) => error(e.status, e.code, e.message ?? e.code, e.details)

const canProcess = (user: UserName) => USERS[user].permissions.includes('settlement.process')

/** page from 1 and pageSize 50 by default, as the paginated reads of the API. */
function pagingOf(searchParams: URLSearchParams): { page: number; pageSize: number } {
  return { page: Number(searchParams.get('page') ?? 1), pageSize: Number(searchParams.get('pageSize') ?? 50) }
}

interface RouteArgs {
  request: Request
  params: PathParams
  user: UserName
  body: unknown
}

/** A route of the fake: logs the request and honours the holds, failures and scripted answers of the tests. */
function route(
  name: SettlementRoute,
  resolve: (args: RouteArgs) => Response | Promise<Response>,
  caller: (request: Request) => UserName | null,
) {
  return async ({ request, params }: { request: Request; params: PathParams }) => {
    const url = new URL(request.url)
    const body = request.headers.get('content-type')?.includes('json') ? await request.clone().json() : undefined
    const log: SettlementRequestLog = {
      route: name,
      method: request.method,
      url: url.pathname + url.search,
      body,
      status: null,
    }
    state.requests.push(log)
    const hold = state.holds.get(name)?.shift()
    if (hold) {
      hold.arrive()
      await hold.released
    }
    const user = caller(request)
    if (!user) {
      log.status = 401
      return error(401, 'unauthorized', 'Unauthorized')
    }
    const failures = state.failures.get(name) ?? 0
    if (failures > 0) {
      state.failures.set(name, failures - 1)
      return HttpResponse.error()
    }
    const response = state.responses.get(name)?.shift()
    const answer = response ? scripted(response) : await resolve({ request, params, user, body })
    log.status = answer.status
    return answer
  }
}

/** Writes the attempt and what shows it: its row in the list of the account and the settled flag of its movements. */
function storeAttempt(view: SettlementView): SettlementView {
  state.attempts.set(view.batchId, view)
  const rows = state.accountSettlements.get(view.accountId)
  if (rows) {
    state.accountSettlements.set(
      view.accountId,
      rows.map((row) =>
        row.batchId === view.batchId ? { ...row, status: view.status, settledStatus: view.settledStatus } : row,
      ),
    )
  }
  const settled = view.status === 'paid'
  for (const [key, movements] of state.movements) {
    if (key.startsWith(`${view.batchId}:`))
      state.movements.set(
        key,
        movements.map((m) => ({ ...m, settled })),
      )
  }
  return view
}

const stateError = (code: string, message: string, status: string) => error(409, code, message, { status })

/** Permission, then scope, as the API: the attempt of the action, or the answer. */
function admitAction(user: UserName, batchId: unknown, permission: string): SettlementView | Response {
  if (!USERS[user].permissions.includes(permission as never)) return forbidden()
  const view = state.attempts.get(String(batchId))
  if (!view || !canSeeAccount(user, view.accountId)) return notFound('Settlement')
  return view
}

function reasonOf(body: unknown): string | Response {
  const parsed = ReasonRequest.safeParse(body)
  if (parsed.success) return parsed.data.reason
  return error(400, 'validation_error', `reason: ${parsed.error.issues[0]!.message}`)
}

/** Shape of the strict body of preview and process, with the schema of the API: a 400 validation_error. */
function shapeError(body: unknown): Response | null {
  const parsed = SettlementRequestSchema.safeParse(body)
  if (parsed.success) return null
  const issue = parsed.error.issues[0]!
  return error(400, 'validation_error', `${issue.path.join('.') || 'body'}: ${issue.message}`)
}

/** The checks preview and process share, in the order of the API: permission, scope, body, status and run. */
function admit(user: UserName, importId: unknown, body: unknown): FakeImport | Response {
  if (!canProcess(user)) return forbidden()
  const record = visibleImport(user, importId)
  if (!record) return notFound('Import')
  const invalid = shapeError(body)
  if (invalid) return invalid
  if (record.status !== 'validated') {
    return error(
      409,
      'import_not_validated',
      `The import must be validated before processing (status: ${record.status})`,
      {
        status: record.status,
      },
    )
  }
  const current = currentRunId(record.importId)
  if (current === null) return error(409, 'validation_run_required', 'Run the validations before reviewing', {})
  const { runId } = body as SettlementRequest
  if (runId !== current) {
    return error(409, 'validation_run_superseded', 'A newer validation run exists; review it before continuing', {
      runId,
      currentRunId: current,
    })
  }
  return record
}

export function createSettlementHandlers(caller: (request: Request) => UserName | null) {
  return [
    http.get(
      `${API}/accounts/:accountId/batch-number/next`,
      route(
        'next',
        ({ request, params, user }) => {
          const accountId = String(params.accountId)
          if (!accountNameOf(accountId) || !canSeeAccount(user, accountId)) return notFound('Account')
          const importId = new URL(request.url).searchParams.get('importId')
          if (importId !== null) {
            const record = visibleImport(user, importId)
            if (!record || record.accountId !== accountId) return notFound('Account')
          }
          return HttpResponse.json(proposedNumber(accountId))
        },
        caller,
      ),
    ),

    http.get(
      `${API}/accounts/:accountId/fees`,
      route(
        'fees',
        ({ request, params, user }) => {
          if (!USERS[user].permissions.includes('fee.view')) return forbidden()
          const accountId = String(params.accountId)
          const name = accountNameOf(accountId)
          if (!name || !canSeeAccount(user, accountId)) return notFound('Account')
          const transactional = new URL(request.url).searchParams.get('transactional')
          return HttpResponse.json(transactional === 'true' ? [] : ACCOUNT_FEES[name])
        },
        caller,
      ),
    ),

    http.get(
      `${API}/fee-types`,
      route('feeTypes', () => HttpResponse.json(FEE_TYPE_VIEWS), caller),
    ),

    http.post(
      `${API}/imports/:importId/settlements/preview`,
      route(
        'preview',
        ({ params, user, body }) => {
          const admitted = admit(user, params.importId, body)
          if (admitted instanceof Response) return admitted
          const record = admitted
          const step = state.scripts.get(record.importId)?.shift()
          if (step && isError(step)) return scripted(step)
          const fixture = step ?? fixtureOf(record)
          const request = body as SettlementRequest
          const batchNo = request.batchNo ?? proposedNumber(record.accountId).batchNo
          const preview: SettlementPreview = {
            ...figuresOf(fixture),
            batchFees: feeViews(request.batchFees, null),
            importId: record.importId,
            accountId: record.accountId,
            runId: request.runId,
            batchNo,
            attemptNo: fixture.attemptNo,
            batchNoAvailable: !activeAttempt(record.accountId, batchNo),
            requiresChannelConfirmation: fixture.requiresChannelConfirmation,
            channelsToAssign: fixture.channelsToAssign,
          }
          return HttpResponse.json(preview)
        },
        caller,
      ),
    ),

    http.post(
      `${API}/imports/:importId/settlements`,
      route(
        'process',
        ({ params, user, body }) => {
          const admitted = admit(user, params.importId, body)
          if (admitted instanceof Response) return admitted
          const record = admitted
          const request = body as SettlementRequest
          const fixture = fixtureOf(record)
          const batchNo = request.batchNo ?? proposedNumber(record.accountId).batchNo
          const taken = activeAttempt(record.accountId, batchNo)
          if (taken) {
            return error(409, 'batch_no_taken', `Batch ${batchNo} already has an active attempt for this account`, {
              batchNo,
              attemptNo: taken.attemptNo,
              importId: taken.importId,
            })
          }
          if (fixture.requiresChannelConfirmation && request.confirmChannelAssignment !== true) {
            return error(
              409,
              'channel_assignment_not_confirmed',
              'The import includes channels not assigned to this account; confirm the assignment',
              { channels: fixture.channelsToAssign },
            )
          }
          return HttpResponse.json(createAttempt(record, fixture, request, user, batchNo), { status: 201 })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/imports/:importId/settlements`,
      route(
        'importSettlements',
        ({ params, user }) => {
          const importId = String(params.importId)
          const seeded = state.importSettlements.get(importId)
          if (seeded) return HttpResponse.json(seeded)
          const record = visibleImport(user, importId)
          if (!record) return notFound('Import')
          const items = [...state.attempts.values()]
            .filter((view) => view.importId === importId)
            .map((view) =>
              importAttempt({
                batchId: view.batchId,
                batchNo: view.batchNo,
                attemptNo: view.attemptNo,
                status: view.status,
                settledStatus: view.settledStatus,
                processedAt: view.processedAt,
                approvedBy: view.approvedBy,
                amountPayable: view.amountPayable,
                isCurrent: record.currentBatchId === view.batchId,
              }),
            )
            .reverse()
          return HttpResponse.json({ importId, currentBatchId: record.currentBatchId, items })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/settlements/:batchId`,
      route(
        'get',
        ({ params, user }) => {
          const view = state.attempts.get(String(params.batchId))
          if (!view || !canSeeAccount(user, view.accountId)) return notFound('Settlement')
          return HttpResponse.json(view)
        },
        caller,
      ),
    ),

    http.post(
      `${API}/settlements/:batchId/pay`,
      route(
        'pay',
        ({ params, user }) => {
          const view = admitAction(user, params.batchId, 'payment.process')
          if (view instanceof Response) return view
          if (view.status !== 'processed') {
            return stateError('settlement_not_processed', 'This batch is not processed', view.status)
          }
          return HttpResponse.json(
            storeAttempt({
              ...view,
              status: 'paid',
              settledStatus: 'settled',
              paidAt: auditInstant(now()),
              paidBy: userRef(user),
            }),
          )
        },
        caller,
      ),
    ),

    http.post(
      `${API}/settlements/:batchId/unpay`,
      route(
        'unpay',
        ({ params, user, body }) => {
          const view = admitAction(user, params.batchId, 'payment.process')
          if (view instanceof Response) return view
          const reason = reasonOf(body)
          if (reason instanceof Response) return reason
          if (view.status !== 'paid') return stateError('settlement_not_paid', 'This batch is not paid', view.status)
          return HttpResponse.json(
            storeAttempt({
              ...view,
              status: 'processed',
              settledStatus: 'pending_payment',
              paidAt: null,
              paidBy: null,
            }),
          )
        },
        caller,
      ),
    ),

    http.post(
      `${API}/settlements/:batchId/undo`,
      route(
        'undo',
        ({ params, user, body }) => {
          const view = admitAction(user, params.batchId, 'settlement.process')
          if (view instanceof Response) return view
          const reason = reasonOf(body)
          if (reason instanceof Response) return reason
          if (view.status === 'paid') {
            return stateError('settlement_payment_not_removed', 'Remove the payment first', view.status)
          }
          if (view.status !== 'processed') {
            return stateError('settlement_not_processed', 'This batch is not processed', view.status)
          }
          const record = visibleImport(user, view.importId)
          if (record) {
            record.status = 'analyzed'
            record.currentBatchId = null
            supersedeRunOnUndo(record.importId, user)
          }
          state.active = state.active.filter((a) => a.importId !== view.importId)
          return HttpResponse.json(
            storeAttempt({
              ...view,
              status: 'undone',
              settledStatus: 'undone',
              undoneAt: auditInstant(now()),
              undoneBy: userRef(user),
              undoReason: reason,
            }),
          )
        },
        caller,
      ),
    ),

    http.get(
      `${API}/accounts/:accountId/settlements`,
      route(
        'accountSettlements',
        ({ request, params, user }) => {
          const accountId = String(params.accountId)
          if (!accountNameOf(accountId) || !canSeeAccount(user, accountId)) return notFound('Account')
          // Only the paging is read: status, dateField, from and to are recorded in the log, never applied.
          const { page, pageSize } = pagingOf(new URL(request.url).searchParams)
          const all = state.accountSettlements.get(accountId) ?? []
          return HttpResponse.json({
            accountId,
            page,
            pageSize,
            total: all.length,
            items: all.slice((page - 1) * pageSize, page * pageSize),
          })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/settlements/:batchId/transactions`,
      route(
        'transactions',
        ({ request, params, user }) => {
          const batchId = String(params.batchId)
          const view = state.attempts.get(batchId)
          if (!view || !canSeeAccount(user, view.accountId)) return notFound('Settlement')
          const searchParams = new URL(request.url).searchParams
          const type = Cycle.safeParse(searchParams.get('type'))
          if (!type.success) return error(400, 'validation_error', 'type: Invalid option')
          const { page, pageSize } = pagingOf(searchParams)
          const all = state.movements.get(`${batchId}:${type.data}`) ?? []
          return HttpResponse.json({
            batchId,
            type: type.data,
            page,
            pageSize,
            total: all.length,
            items: all.slice((page - 1) * pageSize, page * pageSize),
          })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/settlements/:batchId/export`,
      route(
        'export',
        ({ request, params, user }) => {
          if (!USERS[user].permissions.includes('reports.view')) return forbidden()
          const view = state.attempts.get(String(params.batchId))
          if (!view || !canSeeAccount(user, view.accountId)) return notFound('Settlement')
          const query = ExportQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams))
          if (!query.success) return error(400, 'validation_error', 'Invalid export type')
          const { type } = query.data
          const headers: Record<string, string> = { 'content-type': 'text/csv; charset=utf-8' }
          if (state.exportDisposition) {
            headers['content-disposition'] =
              `attachment; filename="${view.accountName}_B${view.batchNo}_A${view.attemptNo}_${type}.csv"`
          }
          return new HttpResponse(`ID,Status\n"441706751475644",SUC\n`, { status: 200, headers })
        },
        caller,
      ),
    ),
  ]
}
