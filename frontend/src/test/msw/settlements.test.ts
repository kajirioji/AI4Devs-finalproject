// The fake settlement API on its own, without screens (web-settlement design D15). It covers only what the fake
// models between requests: active batch numbers, the import validated → processed, the current run, the stored
// attempts, the channel confirmation, the scripted answers and the scope. Figures come from the fixtures, never
// from the fees the request sends.
import {
  AccountFee,
  AccountSettlementsPage as AccountSettlementsPageSchema,
  BatchNoTakenDetails,
  ChannelAssignmentNotConfirmedDetails,
  ExportQuery,
  FeeTypeView,
  ImportNotValidatedDetails,
  NextBatchNumber,
  SettlementPreview,
  SettlementRequest,
  SettlementTransactionsPage as SettlementTransactionsPageSchema,
  SettlementView,
} from '@recon/shared'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import type { AccountSettlementsPage, SettlementTransactionsPage } from '@/features/settlements/contract'
import { strings } from '@/features/settlements/strings'
import { ACCOUNT_IDS, USERS, type UserName } from './fixtures'
import { issueTokens } from './handlers'
import { importRecord, seedImport } from './imports'
import {
  accountSettlement,
  batchCleanPreview,
  failNextSettlement,
  holdNextSettlement,
  paidHistory,
  providerBPreview,
  respondNextSettlement,
  scriptPreview,
  seedAccountSettlements,
  seedActiveBatch,
  seedMovements,
  seedSettlement,
  settlementMovement,
  settlementRequests,
} from './settlements'
import { currentRunId, seedValidationRun } from './validations'

async function call(as: UserName, method: string, path: string, body?: object) {
  const { accessToken } = issueTokens(as)
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${window.location.origin}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const USD = ACCOUNT_IDS['ProviderA-USD']

/** An import of batch-clean validated on a reviewed run, as Settlement Review finds it. */
function validatedClean() {
  const { importId } = seedImport('batch-clean', { status: 'validated' })
  const { runId } = seedValidationRun(importId, undefined, { reviewedBy: 'analyst' })
  return { importId, runId }
}

const FILE_FEES: SettlementRequest['batchFees'] = [
  { feeTypeId: 121, feeId: null, amount: '25.0000', description: 'Wire Fee', source: 'file' },
  { feeTypeId: 117, feeId: null, amount: '15.0000', description: 'Settlement Fee', source: 'file' },
]

const preview = (importId: string, body: SettlementRequest, as: UserName = 'analyst') =>
  call(as, 'POST', `/imports/${importId}/settlements/preview`, body)
const process = (importId: string, body: SettlementRequest, as: UserName = 'analyst') =>
  call(as, 'POST', `/imports/${importId}/settlements`, body)

describe('fake settlement API: reads for the form', () => {
  it('proposes the next batch number of the account', async () => {
    const { importId } = validatedClean()
    const next = await call('analyst', 'GET', `/accounts/${USD}/batch-number/next?importId=${importId}`)
    expect(next.status).toBe(200)
    expect(next.body as NextBatchNumber).toEqual({ accountId: USD, batchNo: 123, attemptNo: 1, reason: 'next' })
  })

  it('lists the non-transactional fees of the account in force on a date, and records the asOf', async () => {
    const fees = await call('analyst', 'GET', `/accounts/${USD}/fees?transactional=false&asOf=2026-10-24`)
    expect(fees.status).toBe(200)
    const list = fees.body as AccountFee[]
    expect(list.map((f) => [f.title, f.fixedAmount, f.percentage])).toEqual([['Chargeback over 1%', null, '0.010000']])
    expect(settlementRequests('fees').at(-1)!.url).toContain('asOf=2026-10-24')
  })

  it('lists the fee types of the seed with allowsFreeAmount', async () => {
    const types = (await call('analyst', 'GET', '/fee-types')).body as FeeTypeView[]
    const byTitle = (title: string) => types.find((t) => t.title === title)!
    expect(byTitle('Special Adjustment')).toMatchObject({ isTransactional: false, allowsFreeAmount: true })
    expect(byTitle('Wire Fee')).toMatchObject({ feeTypeId: 121, isTransactional: false, allowsFreeAmount: false })
    expect(types.some((t) => t.isTransactional)).toBe(true)
  })
})

describe('fake settlement API: preview', () => {
  it('answers the fixture, with batchNo and batchFees copied from the body and the figures of the fixture', async () => {
    const { importId, runId } = validatedClean()
    const base = batchCleanPreview()

    const first = await preview(importId, { runId, batchNo: 123, settlementDate: '2026-10-24', batchFees: FILE_FEES })
    expect(first.status).toBe(200)
    const view = first.body as SettlementPreview
    expect(view).toMatchObject({ importId, accountId: USD, runId, batchNo: 123, batchNoAvailable: true })
    expect(view.batchFees.map((f) => [f.feeTypeId, f.title, f.amount, f.source, f.batchFeeId, f.enteredBy])).toEqual([
      [121, 'Wire Fee', '25.0000', 'file', null, null],
      [117, 'Settlement Fee', '15.0000', 'file', null, null],
    ])
    expect(view.amountPayable).toBe(base.amountPayable)
    expect(view.otherFeeAmt).toBe(base.otherFeeAmt)

    // Other fees, the same figures: the fake does not sum anything.
    const second = await preview(importId, {
      runId,
      batchNo: 124,
      settlementDate: '2026-10-24',
      batchFees: [{ feeTypeId: 119, feeId: null, amount: '-42.5000', description: 'Fix', source: 'manual' }],
    })
    const other = second.body as SettlementPreview
    expect(other.batchNo).toBe(124)
    expect(other.batchFees.map((f) => [f.title, f.amount])).toEqual([['Special Adjustment', '-42.5000']])
    expect(other.amountPayable).toBe(base.amountPayable)
    expect(other.otherFeeAmt).toBe(base.otherFeeAmt)
    expect(other.payableBreakdown).toEqual(base.payableBreakdown)
  })

  it('says a batch number with an active attempt is not available', async () => {
    const { importId, runId } = validatedClean()
    seedActiveBatch(USD, 117)
    const view = (await preview(importId, { runId, batchNo: 117, settlementDate: '2026-10-24' }))
      .body as SettlementPreview
    expect(view.batchNoAvailable).toBe(false)
  })

  it('rejects an amount sent as a number, like the strict body of the API', async () => {
    const { importId, runId } = validatedClean()
    const answer = await call('analyst', 'POST', `/imports/${importId}/settlements/preview`, {
      runId,
      settlementDate: '2026-10-24',
      batchFees: [{ feeTypeId: 121, feeId: null, amount: 25, source: 'file' }],
    })
    expect(answer.status).toBe(400)
    expect(answer.body.code).toBe('validation_error')
  })

  it('answers the scripted steps in order: a batch_fee_invalid, then a preview that does not add up', async () => {
    const { importId, runId } = validatedClean()
    const odd = { ...batchCleanPreview(), amountPayable: '1.0000' }
    scriptPreview(importId, [
      { status: 400, code: 'batch_fee_invalid', details: { index: 1, reason: 'description_required' } },
      odd,
    ])
    const body = { runId, settlementDate: '2026-10-24', batchFees: FILE_FEES }
    const first = await preview(importId, body)
    expect(first.status).toBe(400)
    expect(first.body).toMatchObject({
      code: 'batch_fee_invalid',
      details: { index: 1, reason: 'description_required' },
    })
    expect(((await preview(importId, body)).body as SettlementPreview).amountPayable).toBe('1.0000')
    // Without a script, an empty description is not rejected: the fake does not decide it.
    const free = await preview(importId, {
      runId,
      settlementDate: '2026-10-24',
      batchFees: [{ feeTypeId: 119, feeId: null, amount: '5.0000', source: 'manual' }],
    })
    expect(free.status).toBe(200)
  })

  it('answers the ProviderB-Main variant for an import of that account', async () => {
    const { importId } = seedImport('batch-issues', { status: 'validated' })
    const { runId } = seedValidationRun(importId, undefined, { reviewedBy: 'analyst' })
    const view = (await preview(importId, { runId, settlementDate: '2026-10-24' })).body as SettlementPreview
    expect(view.warnings).toEqual(providerBPreview().warnings)
    expect(view.warnings.map((w) => w.code)).toContain('chargeback_reserve_policy_not_applied')
  })

  it('keeps the payable labels of the fixtures equal to the texts of the screen', () => {
    for (const line of [...batchCleanPreview().payableBreakdown, ...providerBPreview().payableBreakdown]) {
      expect(strings.payableLines[line.code]).toBe(line.label)
    }
  })
})

describe('fake settlement API: process and read', () => {
  it('creates the attempt, moves the import to processed and serves it by its id', async () => {
    const { importId, runId } = validatedClean()
    const created = await process(importId, {
      runId,
      batchNo: 123,
      settlementDate: '2026-10-24',
      confirmChannelAssignment: true,
      batchFees: FILE_FEES,
    })
    expect(created.status).toBe(201)
    const view = created.body as SettlementView
    expect(view).toMatchObject({
      importId,
      accountId: USD,
      accountName: 'ProviderA-USD',
      batchNo: 123,
      attemptNo: 1,
      status: 'processed',
      settledStatus: 'pending_payment',
      approvedBy: { userName: 'analyst' },
      settlementDate: '2026-10-24',
    })
    expect(view.processedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(view.batchFees.map((f) => [f.title, f.amount, f.enteredBy?.userName])).toEqual([
      ['Wire Fee', '25.0000', 'analyst'],
      ['Settlement Fee', '15.0000', 'analyst'],
    ])
    expect(view.channelsAssigned).toEqual([
      { channelId: 1007, name: 'RAM-07', assignment: 'new_primary', previousAccount: null },
    ])
    expect(importRecord(importId)).toMatchObject({ status: 'processed', currentBatchId: view.batchId })

    const again = await process(importId, { runId, batchNo: 124, settlementDate: '2026-10-24' })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: 'import_not_validated', details: { status: 'processed' } })

    const read = await call('viewer', 'GET', `/settlements/${view.batchId}`)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(view)
    expect((await call('analyst', 'GET', '/settlements/5c3f9e21-8a4b-4f0e-b1d2-000000000999')).status).toBe(404)
  })

  it('answers batch_no_taken for a number with an active attempt, and nothing changes', async () => {
    const { importId, runId } = validatedClean()
    const other = seedActiveBatch(USD, 123)
    const answer = await process(importId, {
      runId,
      batchNo: 123,
      settlementDate: '2026-10-24',
      confirmChannelAssignment: true,
    })
    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({
      code: 'batch_no_taken',
      details: { batchNo: 123, attemptNo: 1, importId: other.importId },
    })
    expect(importRecord(importId).status).toBe('validated')
  })

  it('asks for the channel confirmation when the fixture requires it', async () => {
    const { importId, runId } = validatedClean()
    const answer = await process(importId, { runId, batchNo: 123, settlementDate: '2026-10-24' })
    expect(answer.status).toBe(409)
    expect(answer.body.code).toBe('channel_assignment_not_confirmed')
    expect(answer.body.details.channels).toEqual(batchCleanPreview().channelsToAssign)
    expect(importRecord(importId).status).toBe('validated')
  })

  it('answers validation_run_superseded for a run that is not the current one', async () => {
    const { importId, runId } = validatedClean()
    const answer = await preview(importId, { runId: runId - 1, settlementDate: '2026-10-24' })
    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({ code: 'validation_run_superseded', details: { runId: runId - 1 } })
  })

  it('answers import_not_validated before a review', async () => {
    const { importId } = seedImport('batch-clean', { status: 'analyzed' })
    const { runId } = seedValidationRun(importId)
    const answer = await preview(importId, { runId, settlementDate: '2026-10-24' })
    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({ code: 'import_not_validated', details: { status: 'analyzed' } })
  })

  it('answers a scripted error once, without changing anything', async () => {
    const { importId, runId } = validatedClean()
    respondNextSettlement('process', { status: 409, code: 'import_not_validated', details: { status: 'analyzed' } })
    const body = { runId, batchNo: 123, settlementDate: '2026-10-24', confirmChannelAssignment: true }
    expect((await process(importId, body)).status).toBe(409)
    expect(importRecord(importId).status).toBe('validated')
    expect((await process(importId, body)).status).toBe(201)
  })
})

describe('fake settlement API: permissions and scope', () => {
  it('answers 403 to viewer on preview and process', async () => {
    const { importId, runId } = validatedClean()
    const body = { runId, settlementDate: '2026-10-24' }
    expect((await preview(importId, body, 'viewer')).status).toBe(403)
    expect((await process(importId, body, 'viewer')).status).toBe(403)
  })

  it('answers 404 outside the scope of the user', async () => {
    const { importId } = seedImport('legacy-provider', { status: 'validated' })
    const alt = ACCOUNT_IDS['ProviderC-Alt']
    expect((await call('viewer', 'GET', `/accounts/${alt}/batch-number/next?importId=${importId}`)).status).toBe(404)
    expect((await call('viewer', 'GET', `/accounts/${alt}/fees?transactional=false`)).status).toBe(404)
    // An import that is not of the account is not found either.
    const { importId: clean } = validatedClean()
    expect((await call('analyst', 'GET', `/accounts/${alt}/batch-number/next?importId=${clean}`)).status).toBe(404)
  })
})

describe('fake settlement API: test controls', () => {
  it('holds a request until released', async () => {
    const { importId, runId } = validatedClean()
    const hold = holdNextSettlement('preview')
    const answer = preview(importId, { runId, settlementDate: '2026-10-24' })
    await hold.arrived
    expect(settlementRequests('preview').at(-1)!.status).toBeNull()
    hold.release()
    expect((await answer).status).toBe(200)
  })

  it('fails a request as a network error', async () => {
    const { importId, runId } = validatedClean()
    failNextSettlement('process')
    await expect(process(importId, { runId, settlementDate: '2026-10-24' })).rejects.toThrow()
    expect(importRecord(importId).status).toBe('validated')
  })
})

/** No issue of the schema of @recon/shared: the answer has the shape the API of #11 sends. */
function expectShape(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value)
  expect(result.success ? [] : result.error.issues).toEqual([])
}

describe('fake settlement API: the shapes of @recon/shared (web-settlement task 9.2)', () => {
  it('the proposed number, the fees of every account and the fee types', async () => {
    const { importId } = validatedClean()
    expectShape(
      NextBatchNumber,
      (await call('analyst', 'GET', `/accounts/${USD}/batch-number/next?importId=${importId}`)).body,
    )
    for (const accountId of Object.values(ACCOUNT_IDS)) {
      const fees = await call('admin', 'GET', `/accounts/${accountId}/fees?transactional=false&asOf=2026-10-24`)
      expectShape(z.array(AccountFee), fees.body)
    }
    expectShape(z.array(FeeTypeView), (await call('analyst', 'GET', '/fee-types')).body)
  })

  it('the previews of both fixtures, with the body the screen sends', async () => {
    const { importId, runId } = validatedClean()
    const body = { runId, batchNo: 123, settlementDate: '2026-10-24', batchFees: FILE_FEES }
    expectShape(SettlementRequest, body)
    expectShape(SettlementPreview, (await preview(importId, body)).body)

    const { importId: b } = seedImport('batch-issues', { status: 'validated' })
    const { runId: bRun } = seedValidationRun(b, undefined, { reviewedBy: 'analyst' })
    expectShape(SettlementPreview, (await preview(b, { runId: bRun, settlementDate: '2026-10-24' })).body)
  })

  it('an amount written without its four decimals comes back as the API returns it', async () => {
    const { importId, runId } = validatedClean()
    const answer = await preview(importId, {
      runId,
      settlementDate: '2026-10-24',
      batchFees: [
        { feeTypeId: 121, feeId: null, amount: '30', source: 'file' },
        { feeTypeId: 119, feeId: null, amount: '-1.5', description: 'Fix', source: 'manual' },
      ],
    })
    expectShape(SettlementPreview, answer.body)
    expect((answer.body as SettlementPreview).batchFees.map((f) => f.amount)).toEqual(['30.0000', '-1.5000'])
  })

  it('the 201 of process and the attempt read back', async () => {
    const { importId, runId } = validatedClean()
    const body = {
      runId,
      batchNo: 123,
      settlementDate: '2026-10-24',
      confirmChannelAssignment: true,
      batchFees: FILE_FEES,
    }
    expectShape(SettlementRequest, body)
    const created = await process(importId, body)
    expectShape(SettlementView, created.body)
    expectShape(SettlementView, (await call('viewer', 'GET', `/settlements/${created.body.batchId}`)).body)
  })

  it('the details of the errors the screens read', async () => {
    const { importId, runId } = validatedClean()
    seedActiveBatch(USD, 123)
    const taken = await process(importId, {
      runId,
      batchNo: 123,
      settlementDate: '2026-10-24',
      confirmChannelAssignment: true,
    })
    expectShape(BatchNoTakenDetails, taken.body.details)
    const channels = await process(importId, { runId, batchNo: 124, settlementDate: '2026-10-24' })
    expectShape(ChannelAssignmentNotConfirmedDetails, channels.body.details)

    const { importId: analyzed } = seedImport('batch-clean', { status: 'analyzed' })
    const { runId: aRun } = seedValidationRun(analyzed)
    expectShape(
      ImportNotValidatedDetails,
      (await preview(analyzed, { runId: aRun, settlementDate: '2026-10-24' })).body.details,
    )
  })

  it('the export URLs of the view carry the query of @recon/shared/settlement-reads', async () => {
    const { importId } = validatedClean()
    const view = seedSettlement(importId, { batchNo: 123 })
    for (const [type, url] of Object.entries(view.exports)) {
      const { pathname, searchParams } = new URL(url, window.location.origin)
      expect(pathname).toBe(`/api/v1/settlements/${view.batchId}/export`)
      expectShape(ExportQuery, Object.fromEntries(searchParams))
      expect(searchParams.get('type')).toBe(type)
    }
  })

  it('rejects a body the strict schema of the API rejects: an unknown field or a batch number past INT', async () => {
    const { importId, runId } = validatedClean()
    const extra = await call('analyst', 'POST', `/imports/${importId}/settlements/preview`, {
      runId,
      settlementDate: '2026-10-24',
      unexpected: true,
    })
    expect([extra.status, extra.body.code]).toEqual([400, 'validation_error'])
    const huge = await preview(importId, { runId, batchNo: 2_147_483_648, settlementDate: '2026-10-24' })
    expect([huge.status, huge.body.code]).toEqual([400, 'validation_error'])
    const notADay = await preview(importId, { runId, settlementDate: '2026-02-30' })
    expect([notADay.status, notADay.body.code]).toEqual([400, 'validation_error'])
  })
})

// --- The attempts of an account and the movements of an attempt (settlements-browse design D13) -------------------
// The fake only paginates what the test seeds, already in the order of the API: it neither filters by status, date
// field or days nor sorts. The filters are checked on the query the screen sends.

describe('fake settlement API: the attempts of an account', () => {
  const ALT = ACCOUNT_IDS['ProviderC-Alt']

  it('pages the seeded attempts with their total, unfiltered and unsorted, and records the query', async () => {
    const history = paidHistory(USD, 22)
    seedAccountSettlements(USD, history)
    const first = await call('viewer', 'GET', `/accounts/${USD}/settlements?page=1&pageSize=20`)
    expect(first.status).toBe(200)
    const page = first.body as AccountSettlementsPage
    expect(page).toMatchObject({ accountId: USD, page: 1, pageSize: 20, total: 22 })
    expect(page.items.map((i) => i.batchNo)).toEqual(history.slice(0, 20).map((i) => i.batchNo))
    const second = await call('viewer', 'GET', `/accounts/${USD}/settlements?page=2&pageSize=20`)
    expect((second.body as AccountSettlementsPage).items.map((i) => i.batchNo)).toEqual([102, 101])

    // A filter is not applied: the same 22 come back, and the query is in the log.
    const filtered = await call(
      'viewer',
      'GET',
      `/accounts/${USD}/settlements?status=undone&dateField=processedAt&from=2030-01-01&to=2030-01-31`,
    )
    expect((filtered.body as AccountSettlementsPage).total).toBe(22)
    expect(settlementRequests('accountSettlements').at(-1)!.url).toBe(
      `/api/v1/accounts/${USD}/settlements?status=undone&dateField=processedAt&from=2030-01-01&to=2030-01-31`,
    )
  })

  it('answers an empty page for an account without seeded attempts', async () => {
    const answer = await call('analyst', 'GET', `/accounts/${ACCOUNT_IDS['ProviderA-EUR']}/settlements`)
    expect(answer.body).toMatchObject({ page: 1, pageSize: 50, total: 0, items: [] })
  })

  it('puts an attempt created by Process first in the list of its account', async () => {
    seedAccountSettlements(USD, paidHistory(USD, 3))
    const { importId, runId } = validatedClean()
    const created = await process(importId, { runId, settlementDate: '2026-10-24', confirmChannelAssignment: true })
    const view = created.body as SettlementView
    const page = (await call('analyst', 'GET', `/accounts/${USD}/settlements`)).body as AccountSettlementsPage
    expect(page.total).toBe(4)
    expect(page.items[0]).toMatchObject({
      batchId: view.batchId,
      importId,
      batchNo: 123,
      status: 'processed',
      settledStatus: 'pending_payment',
      settlementDate: '2026-10-24',
      processedAt: view.processedAt,
      amountPayable: view.amountPayable,
      channels: 'RAM-01,RAM-02,RAM-07',
    })
  })

  it('answers 404 for an account outside the scope of the user, and for an unknown one', async () => {
    seedAccountSettlements(ALT, paidHistory(ALT, 2, 7))
    expect((await call('viewer', 'GET', `/accounts/${ALT}/settlements`)).body).toEqual({
      code: 'not_found',
      message: 'Account not found',
    })
    expect((await call('analyst', 'GET', `/accounts/${ALT}/settlements`)).status).toBe(200)
    expect((await call('analyst', 'GET', '/accounts/0b6f4c1e-1a2b-4c3d-8e4f-0000000000ff/settlements')).status).toBe(
      404,
    )
  })

  it('answers a scripted 400 once, as the API answers a range whose start is after its end', async () => {
    seedAccountSettlements(USD, paidHistory(USD, 2))
    respondNextSettlement('accountSettlements', { status: 400, code: 'validation_error', message: 'from: after to' })
    const url = `/accounts/${USD}/settlements?from=2026-10-24&to=2026-10-01`
    expect((await call('analyst', 'GET', url)).body).toMatchObject({ code: 'validation_error' })
    // Without a script the fake does not decide it.
    expect((await call('analyst', 'GET', url)).status).toBe(200)
  })
})

describe('fake settlement API: the movements of an attempt', () => {
  it('pages the seeded movements of one cycle and answers 404 outside the scope', async () => {
    const { importId } = validatedClean()
    const view = seedSettlement(importId, { batchNo: 123 })
    const e = Array.from({ length: 60 }, (_, i) => settlementMovement({ settlementTxnId: String(1000 + i) }))
    seedMovements(view.batchId, 'E', e)
    seedMovements(view.batchId, 'I', [settlementMovement({ cycle: 'I', status: 'Chargeback', roundNo: 1 })])

    const page = await call('viewer', 'GET', `/settlements/${view.batchId}/transactions?type=E&page=2`)
    expect(page.status).toBe(200)
    expect(page.body).toMatchObject({ batchId: view.batchId, type: 'E', page: 2, pageSize: 50, total: 60 })
    expect((page.body as SettlementTransactionsPage).items.map((m) => m.settlementTxnId)).toEqual(
      e.slice(50).map((m) => m.settlementTxnId),
    )
    const i = (await call('viewer', 'GET', `/settlements/${view.batchId}/transactions?type=I`))
      .body as SettlementTransactionsPage
    expect(i.items.map((m) => m.cycle)).toEqual(['I'])
    expect(settlementRequests('transactions').map((r) => r.url)).toEqual([
      `/api/v1/settlements/${view.batchId}/transactions?type=E&page=2`,
      `/api/v1/settlements/${view.batchId}/transactions?type=I`,
    ])

    const { importId: alt } = seedImport('legacy-provider', { status: 'validated' })
    seedValidationRun(alt, undefined, { reviewedBy: 'analyst' })
    const foreign = seedSettlement(alt)
    expect((await call('viewer', 'GET', `/settlements/${foreign.batchId}/transactions?type=E`)).status).toBe(404)
  })
})

describe('fake settlement API: the shapes of the reads of settlements-browse', () => {
  it('the attempts of an account and the movements pass the schemas of @recon/shared', async () => {
    seedAccountSettlements(USD, [
      ...paidHistory(USD, 2),
      accountSettlement({ status: 'undone', settledStatus: 'undone', settlementDate: null, channels: null }),
    ])
    expectShape(AccountSettlementsPageSchema, (await call('analyst', 'GET', `/accounts/${USD}/settlements`)).body)

    const { importId } = validatedClean()
    const view = seedSettlement(importId)
    seedMovements(view.batchId, 'I', [
      settlementMovement({ cycle: 'I', status: 'Refund', roundNo: 2, eventDate: null }),
      settlementMovement({ sheetId: null, sheetName: null, rowNo: null, fees: [], settled: true }),
    ])
    expectShape(
      SettlementTransactionsPageSchema,
      (await call('analyst', 'GET', `/settlements/${view.batchId}/transactions?type=I`)).body,
    )
  })
})

/** A download as the API of #12 sends it: the CSV with its headers, or the JSON error. */
async function download(as: UserName, path: string) {
  const { accessToken } = issueTokens(as)
  const response = await fetch(`${window.location.origin}/api/v1${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

describe('fake settlement API: the downloads as #12 fixed them', () => {
  it('a CSV named by attempt in Content-Disposition, for viewer too', async () => {
    const { importId } = validatedClean()
    const view = seedSettlement(importId, { batchNo: 123 })
    for (const type of ExportQuery.shape.type.options) {
      const file = await download('viewer', `/settlements/${view.batchId}/export?type=${type}`)
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toMatch(/^text\/csv/)
      expect(file.headers.get('content-disposition')).toBe(`attachment; filename="ProviderA-USD_B123_A1_${type}.csv"`)
    }
  })

  it('a type outside the query of @recon/shared is a 400 validation_error, as JSON', async () => {
    const { importId } = validatedClean()
    const view = seedSettlement(importId)
    expect(ExportQuery.safeParse({ type: 'pdf' }).success).toBe(false)
    const answer = await download('analyst', `/settlements/${view.batchId}/export?type=pdf`)
    expect([answer.status, JSON.parse(answer.text).code]).toEqual([400, 'validation_error'])
  })

  it('403 without reports.view before the scope, and 404 for an attempt that does not exist', async () => {
    const permissions = USERS.viewer.permissions
    USERS.viewer.permissions = ['fee.view']
    onTestFinished(() => {
      USERS.viewer.permissions = permissions
    })
    const missing = '5c3f9e21-8a4b-4f0e-b1d2-000000000999'
    expect((await download('viewer', `/settlements/${missing}/export?type=summary`)).status).toBe(403)
    const notFound = await download('analyst', `/settlements/${missing}/export?type=summary`)
    expect([notFound.status, JSON.parse(notFound.text).code]).toEqual([404, 'not_found'])
  })
})

describe('fake settlement API: pay, unpay and undo (settlement-lifecycle task 6.1)', () => {
  function processed() {
    const { importId } = seedImport('batch-clean', { status: 'validated' })
    seedValidationRun(importId, undefined, { reviewedBy: 'analyst' })
    return seedSettlement(importId, { batchNo: 123 })
  }

  it('answers each transition with the shape of the view, and moves the list row and the movements', async () => {
    const view = processed()
    seedAccountSettlements(view.accountId, [accountSettlement({ batchId: view.batchId, status: 'processed' })])
    seedMovements(view.batchId, 'E', [settlementMovement()])

    const paid = await call('payments', 'POST', `/settlements/${view.batchId}/pay`)
    expect(paid.status).toBe(200)
    expect(SettlementView.parse(paid.body)).toMatchObject({
      status: 'paid',
      settledStatus: 'settled',
      paidBy: { userName: 'payments' },
    })
    const list = await call('payments', 'GET', `/accounts/${view.accountId}/settlements`)
    expect((list.body as AccountSettlementsPage).items[0]).toMatchObject({ status: 'paid', settledStatus: 'settled' })
    const movements = await call('payments', 'GET', `/settlements/${view.batchId}/transactions?type=E`)
    expect((movements.body as SettlementTransactionsPage).items[0]!.settled).toBe(true)

    const unpaid = await call('payments', 'POST', `/settlements/${view.batchId}/unpay`, { reason: ' Rejected ' })
    expect(SettlementView.parse(unpaid.body)).toMatchObject({ status: 'processed', paidAt: null, paidBy: null })

    const undone = await call('analyst', 'POST', `/settlements/${view.batchId}/undo`, { reason: ' Wrong date ' })
    expect(SettlementView.parse(undone.body)).toMatchObject({
      status: 'undone',
      undoneBy: { userName: 'analyst' },
      undoReason: 'Wrong date',
    })
  })

  it('undo takes the import back to analyzed and supersedes its run', async () => {
    const view = processed()
    await call('analyst', 'POST', `/settlements/${view.batchId}/undo`, { reason: 'Wrong date' })

    expect(importRecord(view.importId)).toMatchObject({ status: 'analyzed', currentBatchId: null })
    expect(currentRunId(view.importId)).toBeNull()
  })

  it('answers the 409 of the status, the 403 of the permission and the 400 of the reason', async () => {
    const view = processed()
    const path = `/settlements/${view.batchId}`
    expect((await call('analyst', 'POST', `${path}/pay`)).status).toBe(403)
    expect((await call('viewer', 'POST', `${path}/undo`, { reason: 'x' })).status).toBe(403)
    expect((await call('payments', 'POST', `${path}/undo`, { reason: 'x' })).status).toBe(403)
    expect((await call('analyst', 'POST', `${path}/undo`, { reason: '  ' })).status).toBe(400)
    expect((await call('payments', 'POST', `${path}/unpay`, { reason: 'x' })).body).toMatchObject({
      code: 'settlement_not_paid',
      details: { status: 'processed' },
    })
    await call('payments', 'POST', `${path}/pay`)
    expect((await call('analyst', 'POST', `${path}/undo`, { reason: 'x' })).body).toMatchObject({
      code: 'settlement_payment_not_removed',
      details: { status: 'paid' },
    })
    expect((await call('payments', 'POST', `${path}/pay`)).body).toMatchObject({
      code: 'settlement_not_processed',
      details: { status: 'paid' },
    })
  })
})
