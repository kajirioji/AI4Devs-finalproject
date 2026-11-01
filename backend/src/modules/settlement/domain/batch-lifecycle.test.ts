import type { BatchStatus } from '@recon/shared'
import { describe, expect, it } from 'vitest'
import { type LifecycleAction, type Transition, transitionOf } from './batch-lifecycle.js'

// Spec settlement "Tabla de transiciones": every action on every status.
const TABLE: [LifecycleAction, BatchStatus, Transition][] = [
  ['pay', 'processed', { ok: true, from: 'processed', to: 'paid' }],
  ['pay', 'paid', { ok: false, error: 'not_processed' }],
  ['pay', 'undone', { ok: false, error: 'not_processed' }],
  ['unpay', 'paid', { ok: true, from: 'paid', to: 'processed' }],
  ['unpay', 'processed', { ok: false, error: 'not_paid' }],
  ['unpay', 'undone', { ok: false, error: 'not_paid' }],
  ['undo', 'processed', { ok: true, from: 'processed', to: 'undone' }],
  ['undo', 'paid', { ok: false, error: 'payment_not_removed' }],
  ['undo', 'undone', { ok: false, error: 'not_processed' }],
]

describe('transitionOf', () => {
  it.each(TABLE)('%s from %s', (action, status, expected) => {
    expect(transitionOf(status, action)).toEqual(expected)
  })
})
