// The transitions of an attempt (spec settlement "Transiciones del intento", settlement-lifecycle design D2). The only
// source of the rule: the service answers early with it, and the repository's guards take their origin from it.
import type { BatchStatus } from '@recon/shared'

export type LifecycleAction = 'pay' | 'unpay' | 'undo'
export type TransitionError = 'not_processed' | 'not_paid' | 'payment_not_removed'
export type Transition = { ok: true; from: BatchStatus; to: BatchStatus } | { ok: false; error: TransitionError }

/** Each action, from the only status that admits it. */
export const LIFECYCLE_MOVES: Record<LifecycleAction, { from: BatchStatus; to: BatchStatus }> = {
  pay: { from: 'processed', to: 'paid' },
  unpay: { from: 'paid', to: 'processed' },
  undo: { from: 'processed', to: 'undone' },
}

function rejection(status: BatchStatus, action: LifecycleAction): TransitionError {
  if (action === 'unpay') return 'not_paid'
  return action === 'undo' && status === 'paid' ? 'payment_not_removed' : 'not_processed'
}

export function transitionOf(status: BatchStatus, action: LifecycleAction): Transition {
  const move = LIFECYCLE_MOVES[action]
  return status === move.from ? { ok: true, ...move } : { ok: false, error: rejection(status, action) }
}
