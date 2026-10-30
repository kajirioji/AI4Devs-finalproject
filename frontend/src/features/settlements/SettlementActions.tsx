import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { useCanPay, useCanProcess } from '@/features/imports/permissions'
import type { SettlementView } from './contract'
import { useSettlementAction } from './lifecycle-mutations'
import { ReasonDialog } from './ReasonDialog'
import { strings } from './strings'

const s = strings.summary.actions

/**
 * What the user may do with the attempt, in its header (settlement-lifecycle design D9): an action without its
 * permission is not shown. The exception is Undo on a paid attempt for whoever may undo: only a step is missing, and
 * without it the button would just disappear.
 */
export function SettlementActions({ view }: { view: SettlementView }) {
  const canPay = useCanPay()
  const canUndo = useCanProcess()
  const { run, pending, error, clearError } = useSettlementAction(view)
  const whyDisabledId = useId()

  const offersPay = canPay && view.status === 'processed'
  const offersUnpay = canPay && view.status === 'paid'
  const offersUndo = canUndo && view.status === 'processed'
  const undoNeedsUnpay = canUndo && view.status === 'paid'
  if (!offersPay && !offersUnpay && !offersUndo && !undoNeedsUnpay && !error) return null

  // A retryable failure of a dialog is said inside it; the rest, here, after it closes.
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {offersPay && (
          <Button size="sm" disabled={pending} onClick={() => void run({ action: 'pay' })}>
            {pending ? s.working : s.markPaid}
          </Button>
        )}
        {offersUnpay && (
          <ReasonDialog
            label={s.unpay}
            title={s.unpayTitle}
            body={s.unpayBody}
            pending={pending}
            error={error?.retry ? error.text : null}
            onOpen={clearError}
            onConfirm={(reason) => confirmed(run({ action: 'unpay', reason }))}
          />
        )}
        {offersUndo && (
          <ReasonDialog
            label={s.undo}
            title={s.undoTitle}
            body={s.undoBody}
            pending={pending}
            error={error?.retry ? error.text : null}
            onOpen={clearError}
            onConfirm={(reason) => confirmed(run({ action: 'undo', reason }))}
          />
        )}
        {undoNeedsUnpay && (
          <Button variant="outline" size="sm" disabled aria-describedby={whyDisabledId}>
            {s.undo}
          </Button>
        )}
      </div>
      {undoNeedsUnpay && (
        <p id={whyDisabledId} className="text-sm text-muted-foreground">
          {s.removePaymentFirst}
        </p>
      )}
      {error && (!error.retry || offersPay) && (
        <p role="alert" className="text-sm text-destructive">
          {error.text}
        </p>
      )}
    </div>
  )

  /** The dialog closes on success and on a failure that is not retryable: the attempt is not what it showed. */
  async function confirmed(result: Promise<{ applied: boolean; retry: boolean }>): Promise<boolean> {
    const { applied, retry } = await result
    return applied || !retry
  }
}
