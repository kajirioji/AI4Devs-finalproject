import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { auditInstant } from '@/lib/format'
import { ACCOUNT_IDS, type UserName } from '@/test/msw/fixtures'
import {
  importAttempt,
  seedImportSettlements,
  seedNextBatchNumber,
  seedSettlement,
  settlementRequests,
} from '@/test/msw/settlements'
import { renderApp } from '@/test/render'
import { chooseDate, openReview, previewShown, validatedImport } from '@/test/settlement-screens'
import { OPENING } from '@/test/validation-screens'
import type { SettlementView } from './contract'
import { strings } from './strings'

// Spec settlement "Pantalla Settlement Summary: tras deshacer", "intentos del import" and "pagar" (settlement-lifecycle
// design D9, D10); spec validation "Validar de nuevo tras deshacer", on the screen of Analysis.
const s = strings.summary
const a = s.actions
const USD = ACCOUNT_IDS['ProviderA-USD']

async function open(as: UserName, overrides: Partial<SettlementView> = {}) {
  const { importId } = validatedImport()
  const view = seedSettlement(importId, { batchNo: 123, overrides })
  const rendered = renderApp(`/settlements/${view.batchId}`, { as })
  await screen.findByRole('heading', { name: 'Settlement Summary · batch 123' }, OPENING)
  return { ...rendered, view, importId }
}

const definition = (term: string) => screen.getByText(term).parentElement!

describe('who paid and who undid, in the header', () => {
  it('shows who paid and when, in New York time', async () => {
    const { user } = await open('payments')

    await user.click(screen.getByRole('button', { name: a.markPaid }))
    await screen.findByRole('button', { name: a.unpay })

    expect(definition(s.grid.paidBy)).toHaveTextContent(/payments · 2026-10-19 \d\d:\d\d ET/)
  })

  it('a processed attempt has neither', async () => {
    await open('analyst')

    expect(screen.queryByText(s.grid.paidBy)).not.toBeInTheDocument()
    expect(screen.queryByText(s.grid.undoneBy)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: s.goToAnalysis })).not.toBeInTheDocument()
  })

  it('an undone attempt read later shows who, when and why', async () => {
    await open('viewer', {
      status: 'undone',
      settledStatus: 'undone',
      undoneAt: auditInstant('2026-10-19T16:00:00.000Z'),
      undoneBy: { userId: 2, userName: 'analyst' },
      undoReason: 'Wrong settlement date',
    })

    expect(definition(s.grid.undoneBy)).toHaveTextContent('analyst · 2026-10-19 12:00 ET')
    expect(definition(s.grid.undoReason)).toHaveTextContent('Wrong settlement date')
  })
})

describe('after undoing (HU3 CA8)', () => {
  async function undo() {
    const opened = await open('analyst')
    await opened.user.click(screen.getByRole('button', { name: a.undo }))
    const dialog = within(screen.getByRole('alertdialog'))
    await opened.user.type(dialog.getByLabelText(a.reason), 'Wrong settlement date')
    await opened.user.click(dialog.getByRole('button', { name: a.confirm }))
    await screen.findByRole('link', { name: s.goToAnalysis })
    return opened
  }

  it('stays on the attempt, says who, when and why, and offers the way back', async () => {
    const { router, view } = await undo()

    expect(router.state.location.pathname).toBe(`/settlements/${view.batchId}`)
    expect(screen.getByText('Undone')).toBeInTheDocument()
    expect(definition(s.grid.undoneBy)).toHaveTextContent(/analyst · 2026-10-19 \d\d:\d\d ET/)
    expect(definition(s.grid.undoReason)).toHaveTextContent('Wrong settlement date')
    expect(screen.queryByText(s.notSettled)).not.toBeInTheDocument()
  })

  it('the link reaches Analysis, analyzed, without a run, with Run validations and why the review was invalidated', async () => {
    const { user, importId, router } = await undo()

    await user.click(screen.getByRole('link', { name: s.goToAnalysis }))

    const notice = await screen.findByRole('region', { name: 'Review invalidated' }, OPENING)
    expect(notice).toHaveTextContent('the settlement attempt was undone')
    expect(router.state.location.pathname).toBe(`/imports/${importId}`)
    expect(router.state.location.search).toMatchObject({ step: 'analysis' })
    expect(screen.getByRole('button', { name: 'Run validations' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Import' })).getByText('analyzed')).toBeInTheDocument()
  })
})

describe('the attempts of the import', () => {
  it('lists them as the API sends them, the undone one dimmed, marking the one on screen, with a link to the other', async () => {
    const { importId } = validatedImport()
    const view = seedSettlement(importId, { batchNo: 118, overrides: { attemptNo: 2 } })
    const first = importAttempt({
      batchId: '11111111-0000-4000-8000-000000000001',
      batchNo: 118,
      attemptNo: 1,
      status: 'undone',
      settledStatus: 'undone',
      isCurrent: false,
      amountPayable: '33771.3600',
    })
    seedImportSettlements(importId, {
      importId,
      currentBatchId: view.batchId,
      items: [
        importAttempt({
          batchId: view.batchId,
          batchNo: 118,
          attemptNo: 2,
          isCurrent: true,
          amountPayable: '33000.0000',
        }),
        first,
      ],
    })
    renderApp(`/settlements/${view.batchId}`, { as: 'analyst' })

    const attempts = within(await screen.findByRole('region', { name: s.attempts.title }, OPENING))
    const rows = attempts.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('118 · attempt 2')
    expect(rows[0]).toHaveTextContent(s.attempts.viewing)
    expect(rows[0]).toHaveTextContent('33,000.00')
    expect(within(rows[0]!).queryByRole('link')).not.toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('118 · attempt 1')
    expect(rows[1]).toHaveTextContent('Undone')
    expect(rows[1]).toHaveAttribute('data-undone', 'true')
    expect(within(rows[1]!).getByRole('link', { name: '118 · attempt 1' })).toHaveAttribute(
      'href',
      `/settlements/${first.batchId}`,
    )
  })

  it('a single attempt: the list is not shown', async () => {
    const { importId } = validatedImport()
    const view = seedSettlement(importId, { batchNo: 123 })
    seedImportSettlements(importId, {
      importId,
      currentBatchId: view.batchId,
      items: [importAttempt({ batchId: view.batchId, batchNo: 123, isCurrent: true })],
    })
    renderApp(`/settlements/${view.batchId}`, { as: 'analyst' })

    await screen.findByRole('heading', { name: 'Settlement Summary · batch 123' }, OPENING)
    // The answer arrived and had the time to be painted: without this wait the absence would prove nothing.
    await expect.poll(() => settlementRequests('importSettlements')[0]?.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByRole('region', { name: s.attempts.title })).not.toBeInTheDocument()
  })

  it('asks for them again after an action', async () => {
    const { user } = await open('payments')
    await expect.poll(() => settlementRequests('importSettlements').length).toBe(1)

    await user.click(screen.getByRole('button', { name: a.markPaid }))
    await screen.findByRole('button', { name: a.unpay })

    await expect.poll(() => settlementRequests('importSettlements').length).toBe(2)
  })
})

describe('reprocessing (spec "Reprocesar con el mismo número")', () => {
  it('proposes the same number and attempt 2, and processing reaches the Summary of attempt 2', async () => {
    seedNextBatchNumber({ accountId: USD, batchNo: 118, attemptNo: 2, reason: 'reprocess' })
    const { importId } = validatedImport()
    const { user } = await openReview(importId)

    expect(
      screen.getByText('Proposed: 118 · attempt 2 (the previous attempt of this import was undone)'),
    ).toBeInTheDocument()
    chooseDate('2026-10-24')
    await previewShown()

    await user.click(screen.getByRole('checkbox', { name: 'Assign these channels to this account as primary' }))
    await user.click(screen.getByRole('button', { name: /^Process/ }))

    expect(await screen.findByRole('heading', { name: 'Settlement Summary · batch 118' })).toBeInTheDocument()
  })
})
