import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client.js'
import { PrismaSettlementLifecycleRepository } from './prisma-settlement-lifecycle-repository.js'

// A guard that wrote nothing and an attempt that, read right after, admits the action: another action went and came back
// between both (spec settlement "Ida y vuelta entre la guarda y la lectura"). No gate reaches that instant, so the
// transaction is a double that answers it.
const BATCH_ID = '7d1c2b3a-0000-4000-8000-000000000001'
const command = { batchId: BATCH_ID, userId: 1, now: new Date('2026-10-19T15:40:03.120Z'), reason: 'A reason' }

function repositoryWith(guards: unknown[][], status: string) {
  const queryRaw = vi.fn()
  for (const answer of guards) queryRaw.mockResolvedValueOnce(answer)
  const tx = {
    $queryRaw: queryRaw,
    settlementBatch: { findUnique: vi.fn().mockResolvedValue({ status }) },
  }
  const prisma = { $transaction: (write: (client: typeof tx) => Promise<void>) => write(tx) }
  return new PrismaSettlementLifecycleRepository(prisma as unknown as PrismaClient, {
    missing: { resolveForBatch: vi.fn(), reopenForBatch: vi.fn() },
  })
}

describe('a guard that lost against a round trip', () => {
  it('pay: the attempt reads processed again, so settlement_busy and not 404', async () => {
    await expect(repositoryWith([[]], 'processed').pay(command)).rejects.toMatchObject({ code: 'settlement_busy' })
  })

  it('unpay: the attempt reads paid again, so settlement_busy and not 404', async () => {
    await expect(repositoryWith([[]], 'paid').unpay(command)).rejects.toMatchObject({ code: 'settlement_busy' })
  })

  it('undo: its import was claimed and the attempt reads processed, so settlement_busy and not settlement_not_current', async () => {
    const undo = repositoryWith([[{ importId: 'claimed' }], []], 'processed').undo({ ...command, importId: 'claimed' })

    await expect(undo).rejects.toMatchObject({ code: 'settlement_busy' })
  })

  it('a status that does not admit the action keeps its own error', async () => {
    await expect(repositoryWith([[]], 'paid').pay(command)).rejects.toMatchObject({ code: 'settlement_not_processed' })
  })
})
