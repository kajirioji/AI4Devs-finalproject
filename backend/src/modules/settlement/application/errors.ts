// Errors of the settlement module (settlement-process design D18; README §4.3 in lowercase, messages in English).
// The validation ones (validation_run_required, validation_run_superseded, blocking_validation_issue) are reused.
import type { BatchFeeInvalidReason, BatchStatus, ChannelToAssign } from '@recon/shared'
import { DomainError } from '../../../shared/errors.js'
import type { TransitionError } from '../domain/batch-lifecycle.js'

// import_not_validated lives with the import state machine (imports/domain), which raises it in assertCanProcess.
export { ImportNotValidatedError } from '../../imports/domain/errors.js'
export {
  BlockingValidationIssueError,
  ValidationRunRequiredError,
  ValidationRunSupersededError,
} from '../../validation/application/errors.js'

/** An active (not undone) attempt of the account already holds the number. */
export class BatchNoTakenError extends DomainError {
  readonly status = 409
  readonly code = 'batch_no_taken'

  constructor(batchNo: number, attemptNo: number, importId: string) {
    super(`Batch ${batchNo} already has an active attempt for this account`, { batchNo, attemptNo, importId })
  }
}

/** The batch has channels not assigned yet or with another primary account, and the assignment was not confirmed. */
export class ChannelAssignmentNotConfirmedError extends DomainError {
  readonly status = 409
  readonly code = 'channel_assignment_not_confirmed'

  constructor(channels: ChannelToAssign[]) {
    super('The import includes channels not assigned to this account; confirm the assignment', { channels })
  }
}

/** The first batch fee of the request that fails, by its position. */
export class BatchFeeInvalidError extends DomainError {
  readonly status = 400
  readonly code = 'batch_fee_invalid'

  constructor(index: number, reason: BatchFeeInvalidReason) {
    super(`Batch fee ${index} is not valid: ${reason}`, { index, reason })
  }
}

/** SQL Server chose the processing as a deadlock victim three times in a row (design D7): a retry later succeeds. */
export class SettlementBusyError extends DomainError {
  readonly status = 409
  readonly code = 'settlement_busy'

  constructor() {
    super('Another settlement is being processed for this provider; retry')
  }
}

/** pay from paid or undone; undo from undone (settlement-lifecycle design D7). */
export class SettlementNotProcessedError extends DomainError {
  readonly status = 409
  readonly code = 'settlement_not_processed'

  constructor(status: BatchStatus) {
    super(`This batch is not processed (status: ${status})`, { status })
  }
}

/** unpay from processed or undone. */
export class SettlementNotPaidError extends DomainError {
  readonly status = 409
  readonly code = 'settlement_not_paid'

  constructor(status: BatchStatus) {
    super(`This batch is not paid (status: ${status})`, { status })
  }
}

/** undo from paid: the payment has to be removed first. */
export class SettlementPaymentNotRemovedError extends DomainError {
  readonly status = 409
  readonly code = 'settlement_payment_not_removed'

  constructor() {
    super('This batch is paid; remove the payment before undoing it', { status: 'paid' })
  }
}

/** undo of a processed attempt that is not the current one of its import (inconsistent data, defensive). */
export class SettlementNotCurrentError extends DomainError {
  readonly status = 409
  readonly code = 'settlement_not_current'

  constructor(importStatus: string, currentBatchId: string | null) {
    super('This batch is not the current attempt of its import', { importStatus, currentBatchId })
  }
}

/** The 409 of a rejected transition, with the status the attempt has now. */
export function transitionErrorOf(error: TransitionError, status: BatchStatus): DomainError {
  switch (error) {
    case 'not_processed':
      return new SettlementNotProcessedError(status)
    case 'not_paid':
      return new SettlementNotPaidError(status)
    case 'payment_not_removed':
      return new SettlementPaymentNotRemovedError()
  }
}
