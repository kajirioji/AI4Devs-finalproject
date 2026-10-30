// Pay, unpay and undo (settlement-lifecycle design D10): a synchronous guard so that two clicks in the same tick send
// one POST, and no optimistic update: the attempt is painted with the answer of the API. A 409 of the status reads the
// attempt again; settlement_busy and a network failure change nothing, so the same body can go again.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { importKey } from '@/features/imports/queries'
import { validationRunKey } from '@/features/validations/queries'
import { ApiError } from '@/lib/api/client'
import { type ErrorDetails, paySettlement, type SettlementView, undoSettlement, unpaySettlement } from './contract'
import {
  accountBatchNumbersPrefix,
  accountSettlementsPrefix,
  importSettlementsKey,
  settlementKey,
  settlementTransactionsPrefix,
} from './queries'
import { strings } from './strings'

const s = strings.summary.actions

export type SettlementAction =
  | { action: 'pay' }
  | { action: 'unpay'; reason: string }
  | { action: 'undo'; reason: string }

/** What the screen does with a failed action: a retryable one keeps its dialog; a stale one closes it. */
export interface ActionError {
  text: string
  retry: boolean
}

function send(batchId: string, action: SettlementAction): Promise<SettlementView> {
  switch (action.action) {
    case 'pay':
      return paySettlement(batchId)
    case 'unpay':
      return unpaySettlement(batchId, action.reason)
    case 'undo':
      return undoSettlement(batchId, action.reason)
  }
}

function errorOf(e: unknown): ActionError {
  if (e instanceof ApiError) {
    if (e.code === 'settlement_payment_not_removed') return { text: s.errors.paymentNotRemoved, retry: false }
    if (e.code === 'settlement_not_processed' || e.code === 'settlement_not_paid') {
      const details = e.details as ErrorDetails['settlement_not_processed'] | undefined
      return { text: s.errors.changed(details?.status ?? ''), retry: false }
    }
    if (e.code === 'settlement_not_current') return { text: s.errors.notCurrent, retry: false }
    if (e.code === 'settlement_busy') return { text: strings.errors.busy, retry: true }
  }
  return { text: s.errors.failed, retry: true }
}

export function useSettlementAction(view: SettlementView) {
  const queryClient = useQueryClient()
  const guard = useRef(false)
  const [error, setError] = useState<ActionError | null>(null)
  const mutation = useMutation({ mutationFn: (action: SettlementAction) => send(view.batchId, action) })

  // After a success the guard holds until the new status is on screen: the action just done is still there until then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the status is what releases it, though it does not read it
  useEffect(() => {
    guard.current = false
  }, [view.status])

  /** Whether the action was applied and, when it failed (`error` says why), whether the same body can go again. */
  async function run(action: SettlementAction): Promise<{ applied: boolean; retry: boolean }> {
    if (guard.current) return { applied: false, retry: true }
    guard.current = true
    setError(null)
    try {
      const updated = await mutation.mutateAsync(action)
      queryClient.setQueryData(settlementKey(view.batchId), updated)
      void queryClient.invalidateQueries({ queryKey: settlementTransactionsPrefix(view.batchId) })
      void queryClient.invalidateQueries({ queryKey: accountSettlementsPrefix(view.accountId) })
      void queryClient.invalidateQueries({ queryKey: importSettlementsKey(view.importId) })
      if (action.action === 'undo') {
        void queryClient.invalidateQueries({ queryKey: importKey(view.importId) })
        void queryClient.invalidateQueries({ queryKey: validationRunKey(view.importId) })
        void queryClient.invalidateQueries({ queryKey: accountBatchNumbersPrefix(view.accountId) })
      }
      return { applied: true, retry: false }
    } catch (e) {
      const failure = errorOf(e)
      setError(failure)
      // Anything but a retryable failure means the attempt is not as the screen shows it: read it again.
      if (!failure.retry) void queryClient.invalidateQueries({ queryKey: settlementKey(view.batchId) })
      guard.current = false
      return { applied: false, retry: failure.retry }
    }
  }

  return { run, pending: mutation.isPending, error, clearError: () => setError(null) }
}
