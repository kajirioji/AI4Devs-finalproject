// In-memory stand-in for the validations API of #9 (web-validations design D12). It does NOT compute business rules:
// results, `blocked`, `blocking`, `editable`, `includable` and `resolvable` are fixed by the fixture of each
// scenario, and a PATCH answers what the scenario scripts for it. The fake only models what changes between
// requests: the import analyzed ↔ validated, the run superseded on a re-run, manualChangeCount, the invalidated
// review and the history (who and when of every applied change). The rejections it answers follow from that state,
// not from business rules: import_not_analyzed and import_not_editable from the status of the import,
// validation_run_superseded for a run that is no longer the current one, validation_run_required without one.
// Typed with the generated contract of #9; its own test checks every answer with the shared schemas of @recon/shared.
import { TRANSACTION_STATUSES, type TransactionStatusCode, type ValidationCode } from '@recon/shared'
import { HttpResponse, http, type PathParams } from 'msw'
import type {
  DateRange,
  InvalidatedReview,
  IssueHistoryEntry,
  OccurrenceView,
  RowLocation,
  RunReview,
  StatusRef,
  ValidationIssueDetail,
  ValidationIssueSummary,
  ValidationResultView,
  ValidationRun,
  ValidationRunView,
} from '@/features/validations/contract'
import { auditInstant, businessDate } from '@/lib/format'
import { ACCOUNT_IDS, USERS, type UserName } from './fixtures'
import { type FakeImport, importRecord, visibleImport } from './imports'

const API = '*/api/v1'

// --- Fixtures -------------------------------------------------------------------------------------------------------

/** Where a row of the import is: a sheet of its first file and the row number. */
export interface RowAt {
  sheetName: string
  rowNo: number
}

/** An occurrence as the scenario declares it; ids and the location in the import are filled in when seeding. */
export interface FixtureOccurrence
  extends Omit<OccurrenceView, 'occurrenceId' | 'location' | 'changedBy' | 'changedAt'> {
  /** Row of the current import; for a previous batch, `location` is given whole (or null). */
  at?: RowAt
  location?: RowLocation | null
}

/** A finding as the scenario declares it, flags included. */
export interface FixtureIssue
  extends Omit<
    ValidationIssueDetail,
    | 'issueId'
    | 'runId'
    | 'importId'
    | 'importStatus'
    | 'run'
    | 'source'
    | 'occurrences'
    | 'history'
    | 'occurrenceCount'
    | 'includedByDefaultCount'
    | 'includedCount'
  > {
  source: RowAt | null
  occurrences: FixtureOccurrence[]
}

/** An error answer of the API, as a scenario scripts it. */
export interface ScriptedError {
  status: number
  code: string
  message?: string
  details?: unknown
}

/** The scripted answer of a PATCH: an error, or the next state after applying the asked change. */
export type PatchScript = { error: ScriptedError } | { next: (detail: ValidationIssueDetail) => ValidationIssueDetail }

export interface RunFixture {
  results: ValidationResultView[]
  blocked: boolean
  ranges: ValidationRun['ranges']
  pendingInRangeCount: number
  undatedAdjustmentCount: number
  undatedCandidateCount: number
  issues: FixtureIssue[]
  /** Scripts by `issueKey` (resolve) or `occurrenceKey` (inclusion). */
  patches?: Record<string, PatchScript>
}

/** Stable key of a finding of a fixture, the same in every run. */
export const issueKey = (validationCode: ValidationCode, transactionIdRaw: string) =>
  `${validationCode}:${transactionIdRaw}`
/** Stable key of an occurrence: its finding and its position in the API order. */
export const occurrenceKey = (key: string, index: number) => `${key}#${index}`

const status = (code: TransactionStatusCode): StatusRef => {
  const s = TRANSACTION_STATUSES.find((t) => t.code === code)!
  return { statusId: s.statusId, code: s.code, name: s.name }
}

const range = (min: string, max: string): DateRange => ({ min: businessDate(min), max: businessDate(max) })

function result(
  validationCode: ValidationCode,
  outcome: ValidationResultView['outcome'],
  issueCount: number,
  breakdown: Record<string, number> | null = null,
): ValidationResultView {
  return {
    validationCode,
    outcome,
    issueCount,
    blocking: outcome === 'blocked',
    approved: outcome === 'passed' || outcome === 'warning',
    breakdown,
  }
}

const finding = (
  overrides: Partial<FixtureIssue> & Pick<FixtureIssue, 'validationCode' | 'issueType'>,
): FixtureIssue => ({
  scope: null,
  blocking: false,
  transactionIdRaw: null,
  transactionId: null,
  cycle: null,
  missingType: null,
  missingRange: null,
  relevantDate: null,
  status: null,
  gatewayStatus: null,
  source: null,
  resolutionStatus: 'persistent',
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  resolvable: false,
  occurrences: [],
  ...overrides,
})

/** An occurrence in a sheet of the current import, editable as #9 would answer it in analyzed. */
const current = (
  sheetName: string,
  rowNo: number,
  code: TransactionStatusCode | null,
  defaultIncluded: boolean,
  overrides: Partial<FixtureOccurrence> = {},
): FixtureOccurrence => ({
  sourceType: 'current_import',
  at: { sheetName, rowNo },
  batch: null,
  status: code ? status(code) : null,
  excludeAmount: false,
  defaultIncluded,
  includeInSettlement: defaultIncluded,
  editable: true,
  includable: true,
  ...overrides,
})

/** An occurrence of a batch already processed: evidence, never editable. */
const previous = (code: TransactionStatusCode, rowNo: number): FixtureOccurrence => ({
  sourceType: 'previous_batch',
  location: {
    fileId: 'f0000000-0000-4000-8000-000000000907',
    fileName: 'Recon_Template_ProviderB-Main_batch-07.xlsx',
    sheetId: '5e000000-0000-4000-8000-000000000907',
    sheetName: code === 'Declined' ? 'DEC' : 'APP',
    rowNo,
  },
  batch: {
    batchId: 'b0000000-0000-4000-8000-000000000007',
    batchNo: 7,
    attemptNo: 1,
    status: 'paid',
    accountId: ACCOUNT_IDS['ProviderB-Main'],
    accountName: 'ProviderB-Main',
  },
  status: status(code),
  excludeAmount: false,
  defaultIncluded: true,
  includeInSettlement: true,
  editable: false,
  includable: false,
})

/** A missing finding; cycle I takes the status of its transaction (Chargeback unless told). */
export const missing = (
  validationCode: 'missing_previous_to_batch' | 'missing_in_range',
  missingRange: 'APP' | 'DEC' | 'I' | 'R',
  transactionIdRaw: string,
  relevantDate: string,
  statusCode: TransactionStatusCode = 'Chargeback',
): FixtureIssue =>
  finding({
    validationCode,
    issueType: 'missing',
    scope: validationCode === 'missing_in_range' ? 'in_range' : 'previous_to_batch',
    transactionIdRaw,
    transactionId: transactionIdRaw,
    cycle: missingRange === 'R' ? 'R' : missingRange === 'I' ? 'I' : 'E',
    missingType: validationCode === 'missing_in_range' ? 'in_range' : 'previous_to_batch',
    missingRange,
    relevantDate: businessDate(relevantDate),
    status:
      missingRange === 'R'
        ? null
        : status(missingRange === 'I' ? statusCode : missingRange === 'DEC' ? 'Declined' : 'Successful'),
  })

// data/samples/batch-issues/expected.json: validations, affectedIds and defaults.
const MISSING_DEC = [
  '292185165085382',
  '769777669120974',
  '272334406018044',
  '441792335833448',
  '508242204037850',
  '781644342693693',
  '381282680688092',
  '719068411427320',
  '644101363117982',
  '818633165525879',
]
const MISSING_APP = ['251891807220713', '539230812967430', '517395598166932']
const MISSING_R = ['357030499063804', '961596230548826', '544489255846527']

/** The run of batch-issues: warnings only, 23 findings. */
export function batchIssuesFixture(): RunFixture {
  return {
    results: [
      result('provider_mismatch', 'passed', 0),
      result('non_recorded_adjustment', 'warning', 3, { non_recorded_adjustment: 1, status_mismatch: 2 }),
      result('duplicate_in_batch', 'warning', 1),
      result('status_collision_in_batch', 'warning', 1),
      result('duplicate_across_batches', 'warning', 1),
      result('status_collision_across_batches', 'warning', 1),
      result('missing_previous_to_batch', 'warning', 10, { APP: 0, DEC: 10, I: 0, R: 0 }),
      result('missing_in_range', 'warning', 6, { APP: 3, DEC: 0, I: 0, R: 3 }),
    ],
    blocked: false,
    ranges: {
      APP: range('2026-09-28T00:00:00.000Z', '2026-10-07T23:59:59.000Z'),
      DEC: range('2026-09-29T00:00:00.000Z', '2026-10-07T23:59:59.000Z'),
      I: range('2026-09-28T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      R: range('2026-03-31T00:00:00.000Z', '2026-04-09T00:00:00.000Z'),
    },
    pendingInRangeCount: 0,
    undatedAdjustmentCount: 1,
    undatedCandidateCount: 0,
    issues: [
      finding({
        validationCode: 'non_recorded_adjustment',
        issueType: 'non_recorded_adjustment',
        transactionIdRaw: '281520820250015',
        transactionId: '281520820250015',
        cycle: 'I',
        status: status('Chargeback'),
        gatewayStatus: status('Successful'),
        source: { sheetName: 'CHB', rowNo: 8 },
        resolvable: true,
        // A one-row finding carries its row in `source` and no occurrences, as the real API of #9 answers it.
        occurrences: [],
      }),
      finding({
        validationCode: 'non_recorded_adjustment',
        issueType: 'status_mismatch',
        transactionIdRaw: '911545593909470',
        transactionId: '911545593909470',
        cycle: 'E',
        status: status('Declined'),
        gatewayStatus: status('Successful'),
        source: { sheetName: 'DEC', rowNo: 7 },
        resolvable: true,
        occurrences: [],
      }),
      finding({
        validationCode: 'non_recorded_adjustment',
        issueType: 'status_mismatch',
        transactionIdRaw: '381797111970492',
        transactionId: '381797111970492',
        cycle: 'E',
        // The real run: the file reports it Declined and the gateway has it Successful.
        status: status('Declined'),
        gatewayStatus: status('Successful'),
        source: { sheetName: 'DEC', rowNo: 102 },
        resolvable: true,
        occurrences: [],
      }),
      finding({
        validationCode: 'duplicate_in_batch',
        issueType: 'duplicate',
        scope: 'in_batch',
        transactionIdRaw: '441706751475644',
        transactionId: '441706751475644',
        cycle: 'E',
        status: status('Successful'),
        // Rows of the sample file, as the real run locates them.
        occurrences: [current('APP', 12, 'Successful', true), current('APP', 338, 'Successful', false)],
      }),
      finding({
        validationCode: 'status_collision_in_batch',
        issueType: 'collision',
        scope: 'in_batch',
        transactionIdRaw: '911545593909470',
        transactionId: '911545593909470',
        cycle: 'E',
        occurrences: [current('APP', 40, 'Successful', true), current('DEC', 7, 'Declined', true)],
      }),
      finding({
        validationCode: 'duplicate_across_batches',
        issueType: 'duplicate',
        scope: 'across_batches',
        transactionIdRaw: '504712738863260',
        transactionId: '504712738863260',
        cycle: 'E',
        status: status('Successful'),
        occurrences: [current('APP', 120, 'Successful', false), previous('Successful', 88)],
      }),
      finding({
        validationCode: 'status_collision_across_batches',
        issueType: 'collision',
        scope: 'across_batches',
        transactionIdRaw: '381797111970492',
        transactionId: '381797111970492',
        cycle: 'E',
        occurrences: [current('APP', 61, 'Successful', true), previous('Declined', 42)],
      }),
      ...MISSING_DEC.map((id, i) =>
        missing('missing_previous_to_batch', 'DEC', id, `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`),
      ),
      ...MISSING_APP.map((id, i) => missing('missing_in_range', 'APP', id, `2026-10-0${2 + i}T09:30:00.000Z`)),
      ...MISSING_R.map((id, i) => missing('missing_in_range', 'R', id, `2026-04-0${3 + i}T00:00:00.000Z`)),
    ],
  }
}

/** Missing in range of batch-blocked, as the real run of #9 lists them (expected.json does not fix them). */
const BLOCKED_MISSING_APP = [
  '681733288658054',
  '437131642280874',
  '608590069700970',
  '467338065380748',
  '119634989767054',
  '911545593909470',
  '154743288120730',
  '253245504724402',
  '628469974874366',
  '709096109031044',
]

/**
 * The run of batch-blocked: one provider_mismatch. Its expected.json fixes only that count; the other seven results
 * are those of the real run of #9 against the seed (proposal, gap 5): ten missing in range of APP, the rest passed.
 */
export function batchBlockedFixture(): RunFixture {
  return {
    results: [
      result('provider_mismatch', 'blocked', 1),
      result('non_recorded_adjustment', 'passed', 0, { non_recorded_adjustment: 0, status_mismatch: 0 }),
      result('duplicate_in_batch', 'passed', 0),
      result('status_collision_in_batch', 'passed', 0),
      result('duplicate_across_batches', 'passed', 0),
      result('status_collision_across_batches', 'passed', 0),
      result('missing_previous_to_batch', 'passed', 0, { APP: 0, DEC: 0, I: 0, R: 0 }),
      result('missing_in_range', 'warning', 10, { APP: 10, DEC: 0, I: 0, R: 0 }),
    ],
    blocked: true,
    ranges: { APP: range('2026-09-28T00:00:00.000Z', '2026-10-07T23:59:59.000Z'), DEC: null, I: null, R: null },
    pendingInRangeCount: 0,
    undatedAdjustmentCount: 0,
    undatedCandidateCount: 0,
    issues: [
      finding({
        validationCode: 'provider_mismatch',
        issueType: 'provider_mismatch',
        blocking: true,
        transactionIdRaw: '252570479111759',
        transactionId: '252570479111759',
        cycle: 'E',
        status: status('Successful'),
        source: { sheetName: 'APP', rowNo: 22 },
        occurrences: [],
      }),
      ...BLOCKED_MISSING_APP.map((id, i) =>
        missing('missing_in_range', 'APP', id, `2026-09-28T${String(1 + i).padStart(2, '0')}:00:00.000Z`),
      ),
    ],
  }
}

/** A run without findings, for imports of other samples. */
function cleanFixture(): RunFixture {
  const issues = batchIssuesFixture()
  return {
    ...issues,
    results: issues.results.map((r) => ({ ...r, outcome: 'passed', issueCount: 0, approved: true })),
    undatedAdjustmentCount: 0,
    issues: [],
  }
}

export const RESERVE_KEY = issueKey('duplicate_in_batch', '357030499063804')

/**
 * batch-issues plus a duplicate reserve (R) with one occurrence included and the other arriving editable but not
 * includable, whose PATCH is scripted as the 409 of the R rule.
 */
export function reserveVariant(): RunFixture {
  const base = batchIssuesFixture()
  return {
    ...base,
    results: base.results.map((r) => (r.validationCode === 'duplicate_in_batch' ? { ...r, issueCount: 2 } : r)),
    issues: [
      ...base.issues,
      finding({
        validationCode: 'duplicate_in_batch',
        issueType: 'duplicate',
        scope: 'in_batch',
        transactionIdRaw: '357030499063804',
        transactionId: '357030499063804',
        cycle: 'R',
        occurrences: [current('RR', 10, null, true), current('RR', 11, null, false, { includable: false })],
      }),
    ],
    patches: {
      [occurrenceKey(RESERVE_KEY, 1)]: {
        error: {
          status: 409,
          code: 'occurrence_not_includable',
          message: 'A reserve is released only once: exclude the included occurrence first',
          details: { reason: 'reserve_already_included' },
        },
      },
    },
  }
}

function defaultFixture(record: FakeImport): RunFixture {
  const labels = record.files.map((f) => f.label)
  if (labels.includes('batch-issues')) return batchIssuesFixture()
  if (labels.includes('batch-blocked')) return batchBlockedFixture()
  return cleanFixture()
}

// --- State ----------------------------------------------------------------------------------------------------------

interface StoredIssue {
  key: string
  /** Everything but the fields read from the import and the run. */
  detail: Omit<ValidationIssueDetail, 'importStatus' | 'run'>
}

interface StoredRun {
  runId: number
  importId: string
  isCurrent: boolean
  fixture: RunFixture
  runAt: string
  runBy: UserName
  review: RunReview | null
  /** Manual changes the scenario declares on top of the applied ones. */
  seededChanges: number
  issues: StoredIssue[]
}

export type ValidationRoute = 'get' | 'run' | 'list' | 'issue' | 'resolve' | 'inclusion' | 'review'

export interface ValidationRequest {
  route: ValidationRoute
  method: string
  /** Path and query string. */
  url: string
  body: unknown
  /** Status of the answer; null while held, or for a network failure. */
  status: number | null
}

interface Hold {
  arrive: () => void
  released: Promise<void>
}

function freshState() {
  return {
    runs: [] as StoredRun[],
    /** The fixture each import's next run is built from, when a test chose one. */
    fixtures: new Map<string, RunFixture>(),
    invalidated: new Map<string, InvalidatedReview>(),
    requests: [] as ValidationRequest[],
    holds: new Map<ValidationRoute, Hold[]>(),
    failures: new Map<ValidationRoute, number>(),
    responses: new Map<ValidationRoute, { error: ScriptedError }[]>(),
    runSeq: 10,
    tick: 0,
  }
}

let state = freshState()

export function resetValidations() {
  state = freshState()
}

/** Audit instants of the fake: 2026-10-18 from 14:00 UTC (10:00 ET), one second apart. */
function now(): string {
  state.tick += 1
  return new Date(Date.UTC(2026, 9, 18, 14, 0, state.tick)).toISOString()
}

const userRef = (user: UserName) => ({ userId: USERS[user].userId, userName: USERS[user].userName })

function locate(record: FakeImport, at: RowAt): RowLocation {
  for (const file of record.files) {
    const sheet = file.sheets.find((s) => s.template.sheetName === at.sheetName)
    if (sheet) {
      return {
        fileId: file.fileId,
        fileName: file.fileName,
        sheetId: sheet.sheetId,
        sheetName: at.sheetName,
        rowNo: at.rowNo,
      }
    }
  }
  throw new Error(`no sheet ${at.sheetName} in the fake import ${record.importId}`)
}

function counts(occurrences: OccurrenceView[]) {
  return {
    occurrenceCount: occurrences.length,
    includedByDefaultCount: occurrences.filter((o) => o.defaultIncluded).length,
    includedCount: occurrences.filter((o) => o.includeInSettlement).length,
  }
}

function instantiate(record: FakeImport, fixture: RunFixture, runId: number): StoredIssue[] {
  return fixture.issues.map((issue, i) => {
    const issueId = runId * 1000 + i + 1
    const occurrences: OccurrenceView[] = issue.occurrences.map(({ at, location, ...o }, j) => ({
      ...o,
      occurrenceId: String(runId * 100_000 + (i + 1) * 100 + j + 1),
      location: at ? locate(record, at) : (location ?? null),
      changedBy: null,
      changedAt: null,
    }))
    const { source, occurrences: _, ...rest } = issue
    return {
      key: issueKey(issue.validationCode, issue.transactionIdRaw ?? `#${i}`),
      detail: {
        ...rest,
        issueId,
        runId,
        importId: record.importId,
        source: source ? locate(record, source) : null,
        occurrences,
        history: [],
        ...counts(occurrences),
      },
    }
  })
}

function createRun(record: FakeImport, fixture: RunFixture, runBy: UserName, seededChanges = 0): StoredRun {
  for (const run of state.runs) if (run.importId === record.importId) run.isCurrent = false
  state.runSeq += 1
  const runId = state.runSeq
  const run: StoredRun = {
    runId,
    importId: record.importId,
    isCurrent: true,
    fixture,
    runAt: now(),
    runBy,
    review: null,
    seededChanges,
    issues: instantiate(record, fixture, runId),
  }
  state.runs.push(run)
  return run
}

const currentRun = (importId: string) => state.runs.find((r) => r.importId === importId && r.isCurrent) ?? null

/** The id of the current run of an import, or null; the fake settlement API checks the runId of a body against it. */
export const currentRunId = (importId: string) => currentRun(importId)?.runId ?? null

/** Occurrences changed from their default and findings resolved by hand, as #9 counts them. */
function manualChangeCount(run: StoredRun): number {
  const issues = run.issues.map((i) => i.detail)
  return (
    run.seededChanges +
    issues.flatMap((i) => i.occurrences).filter((o) => o.includeInSettlement !== o.defaultIncluded).length +
    issues.filter((i) => i.history.some((h) => h.action === 'resolve')).length
  )
}

function viewOf(record: FakeImport): ValidationRunView {
  const run = currentRun(record.importId)
  return {
    importId: record.importId,
    importStatus: record.status,
    run: run && {
      runId: run.runId,
      runAt: auditInstant(run.runAt),
      runBy: userRef(run.runBy),
      blocked: run.fixture.blocked,
      ranges: run.fixture.ranges,
      pendingInRangeCount: run.fixture.pendingInRangeCount,
      undatedAdjustmentCount: run.fixture.undatedAdjustmentCount,
      undatedCandidateCount: run.fixture.undatedCandidateCount,
      results: run.fixture.results,
      manualChangeCount: manualChangeCount(run),
      review: run.review,
    },
    lastInvalidatedReview: state.invalidated.get(record.importId) ?? null,
  }
}

function detailOf(run: StoredRun, issue: StoredIssue): ValidationIssueDetail {
  const record = importRecord(run.importId)
  const detail: ValidationIssueDetail = {
    ...issue.detail,
    importStatus: record.status,
    run: { runId: run.runId, isCurrent: run.isCurrent },
  }
  if (run.isCurrent) return detail
  // A finding of a superseded run is history: #9 answers it with every control off.
  return {
    ...detail,
    resolvable: false,
    occurrences: detail.occurrences.map((o) => ({ ...o, editable: false, includable: false })),
  }
}

/**
 * The answer of an applied PATCH. A `next` script is the next state of the finding as the scenario declares it: it
 * is stored, so the following reads answer the same, as the API would.
 */
function afterScript(run: StoredRun, issue: StoredIssue, script: PatchScript | undefined): ValidationIssueDetail {
  const answer = detailOf(run, issue)
  if (!script || !('next' in script)) return answer
  const { importStatus: _s, run: _r, ...next } = script.next(answer)
  Object.assign(issue.detail, next)
  return detailOf(run, issue)
}

function summaryOf(issue: StoredIssue): ValidationIssueSummary {
  const { importId: _i, resolvable: _r, occurrences: _o, history: _h, ...summary } = issue.detail
  return summary
}

/** A finding or occurrence of any run, with its run. */
function findIssue(issueId: number) {
  for (const run of state.runs) {
    const issue = run.issues.find((i) => i.detail.issueId === issueId)
    if (issue) return { run, issue }
  }
  return null
}

function findOccurrence(occurrenceId: string) {
  for (const run of state.runs) {
    for (const issue of run.issues) {
      const index = issue.detail.occurrences.findIndex((o) => o.occurrenceId === occurrenceId)
      if (index !== -1) return { run, issue, index }
    }
  }
  return null
}

/**
 * Undoing the attempt of the import (settlement-lifecycle D6): its run is superseded without a replacement, and a review
 * it had is invalidated. Called by the settlement fake, which moves the import itself.
 */
export function supersedeRunOnUndo(importId: string, by: UserName) {
  const run = currentRun(importId)
  if (!run) return
  run.isCurrent = false
  if (!run.review) return
  state.invalidated.set(importId, {
    runId: run.runId,
    reviewedBy: run.review.reviewedBy,
    reviewedAt: run.review.reviewedAt,
    invalidatedBy: userRef(by),
    invalidatedAt: auditInstant(now()),
    reason: 'settlement_undone',
    newRunId: null,
    occurrenceId: null,
  })
  run.review = null
}

/** The review of the import is no longer valid: it goes back to analyzed and the invalidation is kept. */
function invalidate(
  record: FakeImport,
  run: StoredRun,
  by: UserName,
  reason: InvalidatedReview['reason'],
  extra: Pick<InvalidatedReview, 'newRunId' | 'occurrenceId'>,
) {
  if (record.status !== 'validated' || !run.review) return
  state.invalidated.set(record.importId, {
    runId: run.runId,
    reviewedBy: run.review.reviewedBy,
    reviewedAt: run.review.reviewedAt,
    invalidatedBy: userRef(by),
    invalidatedAt: auditInstant(now()),
    reason,
    ...extra,
  })
  run.review = null
  record.status = 'analyzed'
}

// --- Test helpers -----------------------------------------------------------------------------------------------------

export interface SeedRunOptions {
  /** Scripts added to (or replacing) those of the fixture. */
  patches?: Record<string, PatchScript>
  /** Manual changes the run already has (inclusions and resolutions not shown by the fixture). */
  manualChangeCount?: number
  runBy?: UserName
  /** Seeds the review of the run, by this user; the import should be seeded as validated. */
  reviewedBy?: UserName
  /** When the review was made (an ISO instant); by default, the next tick of the fake's clock. */
  reviewedAt?: string
  /** When the run was made (an ISO instant); by default, the next tick of the fake's clock. */
  runAt?: string
}

/**
 * Stores a current run of an import directly, from a fixture (by default, the one of its sample), as if run through
 * the API. Later runs of the import are built from the same fixture.
 */
export function seedValidationRun(importId: string, fixture?: RunFixture, options: SeedRunOptions = {}) {
  const record = importRecord(importId)
  const chosen = { ...(fixture ?? defaultFixture(record)) }
  chosen.patches = { ...chosen.patches, ...options.patches }
  state.fixtures.set(importId, chosen)
  const run = createRun(record, chosen, options.runBy ?? 'analyst', options.manualChangeCount)
  if (options.runAt) run.runAt = options.runAt
  if (options.reviewedBy) {
    run.review = { reviewedBy: userRef(options.reviewedBy), reviewedAt: auditInstant(options.reviewedAt ?? now()) }
  }
  return { runId: run.runId, issues: run.issues.map((i) => detailOf(run, i)) }
}

/** Stores the last invalidated review of an import, as the API would answer it. */
export function seedInvalidatedReview(importId: string, review: InvalidatedReview) {
  state.invalidated.set(importId, review)
}

/** Requests the fake received, oldest first; optionally only those of one route. */
export function validationRequests(route?: ValidationRoute): ValidationRequest[] {
  return route ? state.requests.filter((r) => r.route === route) : [...state.requests]
}

/** The next request to `route` waits until `release()`; `arrived` resolves when it reaches the fake. */
export function holdNextValidation(route: ValidationRoute) {
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
export function failNextValidation(route: ValidationRoute) {
  state.failures.set(route, (state.failures.get(route) ?? 0) + 1)
}

/** The next request to `route` answers this error without changing anything (e.g. 409 import_changed). */
export function respondNext(route: ValidationRoute, error: ScriptedError) {
  state.responses.set(route, [...(state.responses.get(route) ?? []), { error }])
}

// --- HTTP ------------------------------------------------------------------------------------------------------------

const error = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ code, message, ...(details === undefined ? {} : { details }) }, { status })
const notFound = (entity: string) => error(404, 'not_found', `${entity} not found`)
const forbidden = () => error(403, 'forbidden', 'Forbidden')
const scripted = ({ error: e }: { error: ScriptedError }) => error(e.status, e.code, e.message ?? e.code, e.details)
const superseded = (run: StoredRun) =>
  error(409, 'validation_run_superseded', 'A newer validation run exists; review it before continuing', {
    runId: run.runId,
    currentRunId: currentRun(run.importId)?.runId ?? null,
  })

const canProcess = (user: UserName) => USERS[user].permissions.includes('settlement.process')
/** occurrenceId is a SQL Server BIGINT: a longer value is a malformed id, as #9 answers it. */
const MAX_BIGINT = 9_223_372_036_854_775_807n
const RUNNABLE = ['analyzed', 'validated']

interface RouteArgs {
  request: Request
  params: PathParams
  user: UserName
  log: ValidationRequest
}

/** A route of the fake: logs the request and honours the holds, failures and scripted answers of the tests. */
function route(
  name: ValidationRoute,
  resolve: (args: RouteArgs) => Response | Promise<Response>,
  caller: (request: Request) => UserName | null,
) {
  return async ({ request, params }: { request: Request; params: PathParams }) => {
    const url = new URL(request.url)
    const body = request.headers.get('content-type')?.includes('json') ? await request.clone().json() : undefined
    const log: ValidationRequest = {
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
    const answer = response ? scripted(response) : await resolve({ request, params, user, log })
    log.status = answer.status
    return answer
  }
}

const parseId = (value: unknown) => (/^\d{1,10}$/.test(String(value)) ? Number(value) : null)

export function createValidationHandlers(caller: (request: Request) => UserName | null) {
  return [
    http.get(
      `${API}/imports/:importId/validations`,
      route(
        'get',
        ({ params, user }) => {
          const record = visibleImport(user, params.importId)
          return record ? HttpResponse.json(viewOf(record)) : notFound('Import')
        },
        caller,
      ),
    ),

    http.post(
      `${API}/imports/:importId/validations`,
      route(
        'run',
        ({ params, user }) => {
          const record = visibleImport(user, params.importId)
          if (!canProcess(user)) return record ? forbidden() : notFound('Import')
          if (!record) return notFound('Import')
          if (!RUNNABLE.includes(record.status)) {
            return error(409, 'import_not_analyzed', 'The import is not analyzed', { status: record.status })
          }
          const previousRun = currentRun(record.importId)
          const fixture = state.fixtures.get(record.importId) ?? defaultFixture(record)
          const run = createRun(record, fixture, user)
          if (previousRun) invalidate(record, previousRun, user, 'rerun', { newRunId: run.runId, occurrenceId: null })
          return HttpResponse.json(viewOf(record), { status: 201 })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/imports/:importId/validation-issues`,
      route(
        'list',
        ({ request, params, user }) => {
          const record = visibleImport(user, params.importId)
          if (!record) return notFound('Import')
          const query = new URL(request.url).searchParams
          const page = Number(query.get('page') ?? '1')
          const pageSize = Number(query.get('pageSize') ?? '50')
          if (
            !Number.isInteger(page) ||
            page < 1 ||
            page > 10_000 ||
            !Number.isInteger(pageSize) ||
            pageSize < 1 ||
            pageSize > 500
          ) {
            return error(400, 'validation_error', 'Invalid query')
          }
          const filters: [string, keyof ValidationIssueSummary][] = [
            ['type', 'issueType'],
            ['scope', 'scope'],
            ['status', 'resolutionStatus'],
            ['validationCode', 'validationCode'],
            ['cycle', 'cycle'],
          ]
          const all = (currentRun(record.importId)?.issues ?? [])
            .map(summaryOf)
            .filter((s) => filters.every(([param, field]) => !query.has(param) || s[field] === query.get(param)))
          return HttpResponse.json({
            items: all.slice((page - 1) * pageSize, page * pageSize),
            page,
            pageSize,
            total: all.length,
          })
        },
        caller,
      ),
    ),

    http.get(
      `${API}/validation-issues/:issueId`,
      route(
        'issue',
        ({ params, user }) => {
          const issueId = parseId(params.issueId)
          if (issueId === null) return error(400, 'validation_error', 'Invalid issueId')
          const found = findIssue(issueId)
          if (!found || !visibleImport(user, found.run.importId)) return notFound('Validation issue')
          return HttpResponse.json(detailOf(found.run, found.issue))
        },
        caller,
      ),
    ),

    http.patch(
      `${API}/validation-issues/:issueId`,
      route(
        'resolve',
        async ({ request, params, user }) => {
          const issueId = parseId(params.issueId)
          if (issueId === null) return error(400, 'validation_error', 'Invalid issueId')
          const found = findIssue(issueId)
          const visible = found && visibleImport(user, found.run.importId)
          if (!canProcess(user)) return visible ? forbidden() : notFound('Validation issue')
          if (!found || !visible) return notFound('Validation issue')
          const body = (await request.json()) as { resolutionStatus?: string; note?: string }
          const note = typeof body.note === 'string' ? body.note.trim() : ''
          if (body.resolutionStatus !== 'resolved' || note.length < 1 || note.length > 500) {
            return error(400, 'validation_error', 'Invalid body')
          }
          const { run, issue } = found
          if (!run.isCurrent) return superseded(run)
          const script = run.fixture.patches?.[issue.key]
          if (script && 'error' in script) return scripted(script)
          const at = auditInstant(now())
          const entry: IssueHistoryEntry = {
            at,
            user: userRef(user),
            action: 'resolve',
            occurrenceId: null,
            from: null,
            to: null,
            note,
          }
          Object.assign(issue.detail, {
            resolutionStatus: 'resolved',
            resolvedAt: at,
            resolvedBy: userRef(user),
            resolutionNote: note,
            // A resolved finding is no longer persistent: the contract's `resolvable` is off from now on.
            resolvable: false,
            history: [...issue.detail.history, entry],
          })
          return HttpResponse.json(afterScript(run, issue, script))
        },
        caller,
      ),
    ),

    http.patch(
      `${API}/conflict-occurrences/:occurrenceId`,
      route(
        'inclusion',
        async ({ request, params, user }) => {
          const occurrenceId = String(params.occurrenceId)
          if (!/^\d{1,19}$/.test(occurrenceId) || BigInt(occurrenceId) > MAX_BIGINT) {
            return error(400, 'validation_error', 'Invalid occurrenceId')
          }
          const found = findOccurrence(occurrenceId)
          const record = found && visibleImport(user, found.run.importId)
          if (!canProcess(user)) return record ? forbidden() : notFound('Conflict occurrence')
          if (!found || !record) return notFound('Conflict occurrence')
          const body = (await request.json()) as { includeInSettlement?: unknown }
          if (typeof body.includeInSettlement !== 'boolean') return error(400, 'validation_error', 'Invalid body')
          const { run, issue, index } = found
          if (!RUNNABLE.includes(record.status)) {
            return error(409, 'import_not_editable', 'The import cannot be edited in its status', {
              status: record.status,
            })
          }
          if (!run.isCurrent) return superseded(run)
          const script = run.fixture.patches?.[occurrenceKey(issue.key, index)]
          if (script && 'error' in script) return scripted(script)
          const occurrence = issue.detail.occurrences[index]!
          const to = body.includeInSettlement
          if (occurrence.includeInSettlement !== to) {
            const at = auditInstant(now())
            const changed = { ...occurrence, includeInSettlement: to, changedBy: userRef(user), changedAt: at }
            const occurrences = issue.detail.occurrences.map((o, i) => (i === index ? changed : o))
            const entry: IssueHistoryEntry = {
              at,
              user: userRef(user),
              action: 'set_inclusion',
              occurrenceId,
              from: occurrence.includeInSettlement,
              to,
              note: null,
            }
            Object.assign(issue.detail, {
              occurrences,
              history: [...issue.detail.history, entry],
              ...counts(occurrences),
            })
            invalidate(record, run, user, 'inclusion_change', { newRunId: null, occurrenceId })
          }
          return HttpResponse.json(afterScript(run, issue, script))
        },
        caller,
      ),
    ),

    http.post(
      `${API}/imports/:importId/review`,
      route(
        'review',
        async ({ request, params, user }) => {
          const record = visibleImport(user, params.importId)
          if (!canProcess(user)) return record ? forbidden() : notFound('Import')
          if (!record) return notFound('Import')
          const body = (await request.json()) as { runId?: unknown }
          if (typeof body.runId !== 'number' || !Number.isInteger(body.runId) || body.runId < 1) {
            return error(400, 'validation_error', 'Invalid body')
          }
          if (record.status !== 'analyzed') {
            return error(409, 'import_not_analyzed', 'The import is not analyzed', { status: record.status })
          }
          const run = currentRun(record.importId)
          if (!run) return error(409, 'validation_run_required', 'Run the validations before reviewing', {})
          if (body.runId !== run.runId) {
            return error(
              409,
              'validation_run_superseded',
              'A newer validation run exists; review it before continuing',
              {
                runId: body.runId,
                currentRunId: run.runId,
              },
            )
          }
          if (run.fixture.blocked) {
            const blocking = run.issues.filter((i) => i.detail.blocking).map((i) => i.detail)
            return error(
              409,
              'blocking_validation_issue',
              'provider_mismatch: cancel the import and process it under the correct provider',
              {
                runId: run.runId,
                validationCodes: [...new Set(blocking.map((i) => i.validationCode))],
                issueIds: blocking.map((i) => i.issueId),
              },
            )
          }
          run.review = { reviewedBy: userRef(user), reviewedAt: auditInstant(now()) }
          record.status = 'validated'
          return HttpResponse.json(viewOf(record))
        },
        caller,
      ),
    ),
  ]
}
