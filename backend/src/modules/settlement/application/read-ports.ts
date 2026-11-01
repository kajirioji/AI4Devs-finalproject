// Ports of the reads of an attempt and its exports (summary-exports design D1, D3, D4, D6, D11). Kept apart from the
// processing ports of #11: the view itself comes from SettlementReader.view, unchanged.
import type {
  AccountSettlement,
  AccountSettlementsQuery,
  BatchStatus,
  Cycle,
  ImportSettlements,
  SettlementMovement,
} from '@recon/shared'
import type { Scope } from '../../catalog/domain/scope.js'
import type { ExportRow } from '../domain/exports/transactions-csv.js'

/** What the reads need of an attempt before the view: its scope, the file name and the RR description. */
export interface BatchHeader {
  batchId: string
  importId: string
  accountId: string
  accountName: string
  batchNo: number
  attemptNo: number
  status: BatchStatus
}

/** A movement as written; `settled` is derived from the attempt by the service. */
export type StoredMovement = Omit<SettlementMovement, 'settled'>

export interface StoredMovementsPage {
  items: StoredMovement[]
  total: number
}

export interface StoredAccountSettlementsPage {
  items: AccountSettlement[]
  total: number
}

export interface SettlementQueries {
  /** null when the attempt does not exist or its merchant is outside the scope (the same 404). */
  batchHeader(scope: Scope, batchId: string): Promise<BatchHeader | null>
  /** One cycle in the stable order (sheetId, rowNo, settlementTxnId), with each movement's fees. */
  movementsPage(batchId: string, cycle: Cycle, page: number, pageSize: number): Promise<StoredMovementsPage>
  /** The movements of the cycles, in the stable order (cycle, sheetId, rowNo, settlementTxnId), unpaginated. */
  exportRows(batchId: string, cycles: readonly Cycle[]): Promise<ExportRow[]>
  /** null when the import does not exist or is outside the scope; its attempts, newest first. */
  importAttempts(scope: Scope, importId: string): Promise<ImportSettlements | null>
  /**
   * null when the account does not exist or is outside the scope; its attempts filtered by status and by the days of
   * query.dateField, newest first (processedAt, batchNo, attemptNo descending), one page.
   */
  accountSettlements(
    scope: Scope,
    accountId: string,
    query: AccountSettlementsQuery,
  ): Promise<StoredAccountSettlementsPage | null>
  /** Internal transactionId → sourceTransactionId, only for the given ids (the warnings of a summary, design D2). */
  sourceIds(transactionIds: readonly string[]): Promise<Map<string, string>>
}
