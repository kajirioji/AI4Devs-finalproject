import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../../../shared/errors.js'
import { EXAMPLE_BATCH_ID, exampleView } from '../test-support/example-view.js'
import { InMemorySettlementLifecycleRepository } from './__fakes__/in-memory.js'
import { BATCH_HEADER, InMemorySettlementQueries, RecordingSettlementReader } from './__fakes__/in-memory-reads.js'
import { SettlementNotPaidError, SettlementNotProcessedError, SettlementPaymentNotRemovedError } from './errors.js'
import { SettlementLifecycleService } from './settlement-lifecycle-service.js'

// Spec settlement "Marcar como pagado", "Retirar la marca de pago": the order scope → transition → repository → view.
const SCOPE = { merchantIds: [1] }
const NOW = new Date('2026-10-20T15:00:00.000Z')
const USER = 7
const FOREIGN = '9d1e2f30-4a5b-4c6d-8e7f-901a2b3c4d5e'

function build(status: 'processed' | 'paid' | 'undone' = 'processed') {
  const repository = new InMemorySettlementLifecycleRepository()
  const reader = new RecordingSettlementReader(new Map([[EXAMPLE_BATCH_ID, exampleView()]]))
  const queries = new InMemorySettlementQueries({
    headers: [
      { ...BATCH_HEADER, batchId: EXAMPLE_BATCH_ID, status },
      { ...BATCH_HEADER, batchId: FOREIGN, status },
    ],
    merchantOf: new Map([[FOREIGN, 2]]),
  })
  const service = new SettlementLifecycleService({ queries, repository, reader, clock: () => NOW })
  return { service, repository, reader }
}

describe('SettlementLifecycleService.pay', () => {
  it('pays a processed attempt and answers the view read after writing', async () => {
    const { service, repository, reader } = build()

    await expect(service.pay(SCOPE, USER, EXAMPLE_BATCH_ID)).resolves.toEqual(exampleView())

    expect(repository.calls).toEqual([{ action: 'pay', batchId: EXAMPLE_BATCH_ID, userId: USER, now: NOW }])
    expect(reader.scopes).toEqual([SCOPE])
  })

  it.each(['paid', 'undone'] as const)('answers settlement_not_processed from %s without writing', async (status) => {
    const { service, repository } = build(status)

    const error = await service.pay(SCOPE, USER, EXAMPLE_BATCH_ID).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SettlementNotProcessedError)
    expect(error).toMatchObject({ status: 409, code: 'settlement_not_processed', details: { status } })
    expect(repository.calls).toEqual([])
  })

  it('answers the same 404 for an unknown attempt and for one outside the scope', async () => {
    const { service, repository } = build()

    await expect(service.pay(SCOPE, USER, FOREIGN)).rejects.toBeInstanceOf(NotFoundError)
    const unknown = await service.pay(SCOPE, USER, '00000000-0000-4000-8000-00000000ffff').catch((e: unknown) => e)
    const foreign = await service.pay(SCOPE, USER, FOREIGN).catch((e: unknown) => e)

    expect(unknown).toMatchObject({ code: 'not_found', message: 'Settlement not found' })
    expect((foreign as Error).message).toBe((unknown as Error).message)
    expect(repository.calls).toEqual([])
  })

  it('lets the guard of the repository have the last word', async () => {
    const { service, repository } = build()
    repository.failWith = new SettlementNotProcessedError('paid')

    await expect(service.pay(SCOPE, USER, EXAMPLE_BATCH_ID)).rejects.toMatchObject({
      code: 'settlement_not_processed',
      details: { status: 'paid' },
    })
  })
})

describe('SettlementLifecycleService.unpay', () => {
  it('removes the payment with the reason', async () => {
    const { service, repository } = build('paid')

    await service.unpay(SCOPE, USER, EXAMPLE_BATCH_ID, 'Payment was rejected by the bank')

    expect(repository.calls).toEqual([
      {
        action: 'unpay',
        batchId: EXAMPLE_BATCH_ID,
        userId: USER,
        now: NOW,
        reason: 'Payment was rejected by the bank',
      },
    ])
  })

  it.each(['processed', 'undone'] as const)('answers settlement_not_paid from %s without writing', async (status) => {
    const { service, repository } = build(status)

    const error = await service.unpay(SCOPE, USER, EXAMPLE_BATCH_ID, 'reason').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SettlementNotPaidError)
    expect(error).toMatchObject({ status: 409, details: { status } })
    expect(repository.calls).toEqual([])
  })
})

describe('the error of a paid attempt', () => {
  it('says that the payment has to be removed', () => {
    const error = new SettlementPaymentNotRemovedError()
    expect(error).toMatchObject({ status: 409, code: 'settlement_payment_not_removed', details: { status: 'paid' } })
    expect(error.message).toContain('remove the payment')
  })
})

describe('SettlementLifecycleService.undo', () => {
  it('undoes a processed attempt with its import and the reason', async () => {
    const { service, repository } = build()

    await expect(service.undo(SCOPE, USER, EXAMPLE_BATCH_ID, 'Wrong settlement date')).resolves.toEqual(exampleView())

    expect(repository.calls).toEqual([
      {
        action: 'undo',
        batchId: EXAMPLE_BATCH_ID,
        importId: BATCH_HEADER.importId,
        userId: USER,
        now: NOW,
        reason: 'Wrong settlement date',
      },
    ])
  })

  it('answers settlement_payment_not_removed from paid, without writing', async () => {
    const { service, repository } = build('paid')

    await expect(service.undo(SCOPE, USER, EXAMPLE_BATCH_ID, 'reason')).rejects.toBeInstanceOf(
      SettlementPaymentNotRemovedError,
    )
    expect(repository.calls).toEqual([])
  })

  it('answers settlement_not_processed from undone', async () => {
    const { service } = build('undone')

    await expect(service.undo(SCOPE, USER, EXAMPLE_BATCH_ID, 'reason')).rejects.toMatchObject({
      code: 'settlement_not_processed',
      details: { status: 'undone' },
    })
  })

  it('answers the same 404 outside the scope', async () => {
    const { service, repository } = build()

    await expect(service.undo(SCOPE, USER, FOREIGN, 'reason')).rejects.toBeInstanceOf(NotFoundError)
    expect(repository.calls).toEqual([])
  })
})
