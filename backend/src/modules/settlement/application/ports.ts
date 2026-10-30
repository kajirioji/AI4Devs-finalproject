// Ports of the settlement module (settlement-process design D1, D2, D5): what the calculation reads, and how processing
// writes it. The Prisma adapters take either the client or the transactional client, so the same reads serve the
// preview (outside a transaction) and processing (inside it, after the guard).
import type { ImportStatus, SettlementRequest, SettlementView, ValidationCode } from '@recon/shared'
import type { Scope } from '../../catalog/domain/scope.js'
import type {
  AccountAttempt,
  AccountFeeConfig,
  BusinessRange,
  RowInclusion,
  SettlementAccount,
  SettlementChannel,
  SettlementFeeType,
  SettlementRow,
} from '../domain/types.js'

export interface ImportContext {
  importId: string
  status: ImportStatus
  account: SettlementAccount
}

export interface CurrentRun {
  runId: number
  ranges: { APP: BusinessRange | null; DEC: BusinessRange | null; I: BusinessRange | null; R: BusinessRange | null }
  /** The blocking findings of the run (only provider_mismatch blocks); null when it is not blocked. */
  blocked: { validationCodes: ValidationCode[]; issueIds: number[] } | null
}

export interface SettlementSource {
  /**
   * The import with its account, when it is inside the scope; null otherwise (404 identical for both). A null scope
   * reads it without one: processing, inside its transaction, after the service checked the scope.
   */
  importContext(scope: Scope | null, importId: string): Promise<ImportContext | null>
  /** The account when it is inside the scope; null otherwise. */
  account(scope: Scope, accountId: string): Promise<SettlementAccount | null>
  /** The current (not superseded) validation run of the import. */
  currentRun(importId: string): Promise<CurrentRun | null>
  /** Every ImportRow of the import with its sheet, file order and matched transaction. */
  rows(importId: string): Promise<SettlementRow[]>
  /** The current_import occurrences of a run, by row. */
  inclusions(runId: number): Promise<RowInclusion[]>
  /** The given channels with their reserve term and their situation for the account. */
  channels(accountId: string, channelIds: readonly number[]): Promise<SettlementChannel[]>
  /** Of the given transactions, those with an E movement in a non-undone attempt of the provider, the import excluded. */
  previousE(providerId: number, transactionIds: readonly bigint[], excludeImportId: string): Promise<Set<bigint>>
  accountFees(accountId: string): Promise<AccountFeeConfig[]>
  feeTypes(): Promise<SettlementFeeType[]>
  /** Every attempt of the account, in any status. */
  attempts(accountId: string): Promise<AccountAttempt[]>
}

/** feeTypeIds of the batch fees pre-filled from the Other Fees sheet, as GET /imports/{id} proposes them. */
export interface PrefilledBatchFees {
  feeTypeIdsOf(scope: Scope, importId: string): Promise<Set<number>>
}

export interface ProcessCommand {
  importId: string
  userId: number
  request: SettlementRequest
  prefilledFeeTypeIds: ReadonlySet<number>
  /** Audit instant (processedAt, assignedAt, resolvedAt). */
  now: Date
  /** The caller's scope: other accounts outside it are hidden in the answer (channel-notice.ts). */
  scope?: Scope
}

/** Processing in one transaction (design D5–D7); answers the id of the attempt it wrote. */
export interface SettlementRepository {
  process(command: ProcessCommand): Promise<{ batchId: string }>
}

export interface LifecycleCommand {
  batchId: string
  userId: number
  /** Audit instant (paidAt, undoneAt and the AuditLog row). */
  now: Date
}

export interface ReasonCommand extends LifecycleCommand {
  reason: string
}

/** The actions on an attempt, each in one transaction with its guard (settlement-lifecycle design D3, D4). */
export interface SettlementLifecycleRepository {
  pay(command: LifecycleCommand): Promise<void>
  unpay(command: ReasonCommand): Promise<void>
}

/** The view of an attempt read back from what was written (design D19). */
export interface SettlementReader {
  /** With a scope, the previous accounts of the assigned channels outside it are hidden. */
  view(batchId: string, scope?: Scope): Promise<SettlementView | null>
}
