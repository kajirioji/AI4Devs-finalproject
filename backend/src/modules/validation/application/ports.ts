/**
 * Read ports of the validation engine (design D3). #9 implements them with Prisma and feeds `runValidations` in two
 * steps: `computeRanges(rows)` says which candidates to load, then the full input is built and validated.
 */
import type {
  ImportStatus,
  InvalidationReason,
  IssueHistoryEntry,
  OccurrenceView,
  UserRef,
  ValidationCode,
  ValidationIssueSummary,
  ValidationIssuesQuery,
  ValidationOutcome,
} from '@recon/shared'
import type { Prisma } from '../../../generated/prisma/client.js'
import type { Scope } from '../../catalog/domain/scope.js'
import type {
  AccountScope,
  CandidateTransaction,
  CycleRanges,
  HeldReserve,
  HistoryMovement,
  StatusEntry,
  ValidationReport,
  ValidationRow,
} from '../domain/types.js'

/** ImportRow ⋈ ImportSheet ⋈ ImportFile ⋈ Transaction; fileOrder by uploadedAt, sheetOrder by workbook position. */
export interface ValidationRowSource {
  rowsOf(importId: string): Promise<ValidationRow[]>
}

/**
 * The account of the import with the channels it is primary for (AccountChannel.isPrimary = 1) and the
 * Channel.rollingReserveDays of every channel of its provider, inactive ones included (the expiry of a reserve: a
 * channel missing from the map is a programming error in the engine).
 */
export interface AccountScopeSource {
  accountOf(importId: string): Promise<AccountScope>
}

/** SettlementTransaction of attempts with status <> 'undone', of every account of the provider, not of this import. */
export interface SettlementHistorySource {
  hasPreviousBatches(providerId: number, excludeImportId: string): Promise<boolean>
  movements(providerId: number, transactionIds: readonly bigint[], excludeImportId: string): Promise<HistoryMovement[]>
}

/**
 * Candidates per range (APP Successful, DEC Declined, I natural-cycle-I statuses, plus Pending for the count), dated
 * up to each range's max (for I, `lastStatusChangedAt <= max OR lastStatusChangedAt IS NULL`: the engine counts the
 * undated ones in undatedCandidateCount, so the source must not drop them), and only those NOT processed in that
 * cycle in a non-undone attempt of the provider; held reserves without a current R movement whose expiry (creation
 * + rollingReserveDays of the channel) is up to `rMax`, the max of the R range, which is also by expiry.
 */
export interface MissingCandidateSource {
  candidates(account: AccountScope, ranges: CycleRanges): Promise<CandidateTransaction[]>
  heldReserves(account: AccountScope, rMax: Date): Promise<HeldReserve[]>
}

/** `${cycle}:${transactionId}` of persistent missing findings of imports with a processed or paid SettlementBatch. */
export interface RegisteredMissingSource {
  registered(providerId: number): Promise<Set<string>>
}

/** TransactionStatus with its natural cycle: the catalog the engine resolves status codes against. */
export interface StatusCatalogSource {
  statuses(): Promise<StatusEntry[]>
}

/** Every read the engine input needs (validation-runs D4 step 2). */
export type ValidationSources = ValidationRowSource &
  AccountScopeSource &
  SettlementHistorySource &
  MissingCandidateSource &
  RegisteredMissingSource &
  StatusCatalogSource

// ───────────────────────── Runs (validation-runs design D4–D8, D16) ─────────────────────────

/** The import as the validation flow needs it; `updatedAt` is the optimistic version of every write. */
export interface ImportRef {
  importId: string
  status: ImportStatus
  updatedAt: Date
}

export interface StoredResult {
  validationCode: ValidationCode
  outcome: ValidationOutcome
  issueCount: number
  /** missing_*: by range; non_recorded_adjustment: by issue type; otherwise null. */
  breakdown: Record<string, number> | null
}

export interface StoredRun {
  runId: number
  runAt: Date
  runBy: UserRef
  ranges: CycleRanges
  pendingInRangeCount: number
  undatedAdjustmentCount: number
  undatedCandidateCount: number
  /** In any order: the service sorts them by ValidationCode. */
  results: StoredResult[]
  /** Occurrences whose inclusion differs from the default plus findings resolved by hand (D16). */
  manualChangeCount: number
}

/** Milliseconds of each phase of the write of a run, for the log (bench of design D14). */
export interface WritePhases {
  /** Guarded UPDATE of the Import row. */
  claimMs: number
  /** Previous current run marked superseded. */
  supersedeMs: number
  /** The ValidationRun row. */
  runMs: number
  /** The eight ValidationResult rows. */
  resultsMs: number
  /** Findings without occurrences (missing, provider_mismatch, non_recorded_adjustment, status_mismatch). */
  plainIssuesMs: number
  /** Findings with occurrences (duplicate, collision) and their ConflictOccurrence rows. */
  occurrenceIssuesMs: number
  /** Invalidation of the review, when there was one. */
  auditMs: number
}

/** The review history of an import, from AuditLog, oldest first. */
export type ReviewEvent =
  | { kind: 'review'; runId: number; by: UserRef; at: Date }
  | {
      kind: 'invalidate'
      runId: number
      by: UserRef
      at: Date
      reviewedBy: UserRef
      reviewedAt: Date
      reason: InvalidationReason
      newRunId: number | null
      occurrenceId: string | null
    }

/**
 * Persistence of runs. Every write starts with a guarded UPDATE of the Import row (exclusive lock until commit) and
 * persists only if the import still has the version the caller read; otherwise ImportChangedError (D4).
 */
export interface ValidationRunRepository {
  /** null for an unknown import or one outside the scope (same answer). */
  findImport(scope: Scope, importId: string): Promise<ImportRef | null>
  /**
   * In one transaction: guard (analyzed or validated, same updatedAt; leaves it analyzed), invalidation of the review
   * when it was validated, previous current run superseded, run with its results, findings and occurrences.
   */
  saveRun(
    importId: string,
    expectedUpdatedAt: Date,
    userId: number,
    report: ValidationReport,
    now: Date,
  ): Promise<{ runId: number; previousStatus: ImportStatus; phases?: WritePhases }>
  currentRun(importId: string): Promise<StoredRun | null>
  reviewEvents(importId: string): Promise<ReviewEvent[]>
  /** Findings of the current run, filtered and paged in the fixed order of issue-order.ts (D8); empty without a run. */
  listIssues(
    importId: string,
    query: ValidationIssuesQuery,
  ): Promise<{ items: ValidationIssueSummary[]; total: number }>
  /** A finding of any run of an import inside the scope, with its occurrences and history; null otherwise. */
  findIssue(scope: Scope, issueId: number): Promise<StoredIssueDetail | null>
  /** The finding an occurrence belongs to, when its import is inside the scope. */
  findOccurrence(scope: Scope, occurrenceId: string): Promise<{ occurrenceId: string; issueId: number } | null>
  /**
   * In one transaction (D9): guard on Import (analyzed or validated, advances updatedAt), current run, current_import,
   * same value → nothing written, rule of cycle R, the change with its author, AuditLog, and back to analyzed with the
   * review invalidated when it was validated. Any refusal rolls the whole transaction back.
   */
  setInclusion(occurrenceId: string, includeInSettlement: boolean, userId: number, now: Date): Promise<void>
  /** One conditioned UPDATE (persistent, resolvable type, current run) plus its AuditLog row, in one transaction. */
  resolveIssue(issueId: number, note: string, userId: number, now: Date): Promise<void>
  /**
   * In one transaction (D7): guard on Import (analyzed), current run read under the lock (none → required; another →
   * superseded), no blocked result, `validated` and the AuditLog `import.review` with the counts.
   */
  review(importId: string, runId: number, userId: number, now: Date): Promise<void>
}

/** An occurrence as stored; the service adds what the caller may do with it. */
export type StoredOccurrence = Omit<OccurrenceView, 'editable' | 'includable'>

export interface StoredIssueDetail {
  summary: ValidationIssueSummary
  importId: string
  importStatus: ImportStatus
  isCurrent: boolean
  /** current_import first (first-occurrence order), then previous_batch (history order). */
  occurrences: StoredOccurrence[]
  /** Oldest first. */
  history: IssueHistoryEntry[]
}

/**
 * Called inside the transaction that processes or undoes a batch (README §3.2 Faltantes, HU2 CA9), with its
 * transactional client. Only the findings of current runs count (isSuperseded = 0), as in RegisteredMissingSource.
 * Implemented by PrismaMissingResolution (settlement-process D11).
 */
export interface MissingResolution {
  /** Persistent missing findings of the provider whose (transactionId, cycle) is in the batch → resolved with it. */
  resolveForBatch(tx: Prisma.TransactionClient, batchId: string, at: Date): Promise<number>
  /** Findings of current runs resolved by this batch → persistent again, resolvedInBatchId/resolvedAt cleared; their ids. */
  reopenForBatch(tx: Prisma.TransactionClient, batchId: string): Promise<number[]>
}
