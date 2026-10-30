import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_IDS, type UserName } from '@/test/msw/fixtures'
import {
  accountSettlement,
  failNextSettlement,
  holdNextSettlement,
  respondNextSettlement,
  seedAccountSettlements,
  seedMovements,
  seedSettlement,
  settlementMovement,
  settlementRequests,
} from '@/test/msw/settlements'
import { renderApp } from '@/test/render'
import { validatedImport } from '@/test/settlement-screens'
import { OPENING } from '@/test/validation-screens'
import type { SettlementView } from './contract'
import { strings } from './strings'

// Spec settlement "Pantalla Settlement Summary: acciones según permiso y estado", "pagar", "motivo y confirmación",
// "errores de las acciones" and "Estado sin recargar" (settlement-lifecycle design D9, D10).
const s = strings.summary.actions
const USD = ACCOUNT_IDS['ProviderA-USD']
const PAID = {
  status: 'paid',
  settledStatus: 'settled',
  paidAt: '2026-10-19T15:00:00.000Z',
  paidBy: { userId: 3, userName: 'payments' },
} as unknown as Partial<SettlementView>
const UNDONE = {
  status: 'undone',
  settledStatus: 'undone',
  undoneAt: '2026-10-19T15:00:00.000Z',
  undoneBy: { userId: 2, userName: 'analyst' },
  undoReason: 'Wrong settlement date',
} as unknown as Partial<SettlementView>

async function open(as: UserName, overrides: Partial<SettlementView> = {}) {
  const { importId } = validatedImport()
  const view = seedSettlement(importId, { batchNo: 123, overrides })
  const rendered = renderApp(`/settlements/${view.batchId}`, { as })
  await screen.findByRole('heading', { name: 'Settlement Summary · batch 123' }, OPENING)
  return { ...rendered, view, importId }
}

const action = (name: string) => screen.queryByRole('button', { name })
const dialog = () => within(screen.getByRole('alertdialog'))
const posts = () => settlementRequests().filter((r) => r.method === 'POST')

describe('the actions by user and status', () => {
  it.each<[UserName, boolean, boolean]>([
    ['payments', true, false],
    ['analyst', false, true],
    ['viewer', false, false],
    ['admin', true, true],
  ])('on a processed attempt, %s: Mark as paid %s, Undo batch %s', async (as, canPay, canUndo) => {
    await open(as)

    expect(action(s.markPaid) !== null).toBe(canPay)
    expect(action(s.undo) !== null).toBe(canUndo)
    expect(action(s.unpay)).toBeNull()
  })

  it('on a paid attempt, payments sees Unpay and no Undo', async () => {
    await open('payments', PAID)

    expect(action(s.unpay)).toBeEnabled()
    expect(action(s.undo)).toBeNull()
    expect(action(s.markPaid)).toBeNull()
  })

  it('on a paid attempt, analyst sees Undo disabled and why, and no Unpay', async () => {
    await open('analyst', PAID)

    const undo = action(s.undo)!
    expect(undo).toBeDisabled()
    expect(undo).toHaveAccessibleDescription(s.removePaymentFirst)
    expect(action(s.unpay)).toBeNull()
  })

  it('on a paid attempt, viewer sees none', async () => {
    await open('viewer', PAID)

    for (const name of [s.markPaid, s.unpay, s.undo]) expect(action(name)).toBeNull()
  })

  it.each<UserName>(['admin', 'analyst', 'payments', 'viewer'])('on an undone attempt, %s sees none', async (as) => {
    await open(as, UNDONE)

    for (const name of [s.markPaid, s.unpay, s.undo]) expect(action(name)).toBeNull()
    expect(screen.getByRole('button', { name: 'Merchant summary' })).toBeInTheDocument()
  })

  it('the Movements tab has them too: they are in the header', async () => {
    const { importId } = validatedImport()
    const view = seedSettlement(importId, { batchNo: 123 })
    renderApp(`/settlements/${view.batchId}?tab=movements`, { as: 'payments' })
    expect(await screen.findByRole('button', { name: s.markPaid }, OPENING)).toBeInTheDocument()
  })
})

describe('Mark as paid', () => {
  it('sends one POST on a double click and paints the answer without reading the attempt again', async () => {
    const { user } = await open('payments')
    const reads = settlementRequests('get').length

    await user.dblClick(action(s.markPaid)!)

    expect(await screen.findByRole('button', { name: s.unpay })).toBeInTheDocument()
    expect(settlementRequests('pay')).toHaveLength(1)
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.queryByText(strings.summary.notSettled)).not.toBeInTheDocument()
    expect(settlementRequests('get')).toHaveLength(reads)
  })

  it('asks for the movements again, without reloading, and they read as Settled', async () => {
    const { user, view } = await open('payments')
    seedMovements(view.batchId, 'E', [settlementMovement()])
    await user.click(screen.getByRole('tab', { name: 'Movements' }))
    await screen.findByRole('table', { name: /movements/i })
    const reads = settlementRequests('transactions').length
    await user.click(screen.getByRole('tab', { name: 'Summary' }))

    await user.click(action(s.markPaid)!)
    await screen.findByRole('button', { name: s.unpay })
    await user.click(screen.getByRole('tab', { name: 'Movements' }))

    await waitFor(() => expect(settlementRequests('transactions').length).toBeGreaterThan(reads))
  })

  it('shows the state of the API: the row of the list says Paid, without reloading', async () => {
    const { user, view, router } = await open('payments')
    seedAccountSettlements(USD, [accountSettlement({ batchId: view.batchId, status: 'processed', batchNo: 123 })])
    await user.click(screen.getByRole('link', { name: strings.summary.backToList(view.accountName) }))
    const table = await screen.findByRole('table', { name: strings.list.tableLabel })
    expect(within(table).getByText('Processed · pending payment')).toBeInTheDocument()
    await router.navigate({ to: '/settlements/$batchId', params: { batchId: view.batchId } })

    await user.click(await screen.findByRole('button', { name: s.markPaid }))
    await screen.findByRole('button', { name: s.unpay })
    await user.click(screen.getByRole('link', { name: strings.summary.backToList(view.accountName) }))

    const again = await screen.findByRole('table', { name: strings.list.tableLabel })
    expect(await within(again).findByText('Paid')).toBeInTheDocument()
  })

  it('does not get ahead of the answer: the status stays until it arrives, and the action says Working…', async () => {
    const hold = holdNextSettlement('pay')
    const { user } = await open('payments')

    await user.click(action(s.markPaid)!)
    await hold.arrived

    expect(screen.getByText('Processed · pending payment')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: s.working })).toBeDisabled()

    hold.release()
    expect(await screen.findByRole('button', { name: s.unpay })).toBeInTheDocument()
  })
})

describe('the reason dialog', () => {
  it('Unpay: sends the reason without the spaces of its ends, closes, and says the Back-Office is not reverted', async () => {
    const { user } = await open('payments', PAID)

    await user.click(action(s.unpay)!)
    expect(dialog().getByText(s.unpayBody)).toBeInTheDocument()
    await user.type(dialog().getByLabelText(s.reason), '  Payment was rejected by the bank ')
    await user.click(dialog().getByRole('button', { name: s.confirm }))

    expect(await screen.findByRole('button', { name: s.markPaid })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(settlementRequests('unpay')[0]!.body).toEqual({ reason: 'Payment was rejected by the bank' })
    expect(screen.getByText('Processed · pending payment')).toBeInTheDocument()
  })

  it.each(['', '   '])('Confirm is disabled with its reason for %j, and nothing is sent', async (text) => {
    const { user } = await open('analyst')

    await user.click(action(s.undo)!)
    if (text) await user.type(dialog().getByLabelText(s.reason), text)

    const confirm = dialog().getByRole('button', { name: s.confirm })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription(s.writeReason)
    expect(posts()).toHaveLength(0)
  })

  it('more than 500 characters: says so, and Confirm stays disabled; 500 are accepted', async () => {
    const { user } = await open('analyst')

    await user.click(action(s.undo)!)
    const reason = dialog().getByLabelText(s.reason)
    await user.click(reason)
    await user.paste('x'.repeat(501))

    expect(dialog().getByText(s.tooLong)).toBeInTheDocument()
    expect(dialog().getByRole('button', { name: s.confirm })).toBeDisabled()

    await user.keyboard('{Backspace}')
    expect(dialog().queryByText(s.tooLong)).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: s.confirm })).toBeEnabled()
  })

  it('Cancel sends nothing, and when it opens again the reason is empty', async () => {
    const { user } = await open('analyst')

    await user.click(action(s.undo)!)
    await user.type(dialog().getByLabelText(s.reason), 'Wrong date')
    await user.click(dialog().getByRole('button', { name: s.cancel }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(posts()).toHaveLength(0)
    expect(screen.getByText('Processed · pending payment')).toBeInTheDocument()

    await user.click(action(s.undo)!)
    expect(dialog().getByLabelText(s.reason)).toHaveValue('')
  })

  it('works with the keyboard, and the focus goes back to the action', async () => {
    const { user } = await open('analyst')

    action(s.undo)!.focus()
    await user.keyboard('{Enter}')
    const reason = dialog().getByLabelText(s.reason)
    await waitFor(() => expect(reason).toHaveFocus())
    await user.keyboard('Wrong date')
    await user.tab()
    expect(dialog().getByRole('button', { name: s.cancel })).toHaveFocus()
    await user.keyboard(' ')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(action(s.undo)).toHaveFocus())
    expect(posts()).toHaveLength(0)
  })

  it('sends one POST on a double click of Confirm', async () => {
    const { user } = await open('analyst')

    await user.click(action(s.undo)!)
    await user.type(dialog().getByLabelText(s.reason), 'Wrong date')
    await user.dblClick(dialog().getByRole('button', { name: s.confirm }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(settlementRequests('undo')).toHaveLength(1)
  })
})

describe('the errors of an action', () => {
  async function confirmUndo(as: UserName = 'analyst', overrides: Partial<SettlementView> = {}) {
    const opened = await open(as, overrides)
    await opened.user.click(action(s.undo)!)
    await opened.user.type(dialog().getByLabelText(s.reason), 'Wrong date')
    return opened
  }

  it('someone else paid: says so, closes, reads the attempt again and Undo stays disabled', async () => {
    const { user, view, queryClient } = await confirmUndo()
    // What the API holds by now: read back after the 409.
    seedSettlement(view.importId, { batchNo: 124 })
    queryClient.setQueryDefaults(['never'], {})
    respondNextSettlement('undo', {
      status: 409,
      code: 'settlement_payment_not_removed',
      message: 'paid',
      details: { status: 'paid' },
    })
    const reads = settlementRequests('get').length

    await user.click(dialog().getByRole('button', { name: s.confirm }))

    expect(await screen.findByText(s.errors.paymentNotRemoved)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(settlementRequests('get').length).toBeGreaterThan(reads))
  })

  it.each(['settlement_not_processed', 'settlement_not_paid'])(
    '%s: says the batch changed, with its status, and reads it again',
    async (code) => {
      const { user } = await confirmUndo()
      respondNextSettlement('undo', { status: 409, code, message: code, details: { status: 'undone' } })
      const reads = settlementRequests('get').length

      await user.click(dialog().getByRole('button', { name: s.confirm }))

      expect(await screen.findByText(s.errors.changed('undone'))).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await waitFor(() => expect(settlementRequests('get').length).toBeGreaterThan(reads))
    },
  )

  it('settlement_busy: stays in the dialog with the reason, and Confirm sends the same body again', async () => {
    const { user } = await confirmUndo()
    respondNextSettlement('undo', { status: 409, code: 'settlement_busy', message: 'busy' })

    await user.click(dialog().getByRole('button', { name: s.confirm }))

    expect(await dialog().findByText(strings.errors.busy)).toBeInTheDocument()
    expect(dialog().getByLabelText(s.reason)).toHaveValue('Wrong date')

    await user.click(dialog().getByRole('button', { name: s.confirm }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const requests = settlementRequests('undo')
    expect(requests).toHaveLength(2)
    expect(requests[1]!.body).toEqual(requests[0]!.body)
  })

  it('a network failure in a dialog: says so, keeps the reason, and the attempt does not change', async () => {
    const { user } = await confirmUndo()
    failNextSettlement('undo')

    await user.click(dialog().getByRole('button', { name: s.confirm }))

    expect(await dialog().findByText(s.errors.failed)).toBeInTheDocument()
    expect(dialog().getByLabelText(s.reason)).toHaveValue('Wrong date')
    expect(screen.getByText('Processed · pending payment')).toBeInTheDocument()
  })

  it('a network failure on Mark as paid: says so next to the action, which can be pressed again', async () => {
    const { user } = await open('payments')
    failNextSettlement('pay')

    await user.click(action(s.markPaid)!)

    expect(await screen.findByText(s.errors.failed)).toBeInTheDocument()
    expect(action(s.markPaid)).toBeEnabled()
    await user.click(action(s.markPaid)!)
    expect(await screen.findByRole('button', { name: s.unpay })).toBeInTheDocument()
    expect(screen.queryByText(s.errors.failed)).not.toBeInTheDocument()
  })
})
