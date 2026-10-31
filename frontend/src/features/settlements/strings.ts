// Texts of Settlement Review, Settlement Summary and Settlement List (web-shell "Textos de interfaz en inglés y
// centralizados"). Those fixed by the specs of web-settlement and settlements-browse are literal.
import type { ImportStatus } from '@recon/shared'
import type { Category, PayableLineCode, SettlementWarning, Skipped } from './contract'

/** Previous / Next of the paginated tables, with the reason a button is disabled. */
const PAGER = {
  previous: 'Previous',
  next: 'Next',
  firstPage: 'This is the first page.',
  lastPage: 'This is the last page.',
}

export const strings = {
  batch: {
    title: 'Batch',
    batchNo: 'Batch number',
    proposed: (batchNo: number, attemptNo: number) => `Proposed: ${batchNo} · attempt ${attemptNo}`,
    reprocess: (batchNo: number, attemptNo: number) =>
      `Proposed: ${batchNo} · attempt ${attemptNo} (the previous attempt of this import was undone)`,
    taken: (batchNo: number) => `Batch ${batchNo} already has an active attempt for this account.`,
    attempt: (attemptNo: number) => `this number would be attempt ${attemptNo}`,
    settlementDate: 'Settlement date',
    settlementDateHelp: 'The business date of the batch; preset fees are those in force on it.',
  },

  fees: {
    title: 'Batch fees',
    none: 'No batch fees.',
    origins: { file: 'From file', preset: 'Preset', free: 'Free amount' },
    amount: (title: string) => `Amount — ${title}`,
    description: (title: string) => `Description — ${title}`,
    type: (title: string) => `Fee type — ${title}`,
    remove: (title: string) => `Remove ${title}`,
    addPreset: 'Add preset fee',
    addFree: 'Add free-amount fee',
    choosePreset: 'Choose a preset fee…',
    chooseFree: 'Choose a type…',
    chooseType: 'Choose a free-amount type…',
    presetNeedsDate: 'Choose the settlement date first.',
    noPresets: 'The account has no preset fees in force on this date.',
    loadingPresets: 'Loading the preset fees…',
    presetsFailed: 'The preset fees could not be loaded.',
    loadingTypes: 'Loading the fee types…',
    typesFailed: 'The fee types could not be loaded.',
    percentageOnly: (rate: string) => `Percentage-only fee (rate ${rate}): enter the amount.`,
    fixed: (amount: string) => `${amount} USD`,
    rate: (rate: string) => `rate ${rate}`,
    always: 'Always',
    noEnd: 'no end',
    currency: (currency: string) => `Currency in the file: ${currency}. Enter the amount in USD.`,
    /** The reasons of a 400 batch_fee_invalid, by code; an unknown one gets a generic text. */
    invalid: (reason: string): string =>
      ({
        unknown_fee_type: 'This fee type is not in the catalog.',
        transactional_fee_type: 'This fee type is applied per movement, not per batch.',
        fee_not_in_account: 'This preset fee is not of this account.',
        fee_type_mismatch: 'This preset fee is not of this type.',
        fee_not_in_force: 'This preset fee is not in force on the settlement date.',
        free_amount_not_allowed: 'This fee type does not accept a free amount.',
        description_required: 'Write a description for a free-amount fee.',
      })[reason] ?? `This fee is not valid (${reason}).`,
  },

  channels: {
    label: 'Channels to assign',
    intro: 'Processing assigns these channels to this account as their primary account:',
    unassigned: (name: string) => `${name} · not assigned yet`,
    otherAccount: (name: string, account: string) => `${name} · primary account: ${account}`,
    otherMerchant: (name: string) => `${name} · primary account: an account of another merchant`,
    /** Assigned elsewhere, without the account in the answer. */
    anotherAccount: (name: string) => `${name} · primary account: another account`,
    confirm: 'Assign these channels to this account as primary',
  },

  preSummary: {
    label: 'Pre-summary',
    title: 'Pre-summary · what will be processed',
    chooseDate: 'Choose the settlement date to see the pre-summary.',
    fixFields: 'Fix the highlighted fields to see the pre-summary.',
    loading: 'Loading the pre-summary…',
    updating: 'Updating the pre-summary…',
    movements: (m: { E: number; I: number; R: number }) => `E ${m.E} · I ${m.I} · R ${m.R}`,
    totals: 'Totals by type',
    columns: { type: 'Type', qty: 'Qty', amount: 'Amount USD', fee: 'Fees USD', range: 'Date range' },
    noRange: '—',
    payable: 'Amount payable',
    signs: { '+': '+', '-': '−' } as const,
    /** What a screen reader says for each sign. */
    signNames: { '+': 'plus', '-': 'minus' } as const,
    notProcessed: (skipped: Skipped) => {
      const parts = (Object.keys(SKIPPED) as (keyof Skipped)[])
        .filter((reason) => skipped[reason] > 0)
        .map((reason) => `${skipped[reason]} ${SKIPPED[reason]}`)
      return parts.length > 0 ? `Not processed: ${parts.join(' · ')}` : null
    },
    warnings: 'Warnings',
    loadError: 'The pre-summary could not be loaded.',
  },

  categories: {
    deposit: 'Deposits',
    declined: 'Declined',
    chargeback: 'Chargebacks',
    refund: 'Refunds',
    rdr: 'RDR',
  } satisfies Record<Category, string>,

  /** The texts of the errors that stop the preview or Process, by code. */
  errors: {
    superseded: 'A newer validation run exists. Review it before processing.',
    required: 'There is no current validation run. Review the validations before processing.',
    blocking: 'The validations found a blocking finding. Review them before processing.',
    notValidated: (status: ImportStatus) =>
      `The import is no longer validated (status: ${status}). Review its validations again.`,
    forbidden: 'You cannot process this import.',
    processFailed: 'The batch could not be processed. Try again.',
    busy: 'Another settlement is being processed for this provider. Try again.',
    toAnalysis: 'Go to the Analysis step',
  },

  process: {
    label: (batchNo: string | number) => `Process batch ${batchNo}`,
    processing: 'Processing the batch…',
    reasons: {
      chooseDate: 'Choose the settlement date.',
      fixFields: 'Fix the highlighted fields.',
      unknownTypes: 'Choose a type for the fees of unknown type, or remove them.',
      waiting: 'Waiting for the pre-summary.',
      batchTaken: 'Choose a batch number that is not in use.',
      confirmChannels: 'Confirm the channel assignment.',
      previewFailed: 'The pre-summary is not available.',
    },
  },

  warning: (w: SettlementWarning): string => {
    switch (w.code) {
      case 'undated_adjustment':
        return `Adjustment ${w.transactionId} has no event date: it is processed without one.`
      case 'reserve_already_released':
        return `The reserve of ${w.transactionId} was already released.`
      case 'no_transactional_fees':
        return 'The account has no transaction fees configured.'
      case 'reserve_cap_not_applied':
        return 'The reserve cap of the account is not applied yet.'
      case 'transactional_fees_not_computed':
        return 'Transaction fees are not computed yet.'
      case 'chargeback_reserve_policy_not_applied':
        return 'The reserve release on chargeback of the account is not applied yet.'
      case 'fee_variant_not_applied':
        return `A conditional or per-brand variant of fee ${w.feeId} is not applied.`
      default:
        return (w as { code: string }).code
    }
  },

  review: {
    title: 'Settlement Review',
    loading: 'Loading Settlement Review…',
    loadError: 'Settlement Review could not be loaded.',
    notAvailable: 'This import is not available.',
    backToAnalysis: '← Analysis',
    status: 'Status',
    notValidated: 'This import is not validated. Review its validations before processing.',
    toAnalysis: 'Go to the Analysis step',
    processed: 'This import is already processed.',
    viewSummary: 'View settlement summary',
    cancelled: 'This import is cancelled.',
  },

  summary: {
    title: (batchNo: number) => `Settlement Summary · batch ${batchNo}`,
    status: { pending_payment: 'Processed · pending payment', settled: 'Paid', undone: 'Undone' },
    grid: {
      account: 'Account',
      batch: 'Batch',
      status: 'Status',
      processedBy: 'Processed by',
      settlementDate: 'Settlement date',
      paidBy: 'Paid by',
      undoneBy: 'Undone by',
      undoReason: 'Reason',
    },
    batchAttempt: (batchNo: number, attemptNo: number) => `${batchNo} · attempt ${attemptNo}`,
    byAt: (userName: string, at: string) => `${userName} · ${at}`,
    notSet: 'Not set',
    notSettled: 'Movements are not Settled yet: that happens when the batch is marked as paid.',
    goToAnalysis: 'Go to Analysis & Validations',
    attempts: {
      title: 'Attempts of this import',
      viewing: 'viewing',
      line: (status: string, by: string, when: string, amount: string) =>
        `${status} · processed by ${by} · ${when} · ${amount}`,
    },
    actions: {
      markPaid: 'Mark as paid',
      unpay: 'Unpay…',
      undo: 'Undo batch…',
      working: 'Working…',
      removePaymentFirst: 'Remove the payment first.',
      unpayTitle: 'Remove the payment of this batch?',
      unpayBody:
        'The batch goes back to processed and its movements stop being Settled. This does not revert anything already run in the Back-Office.',
      undoTitle: 'Undo this batch?',
      undoBody:
        'The attempt is kept as undone, with all its data. The import goes back to Analysis & Validations, to validate and process it again. The primary account of its channels does not change.',
      reason: 'Reason',
      writeReason: 'Write a reason.',
      tooLong: 'Use at most 500 characters.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      errors: {
        paymentNotRemoved: 'This batch was marked as paid. Remove the payment first.',
        changed: (status: string) => `This batch changed in the meantime (status: ${status}).`,
        notCurrent: 'This batch is not the current attempt of its import.',
        failed: 'The action could not be completed. Try again.',
      },
    },
    totals: 'Totals by type',
    reservesReleased: 'R · Reserve released',
    brands: 'Totals by brand',
    brandColumns: { brand: 'Brand', qty: 'Qty', amount: 'Amount USD' },
    fees: 'Fees',
    transactionalFees: (amount: string, mdr: string, rate: string | null) =>
      `Transaction fees: ${amount} · MDR ${mdr}${rate ? ` (rate ${rate})` : ''}`,
    batchFee: (title: string, origin: string, amount: string, userName: string | null) =>
      [title, origin, amount, userName ? `entered by ${userName}` : null].filter(Boolean).join(' · '),
    reserves: 'Reserves',
    reserveLines: { held: 'Held in this batch', released: 'Released (R)', early: 'Released on chargeback' },
    payable: 'Reserve and payable',
    channels: 'Channels assigned',
    channelNew: (name: string) => `${name} · assigned to this account as primary`,
    channelMoved: (name: string, from: string | null) =>
      from ? `${name} · primary account moved here from ${from}` : `${name} · primary account moved here`,
    channelMovedFromOtherMerchant: (name: string) =>
      `${name} · primary account moved here from an account of another merchant`,
    noChannels: 'No channel changed its primary account.',
    issues: 'Issues',
    issueCounts: (v: { persistent: number; resolved: number; blocking: number; resolvedMissing: number }) =>
      `${v.persistent} persistent · ${v.resolved} resolved · ${v.blocking} blocking · ${v.resolvedMissing} missing resolved by this batch`,
    noValidationSummary: 'The validation summary of this attempt is not available.',
    viewValidations: 'View the validations',
    exports: 'Exports',
    exportNames: { summary: 'Merchant summary', transactions: 'Transactions (CSV)', reserves: 'Reserves (CSV)' },
    exportsNote: 'Generated at processing; run in the Back-Office after the payment. Downloading changes nothing.',
    exportsExcel:
      'Upload these CSV files to the Back-Office as downloaded: do not open or save them with Excel first. ' +
      'To look at one, use Data → From Text/CSV and set the ID column to Text.',
    exportsUnavailable: 'Downloads are not available yet.',
    exportFailed: 'The file could not be downloaded. Try again.',
    backToDashboard: 'Back to Dashboard',
    backToList: (accountName: string) => `Settlements of ${accountName}`,
    tabs: { label: 'Settlement views', summary: 'Summary', movements: 'Movements' },
    newReconciliation: 'New reconciliation',
    loading: 'Loading the settlement…',
    loadError: 'The settlement could not be loaded.',
    notFoundTitle: 'Settlement not found',
    notFoundBody: 'The settlement does not exist or is not in your scope.',
  },

  /** Settlements › Settlement List (settlements-browse). */
  list: {
    title: 'Settlement List',
    chooseAccount: 'Choose an account to see its settlements.',
    filtersLabel: 'Filters',
    status: 'Status',
    statuses: { all: 'All statuses', processed: 'Processed · pending payment', paid: 'Paid', undone: 'Undone' },
    dateField: 'Date',
    dateFields: { settlementDate: 'Settlement date', processedAt: 'Processed (ET)' },
    from: 'From',
    to: 'To',
    reversedRange: 'The start date must not be after the end date.',
    heading: 'Settlements',
    tableLabel: 'Settlements',
    columns: {
      batch: 'Batch',
      attempt: 'Attempt',
      status: 'Status',
      settlementDate: 'Settlement date',
      processed: 'Processed',
      amountPayable: 'Amount payable',
      channels: 'Channels',
    },
    batchLink: (batchNo: number, attemptNo: number) => `Batch ${batchNo} · attempt ${attemptNo}`,
    notSet: 'Not set',
    /** Followed by the instant, on its own unbreakable span. */
    processedBy: (userName: string) => `${userName} · `,
    pageOf: (page: number, pages: number, total: number) =>
      `Page ${page} of ${pages} · ${total} ${total === 1 ? 'settlement' : 'settlements'}`,
    ...PAGER,
    empty: 'No settlements match these filters.',
    loading: 'Loading the settlements…',
    loadError: 'The settlements could not be loaded.',
  },

  /** The Movements tab of the Settlement Summary (settlements-browse D11). */
  movements: {
    cycleLabel: 'Cycle',
    cycle: (cycle: string, count: number) => `${cycle} (${count})`,
    heading: (cycle: string) => `Movements · ${cycle}`,
    tableLabel: 'Movements',
    columns: {
      transaction: 'Transaction',
      status: 'Status',
      round: 'Round',
      sourceRow: 'Source row',
      eventDate: 'Event date',
      amount: 'Amount',
      fees: 'Fees',
      reserves: 'Reserves',
      settled: 'Settled',
    },
    /** One labelled line per figure of the Reserves cell (design D11). */
    reserveLines: {
      held: 'Held',
      released: 'Released',
      early: 'Released on chargeback',
      expected: 'Expected release',
    },
    sourceRow: (sheetName: string, rowNo: number) => `${sheetName} · ${rowNo}`,
    noSourceRow: '—',
    undated: 'Undated',
    excluded: 'excluded from the totals',
    feeCount: (count: number) => `${count} ${count === 1 ? 'fee' : 'fees'}`,
    feeLine: (title: string, amount: string) => `${title} · ${amount}`,
    settled: 'Settled',
    pendingPayment: 'Pending payment',
    pageOf: (page: number, pages: number, total: number) =>
      `Page ${page} of ${pages} · ${total} ${total === 1 ? 'movement' : 'movements'}`,
    empty: 'This cycle has no movements.',
    loading: 'Loading the movements…',
    loadError: 'The movements could not be loaded.',
  },

  pager: PAGER,

  retry: 'Retry',

  /** The labels of the nine payable lines, by code: the same text the API sends in `label` (design D7). */
  payableLines: {
    deposit: 'Deposits',
    chargeback: 'Chargebacks',
    refund: 'Refunds',
    rdr: 'RDR',
    transactional_fees: 'Transaction fees',
    batch_fees: 'Batch fees',
    reserve_held: 'Reserve held',
    reserve_released: 'Reserve released',
    reserve_early_released: 'Reserve released on chargeback',
  } satisfies Record<PayableLineCode, string>,
}

/** Reasons a row is not processed, in the order of the API. */
const SKIPPED: Record<keyof Skipped, string> = {
  ignored: 'ignored',
  unmatched: 'unmatched',
  ambiguous: 'ambiguous',
  excluded: 'excluded',
  unresolvedStatus: 'with unresolved status',
  pending: 'pending',
}
