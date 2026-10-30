// In-memory doubles of the reads of an attempt (summary-exports design D13): queries over fixed data that record what
// they were asked, and a reader that records the scope it receives.
import type {
  AccountSettlement,
  AccountSettlementsQuery,
  Cycle,
  ImportSettlements,
  SettlementView,
} from '@recon/shared'
import type { Scope } from '../../../catalog/domain/scope.js'
import type { ExportRow } from '../../domain/exports/transactions-csv.js'
import type { SettlementReader } from '../ports.js'
import type {
  BatchHeader,
  SettlementQueries,
  StoredAccountSettlementsPage,
  StoredMovement,
  StoredMovementsPage,
} from '../read-ports.js'

export const BATCH_HEADER: BatchHeader = {
  batchId: '5c3f9e21-8a4b-4f0e-b1d2-6e7f8a9b0c1d',
  importId: '7b0c2a52-3f8e-4d0a-9a61-0d8f3b1e2c44',
  accountId: 'a0000000-0000-4000-8000-000000000001',
  accountName: 'ProviderA-USD',
  batchNo: 123,
  attemptNo: 1,
  status: 'processed',
}

/** A movement as the contract example for #13 shows it. */
export function storedMovement(overrides: Partial<StoredMovement> = {}): StoredMovement {
  return {
    settlementTxnId: '88213',
    transactionId: '40711',
    sourceTransactionId: '911545598812004',
    gatewayId: 1,
    cycle: 'I',
    status: 'Chargeback',
    roundNo: 2,
    sheetId: '2d4e6f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    sheetName: 'CHB',
    rowNo: 2,
    amount: '96.9300',
    excludeAmount: false,
    feeAmount: '45.0000',
    eventDate: '2026-10-03T14:12:00.000Z',
    appliedReservePct: '0.100000',
    reserveDaysUsed: 180,
    expectedReserveReleaseAt: null,
    reserveHeldAmt: '0.0000',
    reserveReleasedAmt: '0.0000',
    reserveEarlyReleasedAmt: '0.0000',
    reservePolicySnapshot: { policy: 'hold_until_term', applied: false },
    fees: [
      {
        appliedFeeId: '120334',
        feeId: '0b8e1c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d',
        feeTypeId: 4,
        code: 'Chargeback',
        title: 'Chargeback',
        eventDate: '2026-10-03T14:12:00.000Z',
        amountUsd: '45.0000',
        configurationSnapshot: { fixedAmount: '45.0000', percentage: null, base: '96.9300' },
      },
    ],
    ...overrides,
  }
}

export interface InMemoryQueriesData {
  headers?: BatchHeader[]
  movements?: StoredMovement[]
  exportRows?: ExportRow[]
  attempts?: ImportSettlements[]
  /** The attempts of each account id, already in the order of the port; the double paginates, never filters. */
  accountSettlements?: ReadonlyMap<string, AccountSettlement[]>
  sourceIds?: ReadonlyMap<string, string>
  /** The merchant of each batch and import id, for the scope; ids absent here are in merchant 1. */
  merchantOf?: ReadonlyMap<string, number>
}

export class InMemorySettlementQueries implements SettlementQueries {
  readonly asked = {
    exportRows: [] as Cycle[][],
    sourceIds: [] as string[][],
    accountSettlements: [] as AccountSettlementsQuery[],
  }
  failExportRowsWith: Error | null = null

  constructor(private readonly data: InMemoryQueriesData = {}) {}

  private visible(scope: Scope, id: string): boolean {
    return scope.merchantIds.includes(this.data.merchantOf?.get(id.toLowerCase()) ?? 1)
  }

  async batchHeader(scope: Scope, batchId: string): Promise<BatchHeader | null> {
    const header = (this.data.headers ?? []).find((h) => h.batchId.toLowerCase() === batchId.toLowerCase())
    return header !== undefined && this.visible(scope, batchId) ? structuredClone(header) : null
  }

  async movementsPage(_batchId: string, cycle: Cycle, page: number, pageSize: number): Promise<StoredMovementsPage> {
    const all = (this.data.movements ?? []).filter((m) => m.cycle === cycle)
    return { items: structuredClone(all.slice((page - 1) * pageSize, page * pageSize)), total: all.length }
  }

  async exportRows(_batchId: string, cycles: readonly Cycle[]): Promise<ExportRow[]> {
    this.asked.exportRows.push([...cycles])
    if (this.failExportRowsWith) throw this.failExportRowsWith
    return (this.data.exportRows ?? []).filter((r) => cycles.includes(r.cycle))
  }

  async importAttempts(scope: Scope, importId: string): Promise<ImportSettlements | null> {
    const found = (this.data.attempts ?? []).find((a) => a.importId.toLowerCase() === importId.toLowerCase())
    return found !== undefined && this.visible(scope, importId) ? structuredClone(found) : null
  }

  async accountSettlements(
    scope: Scope,
    accountId: string,
    query: AccountSettlementsQuery,
  ): Promise<StoredAccountSettlementsPage | null> {
    this.asked.accountSettlements.push({ ...query })
    const all = this.data.accountSettlements?.get(accountId.toLowerCase())
    if (all === undefined || !this.visible(scope, accountId)) return null
    const { page, pageSize } = query
    return { items: structuredClone(all.slice((page - 1) * pageSize, page * pageSize)), total: all.length }
  }

  async sourceIds(transactionIds: readonly string[]): Promise<Map<string, string>> {
    this.asked.sourceIds.push([...transactionIds])
    const known = this.data.sourceIds ?? new Map()
    return new Map(transactionIds.flatMap((id) => (known.has(id) ? [[id, known.get(id)!] as const] : [])))
  }
}

/** The reader of #11 as a double: fixed views, and the scope of every call. */
export class RecordingSettlementReader implements SettlementReader {
  readonly scopes: (Scope | undefined)[] = []

  constructor(private readonly views: ReadonlyMap<string, SettlementView> = new Map()) {}

  async view(batchId: string, scope?: Scope): Promise<SettlementView | null> {
    this.scopes.push(scope)
    return structuredClone(this.views.get(batchId) ?? null)
  }
}
