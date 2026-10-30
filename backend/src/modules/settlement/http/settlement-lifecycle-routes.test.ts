import { ErrorResponse, ROLES, SettlementView } from '@recon/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp, PASSWORD } from '../../../test-support/build-test-app.js'
import {
  InMemoryPrefilledBatchFees,
  InMemorySettlementLifecycleRepository,
  InMemorySettlementReader,
  InMemorySettlementRepository,
  InMemorySettlementSource,
} from '../application/__fakes__/in-memory.js'
import {
  BATCH_HEADER,
  InMemorySettlementQueries,
  RecordingSettlementReader,
} from '../application/__fakes__/in-memory-reads.js'
import { SettlementLifecycleService } from '../application/settlement-lifecycle-service.js'
import { SettlementService } from '../application/settlement-service.js'
import { EXAMPLE_BATCH_ID, exampleView } from '../test-support/example-view.js'
import { settlementSampleInput } from '../test-support/sample-input.js'

// Spec settlement "Alcance y permisos de las acciones del intento": 401, 403 before the scope, the identical 404, 400.
const input = await settlementSampleInput('batch-clean')
const FOREIGN = '9d1e2f30-4a5b-4c6d-8e7f-901a2b3c4d5e'
const UNKNOWN = '00000000-0000-4000-8000-00000000ffff'
const REASON = { reason: 'Payment was rejected by the bank' }
let ctx: Awaited<ReturnType<typeof buildTestApp>> | undefined
let repository: InMemorySettlementLifecycleRepository

afterEach(async () => {
  await ctx?.app.close()
  ctx = undefined
})

async function app(status: 'processed' | 'paid' | 'undone' = 'processed') {
  repository = new InMemorySettlementLifecycleRepository()
  const queries = new InMemorySettlementQueries({
    headers: [
      { ...BATCH_HEADER, batchId: EXAMPLE_BATCH_ID, status },
      { ...BATCH_HEADER, batchId: FOREIGN, status },
    ],
    merchantOf: new Map([[FOREIGN, 2]]),
  })
  const lifecycle = new SettlementLifecycleService({
    queries,
    repository,
    reader: new RecordingSettlementReader(new Map([[EXAMPLE_BATCH_ID, exampleView()]])),
  })
  const service = new SettlementService({
    source: new InMemorySettlementSource(input),
    prefilled: new InMemoryPrefilledBatchFees(input.prefilledFeeTypeIds),
    repository: new InMemorySettlementRepository(),
    reader: new InMemorySettlementReader(),
  })
  ctx = await buildTestApp({ settlement: { service, lifecycle } })
  // A user with payment.process and only merchant 1, for the scope (the seeded doubles have no payments user).
  const viewer = ctx.users.users.find((u) => u.userName === 'viewer')!
  ctx.users.users.push({
    ...structuredClone(viewer),
    userId: 91,
    userName: 'payments',
    email: 'payments@recon.local',
    permissions: [...ROLES.find((r) => r.name === 'payments')!.permissions],
  })
  await ctx.app.ready()
}

async function post(path: string, userName?: string, payload?: object) {
  const headers = userName
    ? { authorization: `Bearer ${(await ctx!.authService.login({ userName, password: PASSWORD })).accessToken}` }
    : {}
  return ctx!.app.inject({
    method: 'POST',
    url: `/api/v1/settlements/${path}`,
    headers,
    ...(payload === undefined ? {} : { payload }),
  })
}

describe('POST /settlements/{id}/pay', () => {
  it('answers 200 with the view, without a body', async () => {
    await app()
    const res = await post(`${EXAMPLE_BATCH_ID}/pay`, 'payments')
    expect(res.statusCode, res.body).toBe(200)
    expect(SettlementView.parse(res.json())).toEqual(exampleView())
    expect(repository.calls).toHaveLength(1)
  })

  it('answers 401 without a token', async () => {
    await app()
    expect((await post(`${EXAMPLE_BATCH_ID}/pay`)).statusCode).toBe(401)
  })

  it.each(['viewer', 'analyst'])('answers 403 to %s, even for an attempt that does not exist', async (user) => {
    await app()
    for (const id of [EXAMPLE_BATCH_ID, UNKNOWN]) {
      const res = await post(`${id}/pay`, user)
      expect(res.statusCode, res.body).toBe(403)
      expect(ErrorResponse.parse(res.json()).code).toBe('forbidden')
    }
    expect(repository.calls).toEqual([])
  })

  it('answers the same 404 for an unknown attempt and for one outside the scope', async () => {
    await app()
    const unknown = await post(`${UNKNOWN}/pay`, 'payments')
    const foreign = await post(`${FOREIGN}/pay`, 'payments')
    expect(unknown.statusCode).toBe(404)
    expect(ErrorResponse.parse(unknown.json())).toMatchObject({
      code: 'not_found',
      message: 'Settlement not found',
    })
    expect(foreign.statusCode).toBe(404)
    expect(ErrorResponse.parse(foreign.json()).message).toBe('Settlement not found')
  })

  it('answers 400 validation_error to an id that is not a uuid', async () => {
    await app()
    const res = await post('not-a-uuid/pay', 'payments')
    expect(res.statusCode).toBe(400)
    expect(ErrorResponse.parse(res.json()).code).toBe('validation_error')
  })

  it('answers 409 settlement_not_processed with the current status', async () => {
    await app('paid')
    const res = await post(`${EXAMPLE_BATCH_ID}/pay`, 'payments')
    expect(res.statusCode).toBe(409)
    expect(ErrorResponse.parse(res.json())).toMatchObject({
      code: 'settlement_not_processed',
      details: { status: 'paid' },
    })
  })
})

describe('POST /settlements/{id}/unpay', () => {
  it('answers 200 and passes the reason without the spaces of its ends', async () => {
    await app('paid')
    const res = await post(`${EXAMPLE_BATCH_ID}/unpay`, 'payments', { reason: `  ${REASON.reason} ` })
    expect(res.statusCode, res.body).toBe(200)
    expect(repository.calls[0]).toMatchObject({ action: 'unpay', reason: REASON.reason })
  })

  it.each([
    ['missing', {}],
    ['empty', { reason: '' }],
    ['blank', { reason: '   ' }],
    ['too long', { reason: 'x'.repeat(501) }],
  ])('answers 400 validation_error to a %s reason, writing nothing', async (_name, body) => {
    await app('paid')
    const res = await post(`${EXAMPLE_BATCH_ID}/unpay`, 'payments', body)
    expect(res.statusCode, res.body).toBe(400)
    expect(ErrorResponse.parse(res.json()).code).toBe('validation_error')
    expect(repository.calls).toEqual([])
  })

  it.each(['viewer', 'analyst'])('answers 403 to %s, even for an attempt that does not exist', async (user) => {
    await app('paid')
    expect((await post(`${EXAMPLE_BATCH_ID}/unpay`, user, REASON)).statusCode).toBe(403)
    expect((await post(`${UNKNOWN}/unpay`, user, REASON)).statusCode).toBe(403)
  })

  it('answers 409 settlement_not_paid with the current status', async () => {
    await app('processed')
    const res = await post(`${EXAMPLE_BATCH_ID}/unpay`, 'payments', REASON)
    expect(res.statusCode).toBe(409)
    expect(ErrorResponse.parse(res.json())).toMatchObject({
      code: 'settlement_not_paid',
      details: { status: 'processed' },
    })
  })
})
