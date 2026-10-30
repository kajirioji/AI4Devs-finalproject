// Server state of the settlement screens (web-settlement design D3).
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { importKey } from '@/features/imports/queries'
import {
  type BatchStatus,
  type Cycle,
  getAccountFees,
  getAccountSettlements,
  getFeeTypes,
  getNextBatchNumber,
  getSettlement,
  getSettlementTransactions,
  previewSettlement,
  type SettlementDateField,
  type SettlementRequest,
} from './contract'

/** Catalogs that do not change while the screen is open (design D3). */
const CATALOG_STALE_MS = 5 * 60_000

/** The non-transactional fees of the account in force on the settlement date; asked only once there is one. */
export const accountFeesQuery = (accountId: string, asOf: string | null) =>
  queryOptions({
    queryKey: ['accounts', accountId, 'fees', { transactional: false, asOf }] as const,
    queryFn: () => getAccountFees(accountId, { transactional: false, asOf: asOf! }),
    enabled: asOf !== null,
    staleTime: CATALOG_STALE_MS,
  })

export const feeTypesQuery = () =>
  queryOptions({ queryKey: ['fee-types'] as const, queryFn: getFeeTypes, staleTime: CATALOG_STALE_MS })

export const settlementKey = (batchId: string) => ['settlements', batchId] as const

/**
 * An attempt: seeded by Process with its 201 and by the answer of pay, unpay and undo; read only on a reload, a link or
 * after a 409 of its status (settlement-lifecycle design D10), so it does not go stale by itself.
 */
export const settlementQuery = (batchId: string) =>
  queryOptions({ queryKey: settlementKey(batchId), queryFn: () => getSettlement(batchId), staleTime: Infinity })

/** Rows per page of Settlement List: the 22 seeded batches of ProviderA-USD take two pages (settlements-browse D9). */
export const SETTLEMENTS_PAGE_SIZE = 20

export interface AccountSettlementsFilters {
  status?: BatchStatus
  dateField?: SettlementDateField
  from?: string
  to?: string
  page: number
}

/** Every page and filter of the list of an account: what a new attempt of the account makes stale. */
export const accountSettlementsPrefix = (accountId: string) => ['accounts', accountId, 'settlements'] as const

export const accountSettlementsQuery = (accountId: string, filters: AccountSettlementsFilters, enabled = true) =>
  queryOptions({
    queryKey: [...accountSettlementsPrefix(accountId), filters] as const,
    queryFn: ({ signal }) => getAccountSettlements(accountId, { ...filters, pageSize: SETTLEMENTS_PAGE_SIZE }, signal),
    enabled,
    // The previous page stays while the next one loads, never the list of another account.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === accountId ? previous : undefined),
  })

/** The movements of an attempt, by cycle and page: their `settled` changes with pay, unpay and undo. */
export const settlementTransactionsPrefix = (batchId: string) => [...settlementKey(batchId), 'transactions'] as const

/**
 * A page of the movements of a cycle, with the page size of the API (50), under the attempt's key: they do not change
 * until an action on the attempt, which marks them stale.
 */
export const settlementTransactionsQuery = (batchId: string, cycle: Cycle, page: number) =>
  queryOptions({
    queryKey: [...settlementTransactionsPrefix(batchId), { cycle, page }] as const,
    queryFn: () => getSettlementTransactions(batchId, { type: cycle, page }),
    staleTime: Infinity,
    // The previous page stays while the next one of the same attempt and cycle loads, never the rows of another
    // attempt or cycle.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === batchId &&
      (previousQuery.queryKey[3] as { cycle: Cycle } | undefined)?.cycle === cycle
        ? previous
        : undefined,
  })

/** The attempts of an import, newest first (GET /imports/{id}/settlements). */
export const importSettlementsKey = (importId: string) => [...importKey(importId), 'settlements'] as const

/** Every proposed number of the account: what undoing an attempt makes stale. */
export const accountBatchNumbersPrefix = (accountId: string) => ['accounts', accountId, 'batch-number'] as const

/** The proposed number is a proposal, not a reservation: always asked again when the screen opens. */
export const nextBatchNumberQuery = (accountId: string, importId: string) =>
  queryOptions({
    queryKey: [...accountBatchNumbersPrefix(accountId), { importId }] as const,
    queryFn: () => getNextBatchNumber(accountId, importId),
    staleTime: 0,
  })

/** The previews hang from the import, keyed by the whole body: one answer per body (design D6). */
export const settlementPreviewsKey = (importId: string) => [...importKey(importId), 'settlement-preview'] as const

export const settlementPreviewKey = (importId: string, request: SettlementRequest | null) =>
  [...settlementPreviewsKey(importId), request] as const

export const settlementPreviewQuery = (importId: string, request: SettlementRequest | null) =>
  queryOptions({
    queryKey: settlementPreviewKey(importId, request),
    queryFn: ({ signal }) => previewSettlement(importId, request!, signal),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
