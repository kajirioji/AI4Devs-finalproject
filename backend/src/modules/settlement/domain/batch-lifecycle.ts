// The transitions of an attempt (spec settlement "Transiciones del intento", settlement-lifecycle design D2). The only
// source of the rule: the service answers early with it, and the repository's guards take their origin from it.
import type { BatchStatus } from '@recon/shared'

export type LifecycleAction = 'pay' | 'unpay' | 'undo'
export type TransitionError = 'not_processed' | 'not_paid' | 'payment_not_removed'
export type Transition = { ok: true; from: BatchStatus; to: BatchStatus } | { ok: false; error: TransitionError }

export function transitionOf(status: BatchStatus, action: LifecycleAction): Transition {
  switch (action) {
    case 'pay':
      return status === 'processed' ? { ok: true, from: status, to: 'paid' } : { ok: false, error: 'not_processed' }
    case 'unpay':
      return status === 'paid' ? { ok: true, from: status, to: 'processed' } : { ok: false, error: 'not_paid' }
    case 'undo':
      if (status === 'processed') return { ok: true, from: status, to: 'undone' }
      return { ok: false, error: status === 'paid' ? 'payment_not_removed' : 'not_processed' }
  }
}
