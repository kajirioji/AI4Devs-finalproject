// The import state machine of this change (spec: import, D2): which statuses allow
// each action, and the 409 raised otherwise. Transitions themselves are applied by the repositories.
import type { ImportStatus } from '@recon/shared'
import {
  ImportNotAnalyzedError,
  ImportNotCancellableError,
  ImportNotEditableError,
  ImportNotMappedError,
  ImportNotValidatedError,
} from './errors.js'

/** Files and mapping can change only before the analysis (README HU1 CA2, CA8). */
export const EDITABLE_STATUSES: ReadonlySet<ImportStatus> = new Set(['uploaded', 'mapped'])

/** Cancelling keeps everything as evidence; only `processed` and `cancelled` refuse it (spec: import, D13). */
export const CANCELLABLE_STATUSES: ReadonlySet<ImportStatus> = new Set(['uploaded', 'mapped', 'analyzed', 'validated'])

/** `PUT /imports/{id}/mapping`: `uploaded` or `mapped`. */
export function assertCanConfirmMapping(status: ImportStatus): void {
  if (!EDITABLE_STATUSES.has(status)) throw new ImportNotEditableError(status)
}

/** `POST /imports/{id}/files` and `DELETE /imports/{id}/files/{fileId}`: `uploaded` or `mapped`. */
export function assertCanEditFiles(status: ImportStatus): void {
  if (!EDITABLE_STATUSES.has(status)) throw new ImportNotEditableError(status)
}

/** `POST /imports/{id}/analyze`: `mapped` only. */
export function assertCanAnalyze(status: ImportStatus): void {
  if (status !== 'mapped') throw new ImportNotMappedError(status)
}

/** `PATCH /imports/{id}/rows/{sheetId}/{rowNo}`: `analyzed` only; it supersedes the current run (validation-runs P7). */
export function assertCanResolveRow(status: ImportStatus): void {
  if (status !== 'analyzed') throw new ImportNotEditableError(status)
}

/** Validating and changing an inclusion: `analyzed`, or `validated`, which goes back to `analyzed` (P1, P4). */
export const VALIDATABLE_STATUSES: ReadonlySet<ImportStatus> = new Set(['analyzed', 'validated'])

/** `POST /imports/{id}/validations`: `analyzed` or `validated`. */
export function assertCanValidate(status: ImportStatus): void {
  if (!VALIDATABLE_STATUSES.has(status)) throw new ImportNotAnalyzedError(status, [...VALIDATABLE_STATUSES])
}

/** `POST /imports/{id}/review`: `analyzed` only (the decision on the whole moves it to `validated`). */
export function assertCanReview(status: ImportStatus): void {
  if (status !== 'analyzed') throw new ImportNotAnalyzedError(status)
}

/** `PATCH /conflict-occurrences/{id}`: `analyzed` or `validated`. */
export function assertCanChangeInclusion(status: ImportStatus): void {
  if (!VALIDATABLE_STATUSES.has(status)) throw new ImportNotEditableError(status)
}

/** `POST /imports/{id}/settlements` and its preview: `validated` only, which processing moves to `processed`. */
export function assertCanProcess(status: ImportStatus): void {
  if (status !== 'validated') throw new ImportNotValidatedError(status)
}

/** `POST /settlements/{id}/undo` of the current attempt: the import can be validated and cancelled again. */
export const UNDO_ATTEMPT_MOVE = { from: 'processed', to: 'analyzed' } as const satisfies {
  from: ImportStatus
  to: ImportStatus
}

/** `POST /imports/{id}/cancel`: anything but `processed` and `cancelled`. */
export function assertCanCancel(status: ImportStatus): void {
  if (!CANCELLABLE_STATUSES.has(status)) throw new ImportNotCancellableError(status)
}
