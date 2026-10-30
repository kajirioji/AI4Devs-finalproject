import { ImportStatus } from '@recon/shared'
import { describe, expect, it } from 'vitest'
import {
  ImportNotAnalyzedError,
  ImportNotCancellableError,
  ImportNotEditableError,
  ImportNotMappedError,
  ImportNotValidatedError,
} from './errors.js'
import {
  assertCanAnalyze,
  assertCanCancel,
  assertCanChangeInclusion,
  assertCanConfirmMapping,
  assertCanEditFiles,
  assertCanProcess,
  assertCanResolveRow,
  assertCanReview,
  assertCanValidate,
  EDITABLE_STATUSES,
  UNDO_ATTEMPT_MOVE,
} from './import-state.js'

// The full transition table of the spec "Máquina de estados del import" (design D2): every action × every status.
const STATUSES = ImportStatus.options

type Guard = (status: ImportStatus) => void

interface Row {
  action: string
  guard: Guard
  allowed: ImportStatus[]
  error: new (...args: never[]) => Error
}

const TABLE: Row[] = [
  {
    action: 'confirm mapping',
    guard: assertCanConfirmMapping,
    allowed: ['uploaded', 'mapped'],
    error: ImportNotEditableError,
  },
  {
    action: 'add/remove files',
    guard: assertCanEditFiles,
    allowed: ['uploaded', 'mapped'],
    error: ImportNotEditableError,
  },
  { action: 'analyze', guard: assertCanAnalyze, allowed: ['mapped'], error: ImportNotMappedError },
  { action: 'resolve row', guard: assertCanResolveRow, allowed: ['analyzed'], error: ImportNotEditableError },
  // validation-runs (P1, P4): validating and changing an inclusion also from validated, which goes back to analyzed.
  {
    action: 'run validations',
    guard: assertCanValidate,
    allowed: ['analyzed', 'validated'],
    error: ImportNotAnalyzedError,
  },
  { action: 'review', guard: assertCanReview, allowed: ['analyzed'], error: ImportNotAnalyzedError },
  {
    action: 'change an inclusion',
    guard: assertCanChangeInclusion,
    allowed: ['analyzed', 'validated'],
    error: ImportNotEditableError,
  },
  // settlement-process: processing (and its preview) only from validated, which goes to processed.
  { action: 'process', guard: assertCanProcess, allowed: ['validated'], error: ImportNotValidatedError },
  {
    action: 'cancel',
    guard: assertCanCancel,
    allowed: ['uploaded', 'mapped', 'analyzed', 'validated'],
    error: ImportNotCancellableError,
  },
]

describe('import state machine', () => {
  it('covers the six statuses of the vocabulary', () => {
    expect(STATUSES).toEqual(['uploaded', 'mapped', 'analyzed', 'validated', 'processed', 'cancelled'])
  })

  describe.each(TABLE)('$action', ({ guard, allowed, error }) => {
    it.each(STATUSES)('from %s', (status) => {
      if (allowed.includes(status)) {
        expect(() => guard(status)).not.toThrow()
      } else {
        expect(() => guard(status)).toThrow(error)
        try {
          guard(status)
        } catch (thrown) {
          expect(thrown).toMatchObject({ status: 409, details: { status } })
        }
      }
    })
  })

  it('import_not_analyzed says which statuses the action admits (review L5)', () => {
    expect(() => assertCanValidate('mapped')).toThrow(/mapped.*analyzed or validated/)
    expect(() => assertCanReview('validated')).toThrow(/validated.*needs analyzed$/)
  })

  it('import_not_validated names the status in English (settlement-process)', () => {
    expect(() => assertCanProcess('analyzed')).toThrow(
      'The import must be validated before processing (status: analyzed)',
    )
  })

  it('exposes the editable statuses for the file routes', () => {
    expect([...EDITABLE_STATUSES].sort()).toEqual(['mapped', 'uploaded'])
  })
})

describe('UNDO_ATTEMPT_MOVE', () => {
  it('takes a processed import back to analyzed, where it can be validated and cancelled again', () => {
    expect(UNDO_ATTEMPT_MOVE).toEqual({ from: 'processed', to: 'analyzed' })
    expect(() => assertCanValidate(UNDO_ATTEMPT_MOVE.to)).not.toThrow()
    expect(() => assertCanCancel(UNDO_ATTEMPT_MOVE.to)).not.toThrow()
    expect(() => assertCanValidate(UNDO_ATTEMPT_MOVE.from)).toThrow()
  })
})
