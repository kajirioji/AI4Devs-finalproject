// Vocabulary of the validation engine (README §1.2 "Resultado de una validación", §3.2 "Validaciones e incidencias").
// ValidationCode and BLOCKING_VALIDATIONS stay in vocabulary.ts.
import { z } from 'zod'
import { UserRef } from './auth.js'
import { Cycle, ImportStatus, TransactionStatusCode, ValidationCode } from './vocabulary.js'

/** Outcome of one validation, derived from its findings. There is no `failed`. */
export const ValidationOutcome = z.enum(['passed', 'warning', 'blocked', 'not_applicable', 'not_implemented'])
export type ValidationOutcome = z.infer<typeof ValidationOutcome>

/** `status_mismatch` lives inside the non_recorded_adjustment validation (E row contradicting the gateway). */
export const IssueType = z.enum([
  'provider_mismatch',
  'non_recorded_adjustment',
  'status_mismatch',
  'duplicate',
  'collision',
  'missing',
])
export type IssueType = z.infer<typeof IssueType>

export const IssueScope = z.enum(['in_batch', 'across_batches', 'previous_to_batch', 'in_range'])
export type IssueScope = z.infer<typeof IssueScope>

export const OccurrenceSource = z.enum(['current_import', 'previous_batch'])
export type OccurrenceSource = z.infer<typeof OccurrenceSource>

export const MissingType = z.enum(['previous_to_batch', 'in_range'])
export type MissingType = z.infer<typeof MissingType>

/** Range a missing finding belongs to: E splits into APP and DEC. */
export const MissingRange = z.enum(['APP', 'DEC', 'I', 'R'])
export type MissingRange = z.infer<typeof MissingRange>

/** Counts as approved: `passed` and `warning`. `not_applicable` and `not_implemented` never do. */
export function isApproved(outcome: ValidationOutcome): boolean {
  return outcome === 'passed' || outcome === 'warning'
}

// ───────────────────────── Runs, findings, occurrences and review (validation-runs, README §4.4) ─────────────────────────

/** BIGINT ids travel as decimal strings, never as JSON numbers (README §4). */
const BigIntId = z.string().regex(/^\d+$/)
const nonNegativeInt = z.number().int().nonnegative()

export const ResolutionStatus = z.enum(['persistent', 'resolved'])
export type ResolutionStatus = z.infer<typeof ResolutionStatus>

export const InvalidationReason = z.enum(['rerun', 'inclusion_change', 'settlement_undone'])
export type InvalidationReason = z.infer<typeof InvalidationReason>

export const StatusRef = z.object({
  statusId: z.number().int(),
  code: TransactionStatusCode,
  name: z.string(),
})
export type StatusRef = z.infer<typeof StatusRef>

/** Inclusive range of ISO datetimes. */
export const DateRangeView = z.object({ min: z.iso.datetime(), max: z.iso.datetime() })
export type DateRangeView = z.infer<typeof DateRangeView>

export const ValidationResultView = z.object({
  validationCode: ValidationCode,
  outcome: ValidationOutcome,
  issueCount: nonNegativeInt,
  /** outcome === 'blocked' */
  blocking: z.boolean(),
  /** outcome is passed or warning */
  approved: z.boolean(),
  /** missing_*: { APP, DEC, I, R }; non_recorded_adjustment: { non_recorded_adjustment, status_mismatch }; else null. */
  breakdown: z.record(z.string(), nonNegativeInt).nullable(),
})
export type ValidationResultView = z.infer<typeof ValidationResultView>

export const RunReview = z.object({ reviewedBy: UserRef, reviewedAt: z.iso.datetime() })
export type RunReview = z.infer<typeof RunReview>

export const ValidationRunSummary = z.object({
  runId: z.number().int().positive(),
  runAt: z.iso.datetime(),
  runBy: UserRef,
  blocked: z.boolean(),
  ranges: z.object({
    APP: DateRangeView.nullable(),
    DEC: DateRangeView.nullable(),
    I: DateRangeView.nullable(),
    R: DateRangeView.nullable(),
  }),
  pendingInRangeCount: nonNegativeInt,
  undatedAdjustmentCount: nonNegativeInt,
  undatedCandidateCount: nonNegativeInt,
  /** Always eight, in the fixed order of ValidationCode. */
  results: z.array(ValidationResultView).length(ValidationCode.options.length),
  /** Occurrences whose inclusion differs from the default plus findings resolved by hand; lost on re-run (P6). */
  manualChangeCount: nonNegativeInt,
  /** The review of this run while it is valid. */
  review: RunReview.nullable(),
})
export type ValidationRunSummary = z.infer<typeof ValidationRunSummary>

export const InvalidatedReview = z.object({
  /** The run that had been reviewed. */
  runId: z.number().int().positive(),
  reviewedBy: UserRef,
  reviewedAt: z.iso.datetime(),
  invalidatedBy: UserRef,
  invalidatedAt: z.iso.datetime(),
  reason: InvalidationReason,
  /** rerun: the run that superseded it. */
  newRunId: z.number().int().positive().nullable(),
  /** inclusion_change: the occurrence changed. */
  occurrenceId: BigIntId.nullable(),
})
export type InvalidatedReview = z.infer<typeof InvalidatedReview>

/** Response of `GET`/`POST /imports/{id}/validations` and `POST /imports/{id}/review`. */
export const ValidationRunView = z.object({
  importId: z.uuid(),
  importStatus: ImportStatus,
  /** null when the import has no current run. */
  run: ValidationRunSummary.nullable(),
  /** Most recent invalidated review of the import, of any run (design D16). */
  lastInvalidatedReview: InvalidatedReview.nullable(),
})
export type ValidationRunView = z.infer<typeof ValidationRunView>

export const RowLocation = z.object({
  fileId: z.uuid(),
  fileName: z.string(),
  sheetId: z.uuid(),
  sheetName: z.string(),
  rowNo: z.number().int().positive(),
})
export type RowLocation = z.infer<typeof RowLocation>

export const ValidationIssueSummary = z.object({
  issueId: z.number().int().positive(),
  runId: z.number().int().positive(),
  validationCode: ValidationCode,
  issueType: IssueType,
  scope: IssueScope.nullable(),
  blocking: z.boolean(),
  transactionIdRaw: z.string().nullable(),
  transactionId: BigIntId.nullable(),
  cycle: Cycle.nullable(),
  missingType: MissingType.nullable(),
  missingRange: MissingRange.nullable(),
  relevantDate: z.iso.datetime().nullable(),
  /** Reported status, or the expected one for a missing finding. */
  status: StatusRef.nullable(),
  /** Only non_recorded_adjustment / status_mismatch. */
  gatewayStatus: StatusRef.nullable(),
  /** One-row findings: provider_mismatch, non_recorded_adjustment, status_mismatch. */
  source: RowLocation.nullable(),
  resolutionStatus: ResolutionStatus,
  resolvedAt: z.iso.datetime().nullable(),
  resolvedBy: UserRef.nullable(),
  resolutionNote: z.string().nullable(),
  occurrenceCount: nonNegativeInt,
  includedByDefaultCount: nonNegativeInt,
  includedCount: nonNegativeInt,
})
export type ValidationIssueSummary = z.infer<typeof ValidationIssueSummary>

export const OccurrenceBatch = z.object({
  batchId: z.uuid(),
  batchNo: z.number().int(),
  attemptNo: z.number().int(),
  status: z.enum(['processed', 'paid', 'undone']),
  accountId: z.uuid(),
  accountName: z.string(),
})
export type OccurrenceBatch = z.infer<typeof OccurrenceBatch>

export const OccurrenceView = z.object({
  occurrenceId: BigIntId,
  sourceType: OccurrenceSource,
  /** null for a historical movement without a row. */
  location: RowLocation.nullable(),
  batch: OccurrenceBatch.nullable(),
  /** null: the row status could not be resolved. */
  status: StatusRef.nullable(),
  /** CHB 2 */
  excludeAmount: z.boolean(),
  defaultIncluded: z.boolean(),
  includeInSettlement: z.boolean(),
  /** Last change. */
  changedBy: UserRef.nullable(),
  changedAt: z.iso.datetime().nullable(),
  /** Can be changed now (excluding is always possible when editable). */
  editable: z.boolean(),
  /** Editable and not blocked by the rule of cycle R. */
  includable: z.boolean(),
})
export type OccurrenceView = z.infer<typeof OccurrenceView>

export const IssueHistoryEntry = z.object({
  at: z.iso.datetime(),
  user: UserRef,
  action: z.enum(['set_inclusion', 'resolve']),
  occurrenceId: BigIntId.nullable(),
  from: z.boolean().nullable(),
  to: z.boolean().nullable(),
  note: z.string().nullable(),
})
export type IssueHistoryEntry = z.infer<typeof IssueHistoryEntry>

export const ValidationIssueDetail = ValidationIssueSummary.extend({
  importId: z.uuid(),
  importStatus: ImportStatus,
  run: z.object({ runId: z.number().int().positive(), isCurrent: z.boolean() }),
  resolvable: z.boolean(),
  /** current_import first (first-occurrence order), then previous_batch (history order). */
  occurrences: z.array(OccurrenceView),
  /** Oldest first. */
  history: z.array(IssueHistoryEntry),
})
export type ValidationIssueDetail = z.infer<typeof ValidationIssueDetail>

/** Query of `GET /imports/{id}/validation-issues`. */
export const ValidationIssuesQuery = z.object({
  type: IssueType.optional(),
  scope: IssueScope.optional(),
  status: ResolutionStatus.optional(),
  validationCode: ValidationCode.optional(),
  cycle: Cycle.optional(),
  /** Capped: 10 000 pages of 500 are 5 000 000 findings, far beyond any run; a larger value is a malformed request. */
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
})
export type ValidationIssuesQuery = z.infer<typeof ValidationIssuesQuery>

export const ValidationIssuesPage = z.object({
  items: z.array(ValidationIssueSummary),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: nonNegativeInt,
})
export type ValidationIssuesPage = z.infer<typeof ValidationIssuesPage>

/** Body of `PATCH /conflict-occurrences/{id}`. */
export const SetInclusionBody = z.strictObject({ includeInSettlement: z.boolean() })
export type SetInclusionBody = z.infer<typeof SetInclusionBody>

/** Body of `PATCH /validation-issues/{id}`: only non_recorded_adjustment and status_mismatch are resolved by hand. */
export const ResolveIssueBody = z.strictObject({
  resolutionStatus: z.literal('resolved'),
  note: z.string().trim().min(1).max(500),
})
export type ResolveIssueBody = z.infer<typeof ResolveIssueBody>

/** Body of `POST /imports/{id}/review`: the decision is about the run the analyst saw. */
export const ReviewBody = z.strictObject({ runId: z.number().int().positive() })
export type ReviewBody = z.infer<typeof ReviewBody>
