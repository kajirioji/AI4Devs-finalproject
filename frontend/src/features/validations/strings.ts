// Texts of the validations block of Analysis & Validations (web-shell "Textos de interfaz en inglés y
// centralizados"). Those fixed by the spec of web-validations are literal.
import type {
  ImportStatus,
  IssueScope,
  IssueType,
  MissingRange,
  ValidationCode,
  ValidationOutcome,
} from '@recon/shared'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export const strings = {
  title: 'Validations',
  loading: 'Loading the validations…',
  loadError: 'The validations could not be loaded.',
  retry: 'Retry',
  noRun: 'No validation run yet.',

  run: {
    first: 'Run validations',
    again: 'Run again',
    running: 'Running the validations…',
    importChanged: 'The import changed while the validations ran. The results were reloaded.',
    notAnalyzed: (status: ImportStatus) => `The validations cannot run on a ${status} import.`,
    forbidden: 'You cannot run the validations.',
    failed: 'The validations could not run. Try again.',
    confirm: {
      title: 'Run the validations again?',
      lostChanges: (count: number) =>
        `Running the validations again discards ${plural(count, 'manual change', 'manual changes')} (inclusions and resolutions).`,
      invalidatesReview: 'The current review will be invalidated and the import returns to analyzed.',
      keep: 'Keep the current run',
      confirm: 'Run again',
    },
  },

  header: {
    label: 'Validation run',
    overallLabel: 'Overall result',
    overall: { blocked: 'Blocked', warnings: 'Warnings', passed: 'Passed' },
    run: (runId: number, at: string, userName: string) => `Run #${runId} · ${at} · ${userName}`,
    ranges: 'Date ranges used by the validations',
    counters: 'Informative counters',
    pendingInRange: 'Pending in range',
    undatedAdjustments: 'Undated adjustments',
    undatedCandidates: 'Undated candidates',
    // What each counter counts (README §3.3, "Candidatas I sin fecha" and "Pending"; design D10).
    explain: {
      pendingInRange:
        "Transactions of the account's channels still Pending on the gateway, created within the APP or DEC range.",
      undatedAdjustments: 'Rows of this batch in cycle I without a status-change date.',
      undatedCandidates:
        'Gateway transactions in a cycle I status without a status-change date: they cannot be compared with the I range.',
      note: 'Informative: none of them is a finding.',
    },
  },

  table: {
    label: 'Validation results',
    validation: 'Validation',
    outcome: 'Result',
    findings: 'Findings',
    blocking: 'Blocking',
    breakdown: 'Breakdown',
    blocks: 'Blocks',
    none: '—',
  },

  validations: {
    provider_mismatch: 'Provider mismatch',
    non_recorded_adjustment: 'Non-recorded adjustment',
    duplicate_in_batch: 'Duplicate in batch',
    status_collision_in_batch: 'Status collision in batch',
    duplicate_across_batches: 'Duplicate across batches',
    status_collision_across_batches: 'Status collision across batches',
    missing_previous_to_batch: 'Missing previous to batch',
    missing_in_range: 'Missing in range',
  } satisfies Record<ValidationCode, string>,

  outcomes: {
    passed: 'Passed',
    warning: 'Warning',
    blocked: 'Blocked',
    not_applicable: 'n/a',
    not_implemented: 'Not implemented',
  } satisfies Record<ValidationOutcome, string>,

  breakdown: {
    non_recorded_adjustment: (count: number) => plural(count, 'non-recorded adjustment', 'non-recorded adjustments'),
    status_mismatch: (count: number) => plural(count, 'status mismatch', 'status mismatches'),
    range: (range: MissingRange, count: number) => `${range} ${count}`,
  },

  issueTypes: {
    provider_mismatch: 'Provider mismatch',
    non_recorded_adjustment: 'Non-recorded adjustment',
    status_mismatch: 'Status mismatch',
    duplicate: 'Duplicate',
    collision: 'Collision',
    missing: 'Missing',
  } satisfies Record<IssueType, string>,

  scopes: {
    in_batch: 'in batch',
    across_batches: 'across batches',
    previous_to_batch: 'previous to batch',
    in_range: 'in range',
  } satisfies Record<IssueScope, string>,

  resolution: { persistent: 'Persistent', resolved: 'Resolved' },

  list: {
    label: (validation: string) => `Findings of ${validation}`,
    table: 'Findings',
    id: 'ID',
    cycle: 'Cycle',
    type: 'Type',
    reported: 'Reported status',
    gateway: 'Gateway status',
    range: 'Range',
    included: 'Included',
    resolution: 'Resolution',
    none: '—',
    empty: 'No findings.',
    loadError: 'The findings could not be loaded.',
    pageOf: (page: number, pages: number, total: number) =>
      `Page ${page} of ${pages} · ${plural(total, 'finding', 'findings')}`,
    previous: 'Previous',
    next: 'Next',
  },

  drawer: {
    loading: 'Finding',
    loadError: 'The finding could not be loaded.',
    title: (validation: string, id: string) => `${validation} · ${id}`,
    superseded: 'This finding belongs to a superseded run.',
    type: 'Type',
    cycle: 'Cycle',
    reported: 'Reported status',
    gateway: 'Gateway status',
    range: 'Range',
    /** The range of the batch for the cycle and status of a missing finding (design D18). */
    batchRange: (cycleStatus: string) => `Batch range (${cycleStatus})`,
    noRange: '—',
    /**
     * Why a finding is missing, by missingType (README §3.3, "Faltantes": not in the batch and not processed in that
     * cycle in a batch in force, not undone, of any account of the provider).
     */
    whyMissing: {
      in_range:
        'Its date is inside the batch range, but it is not in this batch and no batch of the provider in force (not undone) processed it in this cycle.',
      previous_to_batch:
        'Its date is before the batch range, it is not in this batch and no batch of the provider in force (not undone) processed it in this cycle.',
    },
    relevantDate: 'Date',
    source: 'Row',
    occurrences: 'Occurrences',
    noOccurrences: 'No occurrences: the transaction is not in this batch.',
    location: (fileName: string, sheetName: string, rowNo: number) => `${fileName} · ${sheetName} · row ${rowNo}`,
    batch: (batchNo: number, attemptNo: number, accountName: string) =>
      `Batch #${batchNo} · attempt ${attemptNo} · ${accountName}`,
    noLocation: 'Movement without a row',
    unresolvedStatus: 'Unresolved status',
    chb2: 'CHB 2',
    includedByDefault: 'Included by default',
    excludedByDefault: 'Excluded by default',
    included: 'Included',
    excluded: 'Excluded',
    changedBy: (userName: string, at: string) => `Changed by ${userName} · ${at}`,
    resolvedBy: (userName: string, at: string) => `Resolved by ${userName} · ${at}`,
    history: 'History',
    noHistory: 'No changes yet.',
    /** Without `from` or `to` the entry still says that the inclusion changed. */
    inclusionEntry: (userName: string, at: string, where: string, from: boolean | null, to: boolean | null) =>
      from === null || to === null
        ? `${userName} · ${at} · ${where} · inclusion changed`
        : `${userName} · ${at} · ${where} · ${from ? 'included' : 'excluded'} → ${to ? 'included' : 'excluded'}`,
    resolveEntry: (userName: string, at: string, note: string) => `${userName} · ${at} · resolved: "${note}"`,
  },

  inclusion: {
    label: (where: string) => `Included in settlement — ${where}`,
    saving: 'Saving the change…',
    notIncludable:
      'This reserve cannot be included: another occurrence is included or it was released in a previous batch.',
    confirm: {
      title: 'Change the inclusion?',
      body: 'Changing an inclusion invalidates the review: the import returns to analyzed.',
      keep: 'Keep the review',
      confirm: 'Change the inclusion',
    },
  },

  resolve: {
    note: 'Note',
    submit: 'Mark as resolved',
    required: 'Write a note before resolving.',
    tooLong: 'The note can have at most 500 characters.',
  },

  decision: {
    label: 'Decision',
    continue: 'Continue to settlement review',
    blocked: 'provider_mismatch: cancel the import and process it under the correct provider.',
    viewBlocking: 'View the blocking finding',
    noRun: 'Run the validations before continuing.',
    cancel: 'Cancel and reprocess',
    reviewedBy: (userName: string, at: string) => `Reviewed by ${userName} · ${at}`,
    settlementReview: 'Settlement Review',
    viewSummary: 'View settlement summary',
    reviewing: 'Saving the review…',
    /** One text per status that leaves nothing to decide; the API does not say who cancelled or processed. */
    closed: {
      cancelled: 'This import is cancelled. Its run and findings are kept for reference.',
      processed: 'This import is processed. Its run and findings are kept for reference.',
    },
    errors: {
      superseded: 'A newer validation run exists. Review it before continuing.',
      blocking: 'The validations found a blocking finding. The results were reloaded.',
      required: 'There is no current validation run. The results were reloaded.',
      notAnalyzed: (status: ImportStatus) => `This import can no longer be reviewed (${status}).`,
      forbidden: 'You cannot review this import.',
      failed: 'The review could not be saved. Try again.',
    },
  },

  invalidated: {
    label: 'Review invalidated',
    text: (reviewer: string, reviewedAt: string, by: string, at: string, why: string) =>
      `The review by ${reviewer} on ${reviewedAt} was invalidated by ${by} on ${at}: ${why}.`,
    rerun: (newRunId: number | null) => `the validations ran again${newRunId ? ` (run #${newRunId})` : ''}`,
    inclusionChange: 'an inclusion was changed',
    settlementUndone: 'the settlement attempt was undone',
  },

  /** Answers of the API to the actions of the drawer, by code (design D3). */
  actionErrors: {
    reserve_already_included: 'A reserve is released only once: exclude the included occurrence first.',
    reserve_already_released: 'This reserve was already released in a previous batch.',
    superseded: 'A newer validation run exists. The results were reloaded.',
    importNotEditable: (status: ImportStatus) => `This import can no longer change (${status}).`,
    occurrenceNotEditable: 'This occurrence cannot change.',
    alreadyResolved: (userName: string, at: string) => `This finding was already resolved by ${userName} on ${at}.`,
    alreadyResolvedUnknown: 'This finding was already resolved.',
    notIncludable: 'This occurrence cannot be included.',
    notResolvable: 'Only non-recorded adjustments and status mismatches are resolved by hand.',
    forbidden: 'You cannot change this finding.',
    failed: 'The change could not be saved. Try again.',
  },
}
