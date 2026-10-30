import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '../../../generated/prisma/client.js'
import { SettlementBusyError } from '../application/errors.js'
import { isDeadlockVictim, withDeadlockRetry } from './deadlock-retry.js'

const known = (code: string, kind?: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
    meta: kind === undefined ? {} : { driverAdapterError: { cause: { kind } } },
  })
const victim = () => known('P2010', 'TransactionWriteConflict')

describe('isDeadlockVictim', () => {
  it('recognises the shape of a 1205, from raw SQL and from the client', () => {
    expect(isDeadlockVictim(victim())).toBe(true)
    expect(isDeadlockVictim(known('P2034', 'TransactionWriteConflict'))).toBe(true)
  })

  it('does not take any other error for one', () => {
    expect(isDeadlockVictim(known('P2010', 'UniqueConstraintViolation'))).toBe(false)
    expect(isDeadlockVictim(known('P2010'))).toBe(false)
    expect(isDeadlockVictim(known('P2002', 'TransactionWriteConflict'))).toBe(false)
    expect(isDeadlockVictim(new Error('TransactionWriteConflict'))).toBe(false)
  })
})

describe('withDeadlockRetry', () => {
  it('answers settlement_busy after three deadlocks, without a fourth attempt', async () => {
    const log = { warn: vi.fn() }
    const transaction = vi.fn(async () => {
      throw victim()
    })
    await expect(withDeadlockRetry(transaction, { log, context: { batchId: 'b' } })).rejects.toBeInstanceOf(
      SettlementBusyError,
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith({ batchId: 'b', attempt: 1, maxAttempts: 3 }, expect.any(String))
  })

  it('returns what a later attempt returns', async () => {
    const transaction = vi.fn<() => Promise<string>>().mockRejectedValueOnce(victim()).mockResolvedValueOnce('done')
    await expect(withDeadlockRetry(transaction, { context: {} })).resolves.toBe('done')
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('does not retry any other error', async () => {
    const failure = new Error('boom')
    const transaction = vi.fn(async () => {
      throw failure
    })
    await expect(withDeadlockRetry(transaction, { context: {} })).rejects.toBe(failure)
    expect(transaction).toHaveBeenCalledTimes(1)
  })
})
