// The settlement routes of #11 (settlement-process), #12 (summary-exports) and #64 (settlements-browse), the only
// place of the screens that knows them (web-settlement design D2). Types are aliases of the generated contract with
// the dates branded by kind; the calls go through the typed `api` client. Money and rates are always strings.
import type {
  BatchFeeInvalidDetails,
  BatchNoTakenDetails,
  ChannelAssignmentNotConfirmedDetails,
  ImportNotValidatedDetails,
  SettlementStateDetails,
} from '@recon/shared'
import { api, unwrap } from '@/lib/api/client'
import type { paths } from '@/lib/api/schema.gen'
import type { ApiResponse } from '@/lib/api/types'
import type { AuditInstant, BusinessDate } from '@/lib/format'

export type { AuditInstant, BusinessDate }

// Dates by kind: business dates (date ranges, the settlement date, fee validity, the event and reserve release dates
// of a movement) are New York dates, sent with a Z when they carry a time; the instants of processing, paying and
// undoing are UTC audit instants.
type BusinessKey = 'min' | 'max' | 'settlementDate' | 'startDate' | 'endDate' | 'eventDate' | 'expectedReserveReleaseAt'
type AuditKey = 'processedAt' | 'paidAt' | 'undoneAt'
type Brand<V, B> = V extends string ? B : V
/** The generated type with each date field typed by its kind, at any depth. */
type Dated<T> = T extends readonly (infer U)[]
  ? Dated<U>[]
  : T extends object
    ? {
        [K in keyof T]: K extends BusinessKey
          ? Brand<T[K], BusinessDate>
          : K extends AuditKey
            ? Brand<T[K], AuditInstant>
            : Dated<T[K]>
      }
    : T

type ProcessPath = '/api/v1/imports/{importId}/settlements'
type PreviewPath = '/api/v1/imports/{importId}/settlements/preview'
type NextPath = '/api/v1/accounts/{accountId}/batch-number/next'
type FeesPath = '/api/v1/accounts/{accountId}/fees'
type ExportPath = '/api/v1/settlements/{batchId}/export'
type AccountSettlementsPath = '/api/v1/accounts/{accountId}/settlements'
type TransactionsPath = '/api/v1/settlements/{batchId}/transactions'
type JsonRequest<B> = B extends { content: { 'application/json': infer Body } } ? Body : never

/** Body of the preview and of Process. */
export type SettlementRequest = JsonRequest<paths[ProcessPath]['post']['requestBody']>
export type BatchFeeInput = NonNullable<SettlementRequest['batchFees']>[number]

export type SettlementPreview = Dated<ApiResponse<PreviewPath, 'post'>>
/** An attempt as written: the 201 of processing, the same view GET /settlements/{id} answers. */
export type SettlementView = Dated<ApiResponse<ProcessPath, 'post', 201>>
/** What the preview and the view share. */
export type SettlementFigures = Omit<
  SettlementPreview,
  | 'importId'
  | 'accountId'
  | 'runId'
  | 'batchNo'
  | 'attemptNo'
  | 'batchNoAvailable'
  | 'requiresChannelConfirmation'
  | 'channelsToAssign'
>

/** Decimal string with 4 decimals ("1234.5600"); negative only in batch fees. */
export type Money = SettlementFigures['amountPayable']
/** Decimal string with 6 decimals ("0.100000"). */
export type Rate = NonNullable<SettlementFigures['mdrRate']>
export type UserRef = SettlementView['approvedBy']
export type CategoryTotal = SettlementFigures['totals'][number]
export type Category = CategoryTotal['category']
/** Inclusive range of business dates. */
export type DateRange = NonNullable<SettlementFigures['dateRanges']['APP']>
export type BrandTotal = SettlementFigures['brandTotals'][number]
export type BatchFeeView = SettlementFigures['batchFees'][number]
export type Skipped = SettlementFigures['skipped']
export type SettlementWarning = SettlementFigures['warnings'][number]
/** Always the nine lines, in this order; their signed sum is amountPayable, computed by the server. */
export type PayableLine = SettlementFigures['payableBreakdown'][number]
export type PayableLineCode = PayableLine['code']
export type ChannelToAssign = SettlementPreview['channelsToAssign'][number]
/** The other account of a channel: named, or only `outOfScope` when its merchant is outside the caller's scope. */
export type OtherAccount = NonNullable<ChannelToAssign['otherAccount']>
export type ChannelAssigned = SettlementView['channelsAssigned'][number]
export type ValidationSummary = NonNullable<SettlementView['validationSummary']>

export type NextBatchNumber = ApiResponse<NextPath, 'get'>
export type AccountFee = Dated<ApiResponse<FeesPath, 'get'>[number]>
export type FeeTypeView = ApiResponse<'/api/v1/fee-types', 'get'>[number]

/**
 * `details` of the errors the screens read, as @recon/shared defines them; the generated error body types them as
 * unknown, so the screens have a text for when they are missing (and for a reason they do not know yet).
 */
export interface ErrorDetails {
  import_not_validated: ImportNotValidatedDetails
  batch_no_taken: BatchNoTakenDetails
  channel_assignment_not_confirmed: ChannelAssignmentNotConfirmedDetails
  batch_fee_invalid: BatchFeeInvalidDetails
  settlement_not_processed: SettlementStateDetails
  settlement_not_paid: SettlementStateDetails
}

export type ExportType = NonNullable<paths[ExportPath]['get']['parameters']['query']>['type']

/** The attempts of an account, newest first (settlements-browse "Contrato"). */
export type AccountSettlementsPage = Dated<ApiResponse<AccountSettlementsPath, 'get'>>
export type AccountSettlement = AccountSettlementsPage['items'][number]
export type BatchStatus = AccountSettlement['status']
export type SettledStatus = AccountSettlement['settledStatus']
export type AccountSettlementsQuery = NonNullable<paths[AccountSettlementsPath]['get']['parameters']['query']>
/** The date `from` and `to` filter: the business settlement date or the New York day of the processing instant. */
export type SettlementDateField = NonNullable<AccountSettlementsQuery['dateField']>

/** The movements of one cycle of an attempt, in the stable order of #12. */
export type SettlementTransactionsPage = Dated<ApiResponse<TransactionsPath, 'get'>>
export type SettlementMovement = SettlementTransactionsPage['items'][number]
export type AppliedFee = SettlementMovement['fees'][number]
export type Cycle = SettlementMovement['cycle']

// --- Calls ---------------------------------------------------------------------------------------------------------
// The casts only brand the dates of an answer typed by the generated contract.

export const getNextBatchNumber = (accountId: string, importId: string) =>
  unwrap(
    api.GET('/api/v1/accounts/{accountId}/batch-number/next', { params: { path: { accountId }, query: { importId } } }),
  )

export const getAccountFees = (accountId: string, query: { transactional: boolean; asOf: string }) =>
  unwrap(
    api.GET('/api/v1/accounts/{accountId}/fees', {
      params: {
        path: { accountId },
        query: { transactional: query.transactional ? 'true' : 'false', asOf: query.asOf },
      },
    }),
  ) as Promise<AccountFee[]>

export const getFeeTypes = () => unwrap(api.GET('/api/v1/fee-types'))

export const previewSettlement = (importId: string, body: SettlementRequest, signal?: AbortSignal) =>
  unwrap(
    api.POST('/api/v1/imports/{importId}/settlements/preview', { params: { path: { importId } }, body, signal }),
  ) as Promise<SettlementPreview>

export const processSettlement = (importId: string, body: SettlementRequest) =>
  unwrap(
    api.POST('/api/v1/imports/{importId}/settlements', { params: { path: { importId } }, body }),
  ) as Promise<SettlementView>

/** The attempt as written; the same SettlementView as the 201 of processing. */
export const getSettlement = (batchId: string) =>
  unwrap(api.GET('/api/v1/settlements/{batchId}', { params: { path: { batchId } } })) as Promise<SettlementView>

export const paySettlement = (batchId: string) =>
  unwrap(api.POST('/api/v1/settlements/{batchId}/pay', { params: { path: { batchId } } })) as Promise<SettlementView>

export const unpaySettlement = (batchId: string, reason: string) =>
  unwrap(
    api.POST('/api/v1/settlements/{batchId}/unpay', { params: { path: { batchId } }, body: { reason } }),
  ) as Promise<SettlementView>

export const undoSettlement = (batchId: string, reason: string) =>
  unwrap(
    api.POST('/api/v1/settlements/{batchId}/undo', { params: { path: { batchId } }, body: { reason } }),
  ) as Promise<SettlementView>

/** The attempts of an account; the days of `from` and `to` travel as typed, YYYY-MM-DD, never through a Date. */
export const getAccountSettlements = (accountId: string, query: AccountSettlementsQuery, signal?: AbortSignal) =>
  unwrap(
    api.GET('/api/v1/accounts/{accountId}/settlements', { params: { path: { accountId }, query }, signal }),
  ) as Promise<AccountSettlementsPage>

/** One page of the movements of a cycle of the attempt. */
export const getSettlementTransactions = (batchId: string, query: { type: Cycle; page: number }) =>
  unwrap(
    api.GET('/api/v1/settlements/{batchId}/transactions', { params: { path: { batchId }, query } }),
  ) as Promise<SettlementTransactionsPage>

/** A downloaded export: the file and the name the API gave it in Content-Disposition, if it could be read. */
export interface DownloadedExport {
  blob: Blob
  fileName: string | null
}

/**
 * File name of a Content-Disposition header (`filename*=UTF-8''…` or `filename="…"`). A name that cannot be decoded
 * is no name: the caller uses the name of the attempt, and the download goes on.
 */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)
  if (extended) {
    try {
      return decodeURIComponent(extended[1]!.trim())
    } catch {
      // Malformed percent-encoding: fall through to the plain filename, if any.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1]!.trim() : null
}

/** An export of the attempt, authenticated: the links of `exports` need the Bearer token (D12). Errors are JSON. */
export async function downloadSettlementExport(batchId: string, type: ExportType): Promise<DownloadedExport> {
  const call = api.GET('/api/v1/settlements/{batchId}/export', {
    params: { path: { batchId }, query: { type } },
    parseAs: 'blob',
  })
  const blob = await unwrap(call)
  const { response } = await call
  return {
    blob,
    fileName: fileNameOf(response.headers.get('content-disposition')),
  }
}
