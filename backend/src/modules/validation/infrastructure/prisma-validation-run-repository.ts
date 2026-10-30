// Prisma adapter of ValidationRunRepository (validation-runs design D4–D8, D16). Every write starts with a guarded
// UPDATE of the Import row, which holds its exclusive lock until commit: the writes of the flow serialize, and one
// computed on a version that changed meanwhile persists nothing (ImportChangedError).

import { performance } from 'node:perf_hooks'
import {
  Cycle,
  type ImportStatus,
  InvalidationReason,
  type IssueHistoryEntry,
  IssueScope,
  IssueType,
  MissingRange,
  MissingType,
  type RowLocation,
  type StatusRef,
  TransactionStatusCode,
  ValidationCode,
  type ValidationIssueSummary,
  type ValidationIssuesQuery,
  ValidationOutcome,
} from '@recon/shared'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js'
import type { Scope } from '../../catalog/domain/scope.js'
import { ImportNotEditableError } from '../../imports/domain/errors.js'
import {
  BlockingValidationIssueError,
  ImportChangedError,
  ImportNotAnalyzedError,
  IssueAlreadyResolvedError,
  IssueNotResolvableError,
  OccurrenceNotEditableError,
  OccurrenceNotIncludableError,
  ValidationRunRequiredError,
  ValidationRunSupersededError,
} from '../application/errors.js'
import type {
  ImportRef,
  ReviewEvent,
  StoredIssueDetail,
  StoredOccurrence,
  StoredRun,
  ValidationRunRepository,
  WritePhases,
} from '../application/ports.js'
import { reserveRuleBlocks } from '../application/reserve-rule.js'
import {
  breakdownOf,
  breakdownView,
  type IssueDetailJson,
  issueDetailOf,
  type StoredBreakdown,
} from '../application/run-record.js'
import type { Issue, ValidationReport } from '../domain/types.js'
import { INVALIDATE, REVIEW, recordInvalidation } from './review-events.js'

type Tx = Prisma.TransactionClient

const UNIQUE_VIOLATION = 'P2002'
const CURRENT_RUN_INDEX = 'UX_ValidationRun_current_import'
/** A run of the reference volume writes in well under a second (D14 bench); the default 5 s leaves no margin. */
const RUN_TX_TIMEOUT_MS = 60_000
const RUN_TX_MAX_WAIT_MS = 10_000

const SET_INCLUSION = 'validation.occurrence.set_inclusion'
const RESOLVE = 'validation.issue.resolve'
/** Only these findings are resolved by hand (P5). */
const RESOLVABLE_TYPES = ['non_recorded_adjustment', 'status_mismatch']
/** Thrown inside a transaction to roll it back when the inclusion already has the requested value. */
const NO_CHANGE = Symbol('no change')

function visibleAccount(scope: Scope): Prisma.AccountWhereInput {
  return { provider: { merchantId: { in: [...scope.merchantIds] } } }
}

const json = (value: unknown) => (value === null ? null : JSON.stringify(value))

/** Binary order of text, the same in every environment (no collation involved), as rowsOf orders the files. */
const compareBinary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A unique violation of the filtered index that keeps one current run per import (0006), by its name. */
function isCurrentRunViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_VIOLATION) return false
  return `${error.message} ${JSON.stringify(error.meta ?? {})}`.includes(CURRENT_RUN_INDEX)
}

/** Rows per bulk statement (findings, MERGE, occurrences): ~2,5 MB of JSON per statement at most. */
const ROWS_PER_BULK_STATEMENT = 10_000

export interface RunRepositoryOptions {
  /** Rows per bulk statement; tests lower it to force several chunks. */
  rowsPerStatement?: number
  /** Called after each bulk statement with its kind and row count (tests observe the chunking). */
  onBulkStatement?: (kind: 'issues' | 'merge' | 'occurrences', rows: number) => void
  /**
   * Awaited inside the transaction right before the guard on Import, without holding its lock: tests pause a write
   * there so another request commits in between. Anything the write decided before its guard would then be stale.
   */
  beforeClaim?: (operation: 'saveRun' | 'setInclusion' | 'review') => Promise<void>
}

export class PrismaValidationRunRepository implements ValidationRunRepository {
  private readonly issues: PrismaIssueReader

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: RunRepositoryOptions = {},
  ) {
    this.issues = new PrismaIssueReader(prisma)
  }

  listIssues(importId: string, query: ValidationIssuesQuery) {
    return this.issues.listIssues(importId, query)
  }

  findIssue(scope: Scope, issueId: number) {
    return this.issues.findIssue(scope, issueId)
  }

  async findOccurrence(scope: Scope, occurrenceId: string) {
    const found = await this.prisma.conflictOccurrence.findFirst({
      where: {
        occurrenceId: BigInt(occurrenceId),
        issue: { result: { run: { import: { account: visibleAccount(scope) } } } },
      },
      select: { issueId: true },
    })
    return found === null ? null : { occurrenceId, issueId: found.issueId }
  }

  async setInclusion(occurrenceId: string, includeInSettlement: boolean, userId: number, now: Date): Promise<void> {
    const id = BigInt(occurrenceId)
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const located = await tx.conflictOccurrence.findUniqueOrThrow({
            where: { occurrenceId: id },
            select: { issueId: true, issue: { select: { cycle: true, result: { select: { runId: true } } } } },
          })
          const run = await tx.validationRun.findUniqueOrThrow({
            where: { runId: located.issue.result.runId },
            select: { runId: true, importId: true },
          })
          await this.options.beforeClaim?.('setInclusion')
          // From here on the Import row is locked: everything read below is what the change is decided on (D9).
          const previousStatus = await this.claimForInclusion(tx, run.importId, now)
          const { isSuperseded } = await tx.validationRun.findUniqueOrThrow({
            where: { runId: run.runId },
            select: { isSuperseded: true },
          })
          if (isSuperseded) {
            const current = await tx.validationRun.findFirst({
              where: { importId: run.importId, isSuperseded: false },
              select: { runId: true },
            })
            throw new ValidationRunSupersededError(run.runId, current?.runId ?? null)
          }
          const siblings = (
            await tx.conflictOccurrence.findMany({
              where: { issueId: located.issueId },
              select: { occurrenceId: true, sourceType: true, includeInSettlement: true },
            })
          ).map((o) => ({
            occurrenceId: String(o.occurrenceId),
            sourceType: o.sourceType === 'previous_batch' ? ('previous_batch' as const) : ('current_import' as const),
            includeInSettlement: o.includeInSettlement,
          }))
          const target = siblings.find((o) => o.occurrenceId === occurrenceId) as (typeof siblings)[number]
          if (target.sourceType !== 'current_import') throw new OccurrenceNotEditableError(target.sourceType)
          if (target.includeInSettlement === includeInSettlement) throw NO_CHANGE
          const blocked = reserveRuleBlocks(located.issue.cycle, siblings, target)
          if (includeInSettlement && blocked) throw new OccurrenceNotIncludableError(blocked)
          await tx.conflictOccurrence.update({
            where: { occurrenceId: id },
            data: { includeInSettlement, changedByUserId: userId, changedAt: now },
          })
          await tx.auditLog.create({
            data: {
              userId,
              action: SET_INCLUSION,
              entityType: 'ConflictOccurrence',
              entityId: occurrenceId,
              createdAt: now,
              detailJson: JSON.stringify({
                issueId: located.issueId,
                runId: run.runId,
                importId: run.importId,
                from: target.includeInSettlement,
                to: includeInSettlement,
              }),
            },
          })
          if (previousStatus === 'validated') {
            await tx.import.update({ where: { importId: run.importId }, data: { status: 'analyzed' } })
            await recordInvalidation(tx, run.importId, run.runId, userId, now, {
              reason: 'inclusion_change',
              occurrenceId,
            })
          }
        },
        { timeout: RUN_TX_TIMEOUT_MS, maxWait: RUN_TX_MAX_WAIT_MS },
      )
    } catch (error) {
      // The same value writes nothing: the transaction (and the guard's updatedAt) is rolled back on purpose.
      if (error === NO_CHANGE) return
      throw error
    }
  }

  /**
   * The guard of an inclusion change: analyzed or validated, without a version (the decision is taken under the lock).
   * It only advances updatedAt, so runs computed meanwhile get import_changed; the status changes once accepted.
   */
  private async claimForInclusion(tx: Tx, importId: string, now: Date): Promise<ImportStatus> {
    for (const status of ['validated', 'analyzed'] as const) {
      const claimed = await tx.import.updateMany({ where: { importId, status }, data: { updatedAt: now } })
      if (claimed.count === 1) return status
    }
    const current = await tx.import.findUnique({ where: { importId }, select: { status: true } })
    throw new ImportNotEditableError(current?.status ?? 'unknown')
  }

  async review(importId: string, runId: number, userId: number, now: Date): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Keep the hook right before the guard: a read placed between the two would not be caught by any test.
        await this.options.beforeClaim?.('review')
        // The guard takes the Import lock first: the current run read below cannot change before the commit.
        const claimed = await tx.import.updateMany({
          where: { importId, status: 'analyzed' },
          data: { updatedAt: now },
        })
        if (claimed.count !== 1) {
          const current = await tx.import.findUnique({ where: { importId }, select: { status: true } })
          throw new ImportNotAnalyzedError(current?.status ?? 'unknown')
        }
        const current = await tx.validationRun.findFirst({
          where: { importId, isSuperseded: false },
          select: {
            runId: true,
            results: { select: { validationCode: true, outcome: true, issueCount: true } },
          },
        })
        if (!current) throw new ValidationRunRequiredError()
        if (current.runId !== runId) throw new ValidationRunSupersededError(runId, current.runId)
        const blocked = current.results.filter((r) => r.outcome === 'blocked')
        if (blocked.length > 0) {
          const issues = await tx.validationIssue.findMany({
            where: { blocking: true, result: { runId } },
            select: { issueId: true },
            orderBy: { issueId: 'asc' },
          })
          throw new BlockingValidationIssueError(
            runId,
            ValidationCode.options.filter((code) => blocked.some((r) => r.validationCode === code)),
            issues.map((i) => i.issueId),
          )
        }
        const [changed] = await tx.$queryRaw<{ n: number | bigint }[]>`
          SELECT COUNT(*) AS n FROM [ConflictOccurrence] o
          JOIN [ValidationIssue] i ON i.[issueId] = o.[issueId]
          JOIN [ValidationResult] r ON r.[resultId] = i.[resultId]
          WHERE r.[runId] = ${runId} AND o.[includeInSettlement] <> o.[defaultIncluded]`
        await tx.import.update({ where: { importId }, data: { status: 'validated' } })
        await tx.auditLog.create({
          data: {
            userId,
            action: REVIEW,
            entityType: 'Import',
            entityId: importId,
            createdAt: now,
            detailJson: JSON.stringify({
              runId,
              issueCounts: Object.fromEntries(
                ValidationCode.options.map((code) => [
                  code,
                  current.results.find((r) => r.validationCode === code)?.issueCount ?? 0,
                ]),
              ),
              changedOccurrences: Number(changed?.n ?? 0),
            }),
          },
        })
      },
      { timeout: RUN_TX_TIMEOUT_MS, maxWait: RUN_TX_MAX_WAIT_MS },
    )
  }

  async resolveIssue(issueId: number, note: string, userId: number, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const resolved = await tx.validationIssue.updateMany({
        where: {
          issueId,
          resolutionStatus: 'persistent',
          issueType: { in: [...RESOLVABLE_TYPES] },
          result: { run: { isSuperseded: false } },
        },
        data: { resolutionStatus: 'resolved', resolvedByUserId: userId, resolvedAt: now, resolutionNote: note },
      })
      const issue = await tx.validationIssue.findUniqueOrThrow({
        where: { issueId },
        select: {
          issueType: true,
          resolutionStatus: true,
          resolvedAt: true,
          resolvedBy: { select: { userId: true, userName: true } },
          result: { select: { run: { select: { runId: true, importId: true, isSuperseded: true } } } },
        },
      })
      const { run } = issue.result
      if (resolved.count === 0) {
        if (!RESOLVABLE_TYPES.includes(issue.issueType)) throw new IssueNotResolvableError(issue.issueType)
        if (issue.resolutionStatus === 'resolved')
          throw new IssueAlreadyResolvedError(issue.resolvedAt?.toISOString() ?? null, issue.resolvedBy)
        const current = await tx.validationRun.findFirst({
          where: { importId: run.importId, isSuperseded: false },
          select: { runId: true },
        })
        throw new ValidationRunSupersededError(run.runId, current?.runId ?? null)
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: RESOLVE,
          entityType: 'ValidationIssue',
          entityId: String(issueId),
          createdAt: now,
          detailJson: JSON.stringify({ issueId, runId: run.runId, importId: run.importId, note }),
        },
      })
    })
  }

  async findImport(scope: Scope, importId: string): Promise<ImportRef | null> {
    const row = await this.prisma.import.findFirst({
      where: { importId, account: visibleAccount(scope) },
      select: { importId: true, status: true, updatedAt: true },
    })
    return row === null ? null : { ...row, status: row.status as ImportStatus }
  }

  async saveRun(importId: string, expectedUpdatedAt: Date, userId: number, report: ValidationReport, now: Date) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const phases: WritePhases = {
            claimMs: 0,
            supersedeMs: 0,
            runMs: 0,
            resultsMs: 0,
            plainIssuesMs: 0,
            occurrenceIssuesMs: 0,
            auditMs: 0,
          }
          let mark = performance.now()
          const lap = (phase: keyof WritePhases) => {
            const at = performance.now()
            phases[phase] += Math.round(at - mark)
            mark = at
          }
          await this.options.beforeClaim?.('saveRun')
          const previousStatus = await this.claimForRun(tx, importId, expectedUpdatedAt, now)
          lap('claimMs')
          const previous = await tx.validationRun.findFirst({
            where: { importId, isSuperseded: false },
            select: { runId: true },
          })
          await tx.validationRun.updateMany({ where: { importId, isSuperseded: false }, data: { isSuperseded: true } })
          lap('supersedeMs')
          const { runId } = await tx.validationRun.create({
            data: {
              importId,
              runAt: now,
              runByUserId: userId,
              dateMinApp: report.ranges.APP?.min ?? null,
              dateMaxApp: report.ranges.APP?.max ?? null,
              dateMinDec: report.ranges.DEC?.min ?? null,
              dateMaxDec: report.ranges.DEC?.max ?? null,
              dateMinI: report.ranges.I?.min ?? null,
              dateMaxI: report.ranges.I?.max ?? null,
              dateMinR: report.ranges.R?.min ?? null,
              dateMaxR: report.ranges.R?.max ?? null,
              pendingInRangeCount: report.pendingInRangeCount,
              undatedAdjustmentCount: report.undatedAdjustmentCount,
              undatedCandidateCount: report.undatedCandidateCount,
            },
            select: { runId: true },
          })
          lap('runMs')
          await this.writeResults(tx, runId, report, now, lap)
          if (previousStatus === 'validated' && previous) {
            await recordInvalidation(tx, importId, previous.runId, userId, now, {
              reason: 'rerun',
              newRunId: runId,
            })
          }
          lap('auditMs')
          return { runId, previousStatus, phases }
        },
        { timeout: RUN_TX_TIMEOUT_MS, maxWait: RUN_TX_MAX_WAIT_MS },
      )
    } catch (error) {
      // UX_ValidationRun_current_import is the last barrier: if it fires, another run won the race. Any other unique
      // violation is a programming error and is rethrown as is.
      if (isCurrentRunViolation(error)) {
        // The transaction rolled back: the status to answer is the one the import has now.
        const current = await this.prisma.import.findUnique({ where: { importId }, select: { status: true } })
        throw new ImportChangedError(current?.status ?? 'unknown')
      }
      throw error
    }
  }

  /**
   * The guard of a run (D4): only from analyzed or validated with the version the caller read; it leaves the import
   * analyzed and answers the status it replaced. Two guarded statements instead of one with OUTPUT: each is atomic and
   * matches only the read version, so no other writer can slip between them.
   */
  // Rule for every writer of Import.updatedAt: it stores datetime2 precision (a Prisma model write, or a raw one with
  // CAST(... AS datetime2(7))). The comparison below matches the value read back to the millisecond; a value rounded to
  // datetime (1/300 s) would never match and every run would answer import_changed.
  private async claimForRun(tx: Tx, importId: string, expectedUpdatedAt: Date, now: Date): Promise<ImportStatus> {
    for (const status of ['validated', 'analyzed'] as const) {
      const claimed = await tx.import.updateMany({
        where: { importId, status, updatedAt: expectedUpdatedAt },
        data: { status: 'analyzed', updatedAt: now },
      })
      if (claimed.count === 1) return status
    }
    const current = await tx.import.findUnique({ where: { importId }, select: { status: true } })
    const status = current?.status ?? 'unknown'
    if (status !== 'analyzed' && status !== 'validated')
      throw new ImportNotAnalyzedError(status, ['analyzed', 'validated'])
    throw new ImportChangedError(status)
  }

  /** Eight results in order, then the findings in bulk: those without occurrences, then those with them (D5). */
  private async writeResults(
    tx: Tx,
    runId: number,
    report: ValidationReport,
    now: Date,
    lap: (phase: keyof WritePhases) => void,
  ): Promise<void> {
    await tx.validationResult.createMany({
      data: report.results.map((r) => ({
        runId,
        validationCode: r.code,
        outcome: r.outcome,
        issueCount: r.issueCount,
        detailJson: json(breakdownOf(r)),
      })),
    })
    const resultIds = new Map(
      (await tx.validationResult.findMany({ where: { runId }, select: { resultId: true, validationCode: true } })).map(
        (r) => [r.validationCode, r.resultId],
      ),
    )
    lap('resultsMs')
    const plain: IssueJson[] = []
    const withOccurrences: { resultId: number; issue: Issue }[] = []
    for (const result of report.results) {
      const resultId = resultIds.get(result.code) as number
      for (const issue of result.issues) {
        if (issue.occurrences.length === 0) plain.push(issueJson(resultId, issue))
        else withOccurrences.push({ resultId, issue })
      }
    }
    const createdAt = Prisma.sql`CAST(${now.toISOString()} AS datetime2(7))`
    // The findings without occurrences in statements of at most rowsPerStatement rows: each chunk travels as one JSON
    // parameter, typed in the WITH clause exactly as the columns (no implicit NVARCHAR → VARCHAR conversion).
    for (const chunk of this.chunks(plain)) {
      await tx.$executeRaw`
        INSERT INTO [ValidationIssue] (${ISSUE_INSERT_COLUMNS})
        SELECT j.[r], j.[t], j.[s], j.[b], j.[raw], j.[tx], j.[c], j.[st], j.[m], j.[d], j.[j], ${createdAt}
        FROM OPENJSON(${JSON.stringify(chunk)}) WITH (${ISSUE_JSON_COLUMNS}) j`
      this.options.onBulkStatement?.('issues', chunk.length)
    }
    lap('plainIssuesMs')

    // The file of a historical occurrence comes from the sheet its movement was settled from.
    const historicalSheets = [
      ...new Set(
        withOccurrences.flatMap(({ issue }) =>
          issue.occurrences.flatMap((o) => (o.sourceType === 'previous_batch' && o.sheetId ? [o.sheetId] : [])),
        ),
      ),
    ]
    const fileOfSheet = new Map(
      historicalSheets.length === 0
        ? []
        : (
            await tx.importSheet.findMany({
              where: { sheetId: { in: historicalSheets } },
              select: { sheetId: true, fileId: true },
            })
          ).map((s) => [s.sheetId, s.fileId]),
    )
    if (withOccurrences.length > 0) {
      // MERGE … OUTPUT correlates each inserted issueId with the ordinal of its finding (D5): it does not depend on
      // the order IDENTITY assigns in a multi-row insert. Ordinals are global, so chunking does not break it.
      const sources = withOccurrences.map(({ resultId, issue }, o) => ({ o, ...issueJson(resultId, issue) }))
      const issueIdOf = new Map<number, number>()
      for (const chunk of this.chunks(sources)) {
        const inserted = await tx.$queryRaw<{ ordinal: number; issueId: number }[]>`
          MERGE INTO [ValidationIssue] AS t
          USING (
            SELECT * FROM OPENJSON(${JSON.stringify(chunk)}) WITH ([o] INT, ${ISSUE_JSON_COLUMNS})
          ) AS j
          ON 1 = 0
          WHEN NOT MATCHED THEN
            INSERT (${ISSUE_INSERT_COLUMNS})
            VALUES (j.[r], j.[t], j.[s], j.[b], j.[raw], j.[tx], j.[c], j.[st], j.[m], j.[d], j.[j], ${createdAt})
          OUTPUT j.[o] AS ordinal, inserted.[issueId] AS issueId;`
        for (const row of inserted) issueIdOf.set(Number(row.ordinal), Number(row.issueId))
        this.options.onBulkStatement?.('merge', chunk.length)
      }
      const occurrences = withOccurrences.flatMap(({ issue }, ordinal) =>
        issue.occurrences.map((o) => ({
          i: issueIdOf.get(ordinal),
          k: o.sourceType,
          bt: o.sourceType === 'previous_batch' ? o.batchId : null,
          f:
            o.sourceType === 'current_import'
              ? o.fileId
              : o.sheetId === null
                ? null
                : (fileOfSheet.get(o.sheetId) ?? null),
          sh: o.sheetId,
          rn: o.rowNo,
          st: o.statusId,
          // A new run starts every occurrence at its default inclusion (P6).
          inc: o.defaultIncluded,
          def: o.defaultIncluded,
        })),
      )
      for (const chunk of this.chunks(occurrences)) {
        await tx.$executeRaw`
          INSERT INTO [ConflictOccurrence] ([issueId], [sourceType], [batchId], [fileId], [sheetId], [rowNo],
            [statusId], [includeInSettlement], [defaultIncluded])
          SELECT j.[i], j.[k], j.[bt], j.[f], j.[sh], j.[rn], j.[st], j.[inc], j.[def]
          FROM OPENJSON(${JSON.stringify(chunk)}) WITH ([i] INT, [k] VARCHAR(20), [bt] UNIQUEIDENTIFIER,
            [f] UNIQUEIDENTIFIER, [sh] UNIQUEIDENTIFIER, [rn] INT, [st] INT, [inc] BIT, [def] BIT) j`
        this.options.onBulkStatement?.('occurrences', chunk.length)
      }
    }
    lap('occurrenceIssuesMs')
  }

  /** At most rowsPerStatement rows per bulk statement: bounds the JSON parameter whatever the size of the run. */
  private chunks<T>(items: readonly T[]): T[][] {
    const size = this.options.rowsPerStatement ?? ROWS_PER_BULK_STATEMENT
    const out: T[][] = []
    for (let offset = 0; offset < items.length; offset += size) out.push(items.slice(offset, offset + size))
    return out
  }

  async currentRun(importId: string): Promise<StoredRun | null> {
    const run = await this.prisma.validationRun.findFirst({
      where: { importId, isSuperseded: false },
      include: {
        runBy: { select: { userId: true, userName: true } },
        results: { select: { validationCode: true, outcome: true, issueCount: true, detailJson: true } },
      },
    })
    if (!run) return null
    const [counted] = await this.prisma.$queryRaw<{ changed: number | bigint; resolved: number | bigint }[]>`
      SELECT
        (SELECT COUNT(*) FROM [ConflictOccurrence] o
           JOIN [ValidationIssue] i ON i.[issueId] = o.[issueId]
           JOIN [ValidationResult] r ON r.[resultId] = i.[resultId]
          WHERE r.[runId] = ${run.runId} AND o.[includeInSettlement] <> o.[defaultIncluded]) AS changed,
        (SELECT COUNT(*) FROM [ValidationIssue] i
           JOIN [ValidationResult] r ON r.[resultId] = i.[resultId]
          WHERE r.[runId] = ${run.runId} AND i.[resolvedByUserId] IS NOT NULL) AS resolved`
    const range = (min: Date | null, max: Date | null) => (min === null || max === null ? null : { min, max })
    return {
      runId: run.runId,
      runAt: run.runAt,
      runBy: run.runBy,
      ranges: {
        APP: range(run.dateMinApp, run.dateMaxApp),
        DEC: range(run.dateMinDec, run.dateMaxDec),
        I: range(run.dateMinI, run.dateMaxI),
        R: range(run.dateMinR, run.dateMaxR),
      },
      pendingInRangeCount: run.pendingInRangeCount,
      undatedAdjustmentCount: run.undatedAdjustmentCount,
      undatedCandidateCount: run.undatedCandidateCount,
      results: run.results.map((r) => ({
        validationCode: ValidationCode.parse(r.validationCode),
        outcome: ValidationOutcome.parse(r.outcome),
        issueCount: r.issueCount,
        breakdown: breakdownView(r.detailJson === null ? null : (JSON.parse(r.detailJson) as StoredBreakdown)),
      })),
      manualChangeCount: Number(counted?.changed ?? 0) + Number(counted?.resolved ?? 0),
    }
  }

  async reviewEvents(importId: string): Promise<ReviewEvent[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: { entityType: 'Import', entityId: importId, action: { in: [REVIEW, INVALIDATE] } },
      orderBy: [{ createdAt: 'asc' }, { auditId: 'asc' }],
      select: { action: true, createdAt: true, detailJson: true, user: { select: { userId: true, userName: true } } },
    })
    const details = entries.map((e) => JSON.parse(e.detailJson ?? '{}') as Record<string, unknown>)
    const reviewerIds = [
      ...new Set(details.map((d) => d.reviewedByUserId).filter((id): id is number => typeof id === 'number')),
    ]
    const reviewers = new Map(
      (
        await this.prisma.user.findMany({
          where: { userId: { in: reviewerIds } },
          select: { userId: true, userName: true },
        })
      ).map((u) => [u.userId, u]),
    )
    return entries.flatMap((e, index): ReviewEvent[] => {
      const detail = details[index] as Record<string, unknown>
      const by = e.user ?? { userId: 0, userName: 'unknown' }
      if (e.action === REVIEW) return [{ kind: 'review', runId: Number(detail.runId), by, at: e.createdAt }]
      const reviewerId = detail.reviewedByUserId as number | null
      return [
        {
          kind: 'invalidate',
          runId: Number(detail.runId),
          by,
          at: e.createdAt,
          reviewedBy: (reviewerId === null ? undefined : reviewers.get(reviewerId)) ?? {
            userId: 0,
            userName: 'unknown',
          },
          reviewedAt: new Date(String(detail.reviewedAt ?? e.createdAt.toISOString())),
          reason: InvalidationReason.parse(detail.reason),
          newRunId: typeof detail.newRunId === 'number' ? detail.newRunId : null,
          occurrenceId: typeof detail.occurrenceId === 'string' ? detail.occurrenceId : null,
        },
      ]
    })
  }
}

/** Reads of findings (D8), split out to keep the write side of the repository readable. */
export class PrismaIssueReader {
  private statuses: Map<number, StatusRef> | null = null

  constructor(private readonly prisma: PrismaClient) {}

  /** The current run's findings in the order of issue-order.ts, written as SQL: CASE for the enums, BIN2 for the id. */
  async listIssues(importId: string, query: ValidationIssuesQuery) {
    const filters = [
      Prisma.sql`v.[importId] = ${importId} AND v.[isSuperseded] = 0`,
      ...(query.type ? [Prisma.sql`i.[issueType] = ${query.type}`] : []),
      ...(query.scope ? [Prisma.sql`i.[scope] = ${query.scope}`] : []),
      ...(query.status ? [Prisma.sql`i.[resolutionStatus] = ${query.status}`] : []),
      ...(query.validationCode ? [Prisma.sql`r.[validationCode] = ${query.validationCode}`] : []),
      ...(query.cycle ? [Prisma.sql`i.[cycle] = ${query.cycle}`] : []),
    ]
    const from = Prisma.sql`
      FROM [ValidationIssue] i
      JOIN [ValidationResult] r ON r.[resultId] = i.[resultId]
      JOIN [ValidationRun] v ON v.[runId] = r.[runId]
      WHERE ${Prisma.join(filters, ' AND ')}`
    const validationOrder = Prisma.join(
      ValidationCode.options.map((code, index) => Prisma.sql`WHEN ${code} THEN ${index}`),
      ' ',
    )
    const [counted] = await this.prisma.$queryRaw<{ total: number | bigint }[]>`SELECT COUNT(*) AS total ${from}`
    const page = await this.prisma.$queryRaw<{ issueId: number }[]>`
      SELECT i.[issueId] ${from}
      ORDER BY
        CASE r.[validationCode] ${validationOrder} END,
        CASE i.[cycle] WHEN 'E' THEN 0 WHEN 'I' THEN 1 WHEN 'R' THEN 2 ELSE 3 END,
        CASE JSON_VALUE(i.[detailJson], '$.missingRange') WHEN 'APP' THEN 0 WHEN 'DEC' THEN 1 WHEN 'I' THEN 2
          WHEN 'R' THEN 3 ELSE 4 END,
        i.[relevantDate],
        i.[transactionIdRaw] COLLATE Latin1_General_BIN2,
        i.[issueId]
      OFFSET ${(query.page - 1) * query.pageSize} ROWS FETCH NEXT ${query.pageSize} ROWS ONLY`
    const ids = page.map((p) => Number(p.issueId))
    const summaries = new Map((await this.summariesOf(ids)).map((s) => [s.issueId, s]))
    return { items: ids.map((id) => summaries.get(id) as ValidationIssueSummary), total: Number(counted?.total ?? 0) }
  }

  async findIssue(scope: Scope, issueId: number): Promise<StoredIssueDetail | null> {
    const issue = await this.prisma.validationIssue.findFirst({
      where: { issueId, result: { run: { import: { account: visibleAccount(scope) } } } },
      select: {
        transactionId: true,
        cycle: true,
        result: {
          select: { run: { select: { isSuperseded: true, import: { select: { importId: true, status: true } } } } },
        },
        occurrences: {
          select: {
            occurrenceId: true,
            sourceType: true,
            batchId: true,
            sheetId: true,
            rowNo: true,
            statusId: true,
            includeInSettlement: true,
            defaultIncluded: true,
            changedAt: true,
            changedBy: { select: { userId: true, userName: true } },
            batch: {
              select: {
                batchId: true,
                batchNo: true,
                attemptNo: true,
                status: true,
                accountId: true,
                account: { select: { name: true } },
              },
            },
          },
        },
      },
    })
    if (!issue) return null
    const [summary] = await this.summariesOf([issueId])
    const statuses = await this.statusMap()
    const sheetIds = issue.occurrences.flatMap((o) => (o.sheetId ? [o.sheetId] : []))
    const sheets = await this.sheetsOf(sheetIds)
    // excludeAmount (CHB 2) has no column: the current row's detailJson, the settled movement's flag (D8).
    const current = issue.occurrences.filter((o) => o.sourceType === 'current_import' && o.sheetId && o.rowNo)
    const rows =
      current.length === 0
        ? []
        : await this.prisma.importRow.findMany({
            where: { OR: current.map((o) => ({ sheetId: o.sheetId as string, rowNo: o.rowNo as number })) },
            select: { sheetId: true, rowNo: true, detailJson: true },
          })
    const rowExcluded = new Map(
      rows.map((r) => [`${r.sheetId}:${r.rowNo}`, JSON.parse(r.detailJson ?? '{}').excludeAmount === true]),
    )
    const batchIds = issue.occurrences.flatMap((o) => (o.batchId ? [o.batchId] : []))
    const settled =
      batchIds.length === 0 || issue.transactionId === null || issue.cycle === null
        ? []
        : await this.prisma.settlementTransaction.findMany({
            where: { batchId: { in: batchIds }, transactionId: issue.transactionId, cycle: issue.cycle },
            select: { batchId: true, sheetId: true, rowNo: true, excludeAmount: true },
          })
    // A batch may hold several movements of the key (settlement-process D3): the movement is the one of the
    // occurrence's row; a movement without a row (seeded history) is unique per batch and key.
    const settledKey = (batchId: string | null, sheetId: string | null, rowNo: number | null) =>
      `${batchId ?? ''}:${sheetId ?? ''}:${rowNo ?? ''}`
    const settledExcluded = new Map(settled.map((s) => [settledKey(s.batchId, s.sheetId, s.rowNo), s.excludeAmount]))

    const occurrences = issue.occurrences
      .map((o) => {
        const sheet = o.sheetId ? sheets.get(o.sheetId) : undefined
        const location: RowLocation | null =
          sheet && o.sheetId && o.rowNo
            ? {
                fileId: sheet.fileId,
                fileName: sheet.fileName,
                sheetId: o.sheetId,
                sheetName: sheet.sheetName,
                rowNo: o.rowNo,
              }
            : null
        const view: StoredOccurrence = {
          occurrenceId: String(o.occurrenceId),
          sourceType: o.sourceType === 'previous_batch' ? 'previous_batch' : 'current_import',
          location,
          batch: o.batch
            ? {
                batchId: o.batch.batchId,
                batchNo: o.batch.batchNo,
                attemptNo: o.batch.attemptNo,
                status: o.batch.status as 'processed' | 'paid' | 'undone',
                accountId: o.batch.accountId,
                accountName: o.batch.account.name,
              }
            : null,
          status: o.statusId === null ? null : (statuses.get(o.statusId) ?? null),
          excludeAmount:
            o.sourceType === 'current_import'
              ? (rowExcluded.get(`${o.sheetId}:${o.rowNo}`) ?? false)
              : (settledExcluded.get(settledKey(o.batchId, o.sheetId, o.rowNo)) ?? false),
          defaultIncluded: o.defaultIncluded,
          includeInSettlement: o.includeInSettlement,
          changedBy: o.changedBy,
          changedAt: o.changedAt?.toISOString() ?? null,
        }
        return { view, raw: o, sheet }
      })
      .sort((a, b) => {
        const source = Number(a.view.sourceType === 'previous_batch') - Number(b.view.sourceType === 'previous_batch')
        if (source !== 0) return source
        if (a.view.sourceType === 'current_import') {
          // First-occurrence order: file upload order, sheet position in its workbook, row number.
          return (
            (a.sheet?.fileOrder ?? 0) - (b.sheet?.fileOrder ?? 0) ||
            (a.sheet?.sheetOrder ?? 0) - (b.sheet?.sheetOrder ?? 0) ||
            (a.raw.rowNo ?? 0) - (b.raw.rowNo ?? 0)
          )
        }
        // History order of the engine: batch, attempt, row, then the stored id.
        return (
          (a.raw.batch?.batchNo ?? 0) - (b.raw.batch?.batchNo ?? 0) ||
          (a.raw.batch?.attemptNo ?? 0) - (b.raw.batch?.attemptNo ?? 0) ||
          (a.raw.rowNo ?? -1) - (b.raw.rowNo ?? -1) ||
          Number(a.raw.occurrenceId - b.raw.occurrenceId)
        )
      })
      .map((o) => o.view)

    return {
      summary: summary as ValidationIssueSummary,
      importId: issue.result.run.import.importId,
      importStatus: issue.result.run.import.status as ImportStatus,
      isCurrent: !issue.result.run.isSuperseded,
      occurrences,
      history: await this.historyOf(
        issueId,
        occurrences.map((o) => o.occurrenceId),
      ),
    }
  }

  /** Each finding as the list and the detail answer it, in no particular order. */
  private async summariesOf(issueIds: number[]): Promise<ValidationIssueSummary[]> {
    if (issueIds.length === 0) return []
    const issues = await this.prisma.validationIssue.findMany({
      where: { issueId: { in: issueIds } },
      select: {
        issueId: true,
        issueType: true,
        scope: true,
        blocking: true,
        transactionIdRaw: true,
        transactionId: true,
        cycle: true,
        statusId: true,
        missingType: true,
        relevantDate: true,
        detailJson: true,
        resolutionStatus: true,
        resolvedAt: true,
        resolutionNote: true,
        resolvedBy: { select: { userId: true, userName: true } },
        result: { select: { runId: true, validationCode: true } },
      },
    })
    const counts = await this.prisma.$queryRaw<
      { issueId: number; total: number; byDefault: number; included: number }[]
    >`
      SELECT o.[issueId], COUNT(*) AS total,
             SUM(CASE WHEN o.[defaultIncluded] = 1 THEN 1 ELSE 0 END) AS byDefault,
             SUM(CASE WHEN o.[includeInSettlement] = 1 THEN 1 ELSE 0 END) AS included
      FROM [ConflictOccurrence] o
      WHERE o.[issueId] IN (${Prisma.join(issueIds)})
      GROUP BY o.[issueId]`
    const countOf = new Map(counts.map((c) => [Number(c.issueId), c]))
    const details = issues.map((i) => (i.detailJson === null ? {} : (JSON.parse(i.detailJson) as IssueDetailJson)))
    const sheets = await this.sheetsOf(details.flatMap((d) => (d.source ? [d.source.sheetId] : [])))
    const statuses = await this.statusMap()
    return issues.map((i, index) => {
      const detail = details[index] as IssueDetailJson
      const sheet = detail.source ? sheets.get(detail.source.sheetId) : undefined
      const count = countOf.get(i.issueId)
      return {
        issueId: i.issueId,
        runId: i.result.runId,
        validationCode: ValidationCode.parse(i.result.validationCode),
        issueType: IssueType.parse(i.issueType),
        scope: i.scope === null ? null : IssueScope.parse(i.scope),
        blocking: i.blocking,
        transactionIdRaw: i.transactionIdRaw,
        transactionId: i.transactionId === null ? null : String(i.transactionId),
        cycle: i.cycle === null ? null : Cycle.parse(i.cycle),
        missingType: i.missingType === null ? null : MissingType.parse(i.missingType),
        missingRange: detail.missingRange === undefined ? null : MissingRange.parse(detail.missingRange),
        relevantDate: i.relevantDate?.toISOString() ?? null,
        status: i.statusId === null ? null : (statuses.get(i.statusId) ?? null),
        gatewayStatus: detail.gatewayStatusId === undefined ? null : (statuses.get(detail.gatewayStatusId) ?? null),
        source:
          detail.source && sheet
            ? {
                fileId: sheet.fileId,
                fileName: sheet.fileName,
                sheetId: detail.source.sheetId,
                sheetName: sheet.sheetName,
                rowNo: detail.source.rowNo,
              }
            : null,
        resolutionStatus: i.resolutionStatus === 'resolved' ? 'resolved' : 'persistent',
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        resolvedBy: i.resolvedBy,
        resolutionNote: i.resolutionNote,
        occurrenceCount: Number(count?.total ?? 0),
        includedByDefaultCount: Number(count?.byDefault ?? 0),
        includedCount: Number(count?.included ?? 0),
      }
    })
  }

  /** Name, file and position of each sheet; fileOrder/sheetOrder as the engine orders the rows. */
  private async sheetsOf(sheetIds: string[]) {
    const unique = [...new Set(sheetIds)]
    if (unique.length === 0) return new Map<string, SheetInfo>()
    const rows = await this.prisma.importSheet.findMany({
      where: { sheetId: { in: unique } },
      select: {
        sheetId: true,
        sheetName: true,
        sheetIndex: true,
        file: { select: { fileId: true, fileName: true, uploadedAt: true } },
      },
    })
    // The rank of each file by (uploadedAt, fileName, fileId), as rowsOf orders them for the engine: two files of one
    // upload share uploadedAt, and only the name decides which occurrence comes first.
    const files = [...new Map(rows.map((s) => [s.file.fileId, s.file])).values()].sort(
      (a, b) =>
        a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
        compareBinary(a.fileName, b.fileName) ||
        compareBinary(a.fileId, b.fileId),
    )
    const fileRank = new Map(files.map((f, index) => [f.fileId, index]))
    return new Map(
      rows.map((s): [string, SheetInfo] => [
        s.sheetId,
        {
          fileId: s.file.fileId,
          fileName: s.file.fileName,
          sheetName: s.sheetName,
          fileOrder: fileRank.get(s.file.fileId) as number,
          sheetOrder: s.sheetIndex ?? Number.MAX_SAFE_INTEGER,
        },
      ]),
    )
  }

  private async statusMap(): Promise<Map<number, StatusRef>> {
    if (this.statuses === null) {
      const rows = await this.prisma.transactionStatus.findMany({ select: { statusId: true, code: true, name: true } })
      this.statuses = new Map(
        rows.map((s) => [
          s.statusId,
          { statusId: s.statusId, code: TransactionStatusCode.parse(s.code), name: s.name },
        ]),
      )
    }
    return this.statuses
  }

  /** Inclusion changes of the occurrences and the resolution of the finding, from AuditLog, oldest first (D8). */
  private async historyOf(issueId: number, occurrenceIds: string[]): Promise<IssueHistoryEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          ...(occurrenceIds.length === 0
            ? []
            : [{ action: SET_INCLUSION, entityType: 'ConflictOccurrence', entityId: { in: occurrenceIds } }]),
          { action: RESOLVE, entityType: 'ValidationIssue', entityId: String(issueId) },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { auditId: 'asc' }],
      select: {
        action: true,
        entityId: true,
        createdAt: true,
        detailJson: true,
        user: { select: { userId: true, userName: true } },
      },
    })
    return entries.map((e) => {
      const detail = JSON.parse(e.detailJson ?? '{}') as Record<string, unknown>
      const inclusion = e.action === SET_INCLUSION
      return {
        at: e.createdAt.toISOString(),
        user: e.user ?? { userId: 0, userName: 'unknown' },
        action: inclusion ? 'set_inclusion' : 'resolve',
        occurrenceId: inclusion ? e.entityId : null,
        from: inclusion ? Boolean(detail.from) : null,
        to: inclusion ? Boolean(detail.to) : null,
        note: inclusion ? null : String(detail.note ?? ''),
      }
    })
  }
}

interface SheetInfo {
  fileId: string
  fileName: string
  sheetName: string
  fileOrder: number
  sheetOrder: number
}

/** A ValidationIssue row as it travels in the JSON of the bulk insert; keys are the WITH columns below. */
interface IssueJson {
  r: number
  t: string
  s: string | null
  b: boolean
  raw: string | null
  /** BIGINT as text: a JSON number would lose digits. */
  tx: string | null
  c: string | null
  st: number | null
  m: string | null
  /** ISO text, read as datetime2(7). */
  d: string | null
  j: string | null
}

/** Columns written by the bulk insert of findings; resolutionStatus takes its default ('persistent'). */
const ISSUE_INSERT_COLUMNS = Prisma.raw(
  '[resultId], [issueType], [scope], [blocking], [transactionIdRaw], [transactionId], [cycle], [statusId], ' +
    '[missingType], [relevantDate], [detailJson], [createdAt]',
)

/** The JSON of a finding typed exactly as its columns (ValidationIssue in 0001_init). */
const ISSUE_JSON_COLUMNS = Prisma.raw(
  '[r] INT, [t] VARCHAR(30), [s] VARCHAR(30), [b] BIT, [raw] NVARCHAR(100), [tx] BIGINT, [c] CHAR(1), [st] INT, ' +
    '[m] VARCHAR(30), [d] DATETIME2(7), [j] NVARCHAR(MAX)',
)

function issueJson(resultId: number, issue: Issue): IssueJson {
  return {
    r: resultId,
    t: issue.issueType,
    s: issue.scope,
    b: issue.blocking,
    raw: issue.transactionIdRaw,
    tx: issue.transactionId === null ? null : String(issue.transactionId),
    c: issue.cycle,
    st: issue.statusId,
    m: issue.missingType ?? null,
    d: issue.relevantDate?.toISOString() ?? null,
    j: json(issueDetailOf(issue)),
  }
}
