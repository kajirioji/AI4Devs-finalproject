// Paying, unpaying and undoing an attempt (settlement-lifecycle design D2–D4; README §4.4). The route already checked
// the permission; here the scope (the same 404 for unknown and foreign), then the transition to answer early. The guard
// of the repository has the last word, and the answer is the view read back from what was written.
import type { BatchStatus, SettlementView } from '@recon/shared'
import { NotFoundError } from '../../../shared/errors.js'
import type { Scope } from '../../catalog/domain/scope.js'
import { type LifecycleAction, transitionOf } from '../domain/batch-lifecycle.js'
import { transitionErrorOf } from './errors.js'
import type { SettlementLifecycleRepository, SettlementReader } from './ports.js'
import type { BatchHeader, SettlementQueries } from './read-ports.js'

export interface SettlementLifecycleServiceDeps {
  queries: Pick<SettlementQueries, 'batchHeader'>
  repository: SettlementLifecycleRepository
  reader: SettlementReader
  /** Audit instants; tests fix it. */
  clock?: () => Date
}

function assertTransition(status: BatchStatus, action: LifecycleAction): void {
  const transition = transitionOf(status, action)
  if (!transition.ok) throw transitionErrorOf(transition.error, status)
}

export class SettlementLifecycleService {
  private readonly clock: () => Date

  constructor(private readonly deps: SettlementLifecycleServiceDeps) {
    this.clock = deps.clock ?? (() => new Date())
  }

  async pay(scope: Scope, userId: number, batchId: string): Promise<SettlementView> {
    const header = await this.header(scope, batchId)
    assertTransition(header.status, 'pay')
    await this.deps.repository.pay({ batchId: header.batchId, userId, now: this.clock() })
    return this.readView(scope, header.batchId)
  }

  async unpay(scope: Scope, userId: number, batchId: string, reason: string): Promise<SettlementView> {
    const header = await this.header(scope, batchId)
    assertTransition(header.status, 'unpay')
    await this.deps.repository.unpay({ batchId: header.batchId, userId, now: this.clock(), reason })
    return this.readView(scope, header.batchId)
  }

  /** The import comes from the header, read after the scope: it never changes (design D4). */
  async undo(scope: Scope, userId: number, batchId: string, reason: string): Promise<SettlementView> {
    const header = await this.header(scope, batchId)
    assertTransition(header.status, 'undo')
    await this.deps.repository.undo({
      batchId: header.batchId,
      importId: header.importId,
      userId,
      now: this.clock(),
      reason,
    })
    return this.readView(scope, header.batchId)
  }

  private async header(scope: Scope, batchId: string): Promise<BatchHeader> {
    const header = await this.deps.queries.batchHeader(scope, batchId)
    if (header === null) throw new NotFoundError('Settlement')
    return header
  }

  private async readView(scope: Scope, batchId: string): Promise<SettlementView> {
    const view = await this.deps.reader.view(batchId, scope)
    if (view === null) throw new NotFoundError('Settlement')
    return view
  }
}
