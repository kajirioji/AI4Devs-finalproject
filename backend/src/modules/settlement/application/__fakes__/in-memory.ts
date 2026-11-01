/**
 * In-memory doubles of the settlement read ports (../ports.ts) over an engine input already built from the synthetic
 * world (test-support/sample-input.ts): the source answers from it the way the Prisma adapter answers from the base.
 */
import type { ImportStatus, SettlementView } from '@recon/shared'
import type { Scope } from '../../../catalog/domain/scope.js'
import type { LifecycleAction } from '../../domain/batch-lifecycle.js'
import type { SettlementInput } from '../../domain/types.js'
import type {
  CurrentRun,
  ImportContext,
  LifecycleCommand,
  PrefilledBatchFees,
  ProcessCommand,
  ReasonCommand,
  SettlementLifecycleRepository,
  SettlementReader,
  SettlementRepository,
  SettlementSource,
  UndoCommand,
} from '../ports.js'

type SettlementLifecycleCall = { action: LifecycleAction } & LifecycleCommand & { reason?: string; importId?: string }

export interface InMemorySourceOptions {
  status?: ImportStatus
  merchantId?: number
  blocked?: CurrentRun['blocked']
}

export class InMemorySettlementSource implements SettlementSource {
  calls: string[] = []

  constructor(
    private readonly input: SettlementInput,
    private readonly options: InMemorySourceOptions = {},
  ) {}

  async importContext(scope: Scope | null, importId: string): Promise<ImportContext | null> {
    this.calls.push('importContext')
    if (importId !== this.input.importId) return null
    if (scope !== null && !scope.merchantIds.includes(this.options.merchantId ?? 1)) return null
    return { importId, status: this.options.status ?? 'validated', account: this.input.account }
  }

  async account(scope: Scope, accountId: string) {
    this.calls.push('account')
    if (accountId !== this.input.account.accountId || !scope.merchantIds.includes(this.options.merchantId ?? 1))
      return null
    return this.input.account
  }

  async currentRun(importId: string): Promise<CurrentRun | null> {
    this.calls.push('currentRun')
    if (importId !== this.input.importId) return null
    return { runId: this.input.runId, ranges: this.input.ranges, blocked: this.options.blocked ?? null }
  }

  async rows(importId: string) {
    this.calls.push('rows')
    return importId === this.input.importId ? [...this.input.rows] : []
  }

  async inclusions(runId: number) {
    this.calls.push('inclusions')
    return runId === this.input.runId ? [...this.input.inclusions] : []
  }

  async channels(_accountId: string, channelIds: readonly number[]) {
    this.calls.push('channels')
    return this.input.channels.filter((c) => channelIds.includes(c.channelId))
  }

  async previousE(_providerId: number, transactionIds: readonly bigint[], _excludeImportId: string) {
    this.calls.push('previousE')
    return new Set(transactionIds.filter((id) => this.input.previousE.has(id)))
  }

  async accountFees() {
    this.calls.push('accountFees')
    return [...this.input.fees]
  }

  async feeTypes() {
    this.calls.push('feeTypes')
    return [...this.input.feeTypes]
  }

  async attempts() {
    this.calls.push('attempts')
    return [...this.input.attempts]
  }
}

/** Records the commands; the transactional rules are the Prisma repository's (integration tests). */
export class InMemorySettlementRepository implements SettlementRepository {
  readonly commands: ProcessCommand[] = []

  constructor(private readonly batchId = '5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d') {}

  async process(command: ProcessCommand): Promise<{ batchId: string }> {
    this.commands.push(command)
    return { batchId: this.batchId }
  }
}

/** Records the lifecycle actions it receives; `failWith` is what the guard of the real one would raise. */
export class InMemorySettlementLifecycleRepository implements SettlementLifecycleRepository {
  readonly calls: SettlementLifecycleCall[] = []
  failWith: Error | null = null

  private record(call: SettlementLifecycleCall): void {
    if (this.failWith) throw this.failWith
    this.calls.push(call)
  }

  async pay(command: LifecycleCommand): Promise<void> {
    this.record({ action: 'pay', ...command })
  }

  async unpay(command: ReasonCommand): Promise<void> {
    this.record({ action: 'unpay', ...command })
  }

  async undo(command: UndoCommand): Promise<void> {
    this.record({ action: 'undo', ...command })
  }
}

/** Answers a fixed view for the batch it knows. */
export class InMemorySettlementReader implements SettlementReader {
  constructor(private readonly views: ReadonlyMap<string, SettlementView> = new Map()) {}

  async view(batchId: string): Promise<SettlementView | null> {
    return this.views.get(batchId) ?? null
  }
}

export class InMemoryPrefilledBatchFees implements PrefilledBatchFees {
  constructor(private readonly feeTypeIds: ReadonlySet<number>) {}

  async feeTypeIdsOf(): Promise<Set<number>> {
    return new Set(this.feeTypeIds)
  }
}
